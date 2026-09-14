const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { dirname, extname, join } = require("node:path");
const { spawn } = require("node:child_process");

let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch {
  // 开发环境尚未安装桌面依赖时，仍可通过静态检查读取本文件。
}

const TOOL_KINDS = new Set(["bbchannel", "emulator"]);
let mainWindow = null;
let settings = {};
let updateUrl = "";
let updateCheckInFlight = false;
let currentCheckManual = false;
let downloadInProgress = false;

function settingsFile() {
  return join(app.getPath("userData"), "desktop-settings.json");
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function loadSettings() {
  const loaded = readJson(settingsFile(), {});
  settings = loaded && typeof loaded === "object" ? loaded : {};
}

function saveSettings() {
  try {
    const file = settingsFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(settings, null, 2), "utf8");
  } catch {
    // 路径设置失败仅影响桌面辅助功能，避免中断主计算器。
  }
}

function loadUpdateConfiguration() {
  const config = readJson(join(__dirname, "update-config.json"), {});
  const candidate = String(config?.url || "").trim();
  updateUrl = /^https:\/\//i.test(candidate) ? candidate.replace(/\/$/, "") : "";
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function sendUpdate(payload) {
  sendToRenderer("updates:event", payload);
}

function canCheckUpdates() {
  return Boolean(autoUpdater && updateUrl);
}

function configureUpdater() {
  if (!autoUpdater || !updateUrl) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.setFeedURL({ provider: "generic", url: updateUrl, channel: "latest" });

  autoUpdater.on("update-available", (info) => {
    updateCheckInFlight = false;
    const version = String(info?.version || "");
    if (!currentCheckManual && settings.skippedUpdateVersion === version) return;
    sendUpdate({ type: "available", version, releaseNotes: info?.releaseNotes || "" });
  });
  autoUpdater.on("update-not-available", () => {
    const manual = currentCheckManual;
    updateCheckInFlight = false;
    if (manual) sendUpdate({ type: "not-available" });
  });
  autoUpdater.on("download-progress", () => {
    sendUpdate({ type: "downloading" });
  });
  autoUpdater.on("update-downloaded", () => {
    downloadInProgress = false;
    sendUpdate({ type: "downloaded" });
  });
  autoUpdater.on("error", (error) => {
    const manual = currentCheckManual || downloadInProgress;
    updateCheckInFlight = false;
    downloadInProgress = false;
    if (manual) sendUpdate({ type: "error", message: error?.message || "更新服务不可用" });
  });
}

async function checkForUpdates({ manual = false } = {}) {
  if (!canCheckUpdates()) {
    if (manual) sendUpdate({ type: "unconfigured" });
    return { ok: false, reason: "unconfigured" };
  }
  if (updateCheckInFlight) return { ok: false, reason: "busy" };
  updateCheckInFlight = true;
  currentCheckManual = Boolean(manual);
  sendUpdate({ type: "checking", manual: currentCheckManual });
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (error) {
    updateCheckInFlight = false;
    if (manual) sendUpdate({ type: "error", message: error?.message || "更新服务不可用" });
    return { ok: false, reason: "failed" };
  }
}

async function downloadAndInstall() {
  if (!canCheckUpdates()) {
    sendUpdate({ type: "unconfigured" });
    return { ok: false, reason: "unconfigured" };
  }
  if (downloadInProgress) return { ok: false, reason: "busy" };
  downloadInProgress = true;
  sendUpdate({ type: "downloading" });
  try {
    await autoUpdater.downloadUpdate();
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  } catch (error) {
    downloadInProgress = false;
    sendUpdate({ type: "error", message: error?.message || "更新下载失败" });
    return { ok: false, reason: "failed" };
  }
}

function getToolPaths() {
  return {
    bbchannelPath: String(settings.bbchannelPath || ""),
    bbchannelCmdPath: String(settings.bbchannelCmdPath || ""),
    emulatorPath: String(settings.emulatorPath || ""),
  };
}

function getBbchannelCmdPath() {
  const dedicatedCmdPath = String(settings.bbchannelCmdPath || "").trim();
  if (extname(dedicatedCmdPath).toLowerCase() === ".cmd") return dedicatedCmdPath;
  const legacyLaunchPath = String(settings.bbchannelPath || "").trim();
  return extname(legacyLaunchPath).toLowerCase() === ".cmd" ? legacyLaunchPath : "";
}

function getBbchannelTemplateInstallStatus() {
  const cmdPath = getBbchannelCmdPath();
  if (!cmdPath || !existsSync(cmdPath)) {
    return {
      ok: false,
      needsCmd: true,
      message: "尚未获取有效的 BBC 启动 CMD。请选择 BBchannel 根目录中的启动 .cmd 文件后再导入礼装模板。",
    };
  }
  const rootDirectory = dirname(cmdPath);
  const assistRootDirectory = join(rootDirectory, "assets", "assist");
  return {
    ok: true,
    needsCmd: false,
    cmdPath,
    rootDirectory,
    assistDirectory: join(assistRootDirectory, "assist_equip"),
    checkDirectory: join(assistRootDirectory, "equip_check"),
  };
}

async function chooseBbchannelCmdPath() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "获取 BBC 启动 CMD",
    buttonLabel: "使用此启动 CMD",
    properties: ["openFile"],
    filters: [{ name: "BBchannel 启动 CMD", extensions: ["cmd"] }],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
  const cmdPath = result.filePaths[0];
  settings.bbchannelCmdPath = cmdPath;
  if (!String(settings.bbchannelPath || "").trim()) settings.bbchannelPath = cmdPath;
  saveSettings();
  return { ok: true, installStatus: getBbchannelTemplateInstallStatus(), paths: getToolPaths() };
}

async function chooseToolPath(kind) {
  if (!TOOL_KINDS.has(kind)) return { ok: false, message: "无效的程序类型" };
  const toolExtensions = kind === "bbchannel" ? ["exe", "cmd"] : ["exe"];
  const result = await dialog.showOpenDialog(mainWindow, {
    title: kind === "bbchannel" ? "选择 BBchannel 启动文件" : "选择模拟器程序",
    properties: ["openFile"],
    filters: [{ name: kind === "bbchannel" ? "BBchannel 启动文件" : "可执行程序", extensions: toolExtensions }, { name: "所有文件", extensions: ["*"] }],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
  const key = kind === "bbchannel" ? "bbchannelPath" : "emulatorPath";
  settings[key] = result.filePaths[0];
  saveSettings();
  return { ok: true, paths: getToolPaths() };
}

function openTool(kind) {
  if (!TOOL_KINDS.has(kind)) return { ok: false, message: "无效的程序类型" };
  const key = kind === "bbchannel" ? "bbchannelPath" : "emulatorPath";
  const executable = String(settings[key] || "");
  if (!executable || !existsSync(executable)) return { ok: false, message: "程序路径未设置或文件不存在，请先设置路径" };
  try {
    const spawnOptions = { detached: true, stdio: "ignore", windowsHide: true, cwd: dirname(executable) };
    const isBbchannelCmd = kind === "bbchannel" && extname(executable).toLowerCase() === ".cmd";
    // Windows 的批处理文件必须经命令解释器启动；普通 .exe 保持原有直接启动方式。
    const child = isBbchannelCmd
      ? spawn(executable, [], { ...spawnOptions, shell: true })
      : spawn(executable, [], spawnOptions);
    child.unref();
    return { ok: true };
  } catch {
    return { ok: false, message: "无法启动该程序，请检查路径与系统权限" };
  }
}

async function exportBbchannelTeamConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ok: false, message: "BBchannel 队伍配置格式无效" };
  }
  const date = new Date().toISOString().slice(0, 10);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "导出 BBchannel 队伍配置",
    defaultPath: `bbchannel-队伍配置-${date}.json`,
    filters: [{ name: "BBchannel 队伍配置", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
  try {
    writeFileSync(result.filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    return { ok: true, path: result.filePath };
  } catch {
    return { ok: false, message: "无法写入所选路径，请检查文件是否被占用或目录权限" };
  }
}

const FGO_WIKI_API = "https://fgo.wiki/api.php";

function nonEmptyText(value) {
  const result = String(value || "").trim();
  return result || "";
}

function normalizeWikiTitle(value) {
  return nonEmptyText(value)
    .toLowerCase()
    .replace(/[\s·・、，,."'“”‘’()（）\[\]〔〕【】_\-－—]/g, "");
}

function normalizeTemplateFileName(value) {
  return nonEmptyText(value)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/[.\s]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 100);
}

function decodePngDataUrl(value) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/i.exec(String(value || ""));
  if (!match) throw new Error("模板图片数据无效。");
  const buffer = Buffer.from(match[1], "base64");
  if (!buffer.length || buffer.length > 2 * 1024 * 1024) throw new Error("模板图片数据大小无效。");
  return buffer;
}

async function requestFgoWikiJson(parameters) {
  const url = new URL(FGO_WIKI_API);
  Object.entries({ action: "query", format: "json", formatversion: "2", origin: "*", ...parameters }).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`FGO Wiki 请求失败：${response.status}`);
  return response.json();
}

function fileStem(value) {
  return nonEmptyText(value)
    .replace(/^文件:/i, "")
    .replace(/\.[^.]+$/, "");
}

function selectOriginalCraftImage(page, expectedNames) {
  const images = Array.isArray(page?.images) ? page.images.map((image) => nonEmptyText(image?.title)).filter(Boolean) : [];
  const expected = new Set(expectedNames.map(normalizeWikiTitle).filter(Boolean));
  const matched = images.find((title) => expected.has(normalizeWikiTitle(fileStem(title))));
  if (!matched) throw new Error("FGO Wiki 页面中未找到与该礼装同名的原图，请改用本地原图。");
  return matched;
}

async function fetchFgoWikiCraftEssenceOriginal(craftEssence) {
  const title = nonEmptyText(craftEssence?.title);
  const names = [title, nonEmptyText(craftEssence?.name), ...(Array.isArray(craftEssence?.aliases) ? craftEssence.aliases.map(nonEmptyText) : [])].filter(Boolean);
  if (!title || !names.length) return { ok: false, message: "礼装信息不完整，无法获取 FGO Wiki 原图。" };
  try {
    const pageResult = await requestFgoWikiJson({ titles: title, prop: "images" });
    const page = pageResult?.query?.pages?.[0];
    const imageTitle = selectOriginalCraftImage(page, names);
    const imageInfoResult = await requestFgoWikiJson({ titles: imageTitle, prop: "imageinfo", iiprop: "url|size|mime" });
    const imageInfo = imageInfoResult?.query?.pages?.[0]?.imageinfo?.[0];
    const imageUrl = nonEmptyText(imageInfo?.url);
    if (!imageUrl) throw new Error("FGO Wiki 未返回礼装原图地址。");
    const imageResponse = await fetch(imageUrl);
    const contentType = nonEmptyText(imageResponse.headers.get("content-type")).toLowerCase().split(";")[0];
    if (!imageResponse.ok || !/^image\/(png|jpeg|webp)$/.test(contentType)) throw new Error("FGO Wiki 返回的礼装原图格式不受支持。");
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    if (!buffer.length || buffer.length > 12 * 1024 * 1024) throw new Error("FGO Wiki 礼装原图大小异常。");
    return {
      ok: true,
      dataUrl: `data:${contentType};base64,${buffer.toString("base64")}`,
      fileName: nonEmptyText(imageTitle).replace(/^文件:/i, ""),
      width: Number(imageInfo?.width) || 0,
      height: Number(imageInfo?.height) || 0,
    };
  } catch (error) {
    return { ok: false, message: error?.message || "获取 FGO Wiki 礼装原图失败。" };
  }
}

async function exportBbchannelEquipTemplates(templates) {
  const name = normalizeTemplateFileName(templates?.name);
  if (!name) return { ok: false, message: "BBC 模板名称无效。" };
  let assistTemplate;
  let limitBrokenCheck = null;
  let notLimitBrokenCheck = null;
  try {
    assistTemplate = decodePngDataUrl(templates?.assistTemplate);
    const hasLimitBroken = Boolean(templates?.limitBrokenCheck);
    const hasNotLimitBroken = Boolean(templates?.notLimitBrokenCheck);
    if (hasLimitBroken !== hasNotLimitBroken) return { ok: false, message: "满破与未满破校验图必须同时生成。" };
    if (hasLimitBroken) {
      limitBrokenCheck = decodePngDataUrl(templates.limitBrokenCheck);
      notLimitBrokenCheck = decodePngDataUrl(templates.notLimitBrokenCheck);
    }
  } catch (error) {
    return { ok: false, message: error?.message || "BBC 模板图片无效。" };
  }

  const installStatus = getBbchannelTemplateInstallStatus();
  if (!installStatus.ok) return installStatus;
  try {
    mkdirSync(installStatus.assistDirectory, { recursive: true });
    writeFileSync(join(installStatus.assistDirectory, `${name}.png`), assistTemplate);
    const files = [join("assist_equip", `${name}.png`)];
    if (limitBrokenCheck && notLimitBrokenCheck) {
      mkdirSync(installStatus.checkDirectory, { recursive: true });
      writeFileSync(join(installStatus.checkDirectory, `${name}_1.png`), limitBrokenCheck);
      writeFileSync(join(installStatus.checkDirectory, `${name}_0.png`), notLimitBrokenCheck);
      files.push(join("equip_check", `${name}_1.png`), join("equip_check", `${name}_0.png`));
    }
    return { ok: true, path: join(installStatus.rootDirectory, "assets", "assist"), files };
  } catch {
    return { ok: false, message: "无法写入 BBC 礼装目录，请检查 BBC 是否已退出以及目录权限。" };
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: "#eef3f3",
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: true,
    },
  });
  mainWindow.loadFile(join(__dirname, "..", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F12" && input.type === "keyDown") {
      mainWindow.webContents.toggleDevTools();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.once("did-finish-load", () => {
    setTimeout(() => { void checkForUpdates({ manual: false }); }, 700);
  });
}

app.whenReady().then(() => {
  loadSettings();
  loadUpdateConfiguration();
  configureUpdater();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

ipcMain.handle("updates:check", (_event, options) => checkForUpdates(options));
ipcMain.handle("updates:download-and-install", () => downloadAndInstall());
ipcMain.handle("updates:skip", (_event, version) => {
  settings.skippedUpdateVersion = String(version || "");
  saveSettings();
  return { ok: true };
});
ipcMain.handle("tools:get-paths", () => getToolPaths());
ipcMain.handle("tools:choose-path", (_event, kind) => chooseToolPath(kind));
ipcMain.handle("tools:open", (_event, kind) => openTool(kind));
ipcMain.handle("bbchannel:get-template-install-status", () => getBbchannelTemplateInstallStatus());
ipcMain.handle("bbchannel:choose-cmd-path", () => chooseBbchannelCmdPath());
ipcMain.handle("bbchannel:export-team-config", (_event, config) => exportBbchannelTeamConfig(config));
ipcMain.handle("fgo-wiki:fetch-craft-essence-original", (_event, craftEssence) => fetchFgoWikiCraftEssenceOriginal(craftEssence));
ipcMain.handle("bbchannel:export-equip-templates", (_event, templates) => exportBbchannelEquipTemplates(templates));

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

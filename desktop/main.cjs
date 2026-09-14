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
let updateChannel = "latest";
let updateCheckInFlight = false;
let currentCheckManual = false;
let downloadInProgress = false;
let availableUpdateVersion = "";
let downloadedUpdateVersion = "";
let downloadErrorHandled = false;

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
  const requestedChannel = String(config?.channel || "latest").trim();
  updateUrl = /^https:\/\//i.test(candidate) ? candidate.replace(/\/$/, "") : "";
  updateChannel = /^[a-z0-9][a-z0-9.-]*$/i.test(requestedChannel) ? requestedChannel : "latest";
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function sendUpdate(payload) {
  sendToRenderer("updates:event", { currentVersion: app.getVersion(), ...payload });
}

function isUpdaterRuntimeAvailable() {
  if (!autoUpdater) return false;
  if (typeof autoUpdater.isUpdaterActive !== "function") return true;
  return autoUpdater.isUpdaterActive();
}

function getUpdateStatus() {
  return {
    currentVersion: app.getVersion(),
    configured: Boolean(updateUrl),
    runtimeAvailable: isUpdaterRuntimeAvailable(),
    channel: updateChannel,
    skippedVersion: String(settings.skippedUpdateVersion || ""),
  };
}

function canCheckUpdates() {
  return Boolean(updateUrl && isUpdaterRuntimeAvailable());
}

function sendUpdateUnavailable({ manual = false } = {}) {
  if (!manual) return;
  if (!updateUrl) {
    sendUpdate({ type: "unconfigured" });
    return;
  }
  sendUpdate({ type: "unsupported" });
}

function configureUpdater() {
  if (!autoUpdater || !updateUrl) return;
  autoUpdater.autoDownload = false;
  // 下载完成后由用户决定立即重启安装，若选择稍后则在正常退出时安装。
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.setFeedURL({ provider: "generic", url: updateUrl, channel: updateChannel });

  autoUpdater.on("update-available", (info) => {
    const manual = currentCheckManual;
    updateCheckInFlight = false;
    currentCheckManual = false;
    const version = String(info?.version || "");
    availableUpdateVersion = version;
    downloadedUpdateVersion = "";
    if (!manual && settings.skippedUpdateVersion === version) return;
    sendUpdate({
      type: "available",
      manual,
      version,
      releaseNotes: info?.releaseNotes || "",
      releaseDate: info?.releaseDate || "",
    });
  });
  autoUpdater.on("update-not-available", () => {
    const manual = currentCheckManual;
    updateCheckInFlight = false;
    currentCheckManual = false;
    if (manual) sendUpdate({ type: "not-available" });
  });
  autoUpdater.on("download-progress", (progress = {}) => {
    sendUpdate({
      type: "downloading",
      version: availableUpdateVersion,
      percent: Number(progress.percent || 0),
      transferred: Number(progress.transferred || 0),
      total: Number(progress.total || 0),
      bytesPerSecond: Number(progress.bytesPerSecond || 0),
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    downloadInProgress = false;
    downloadedUpdateVersion = String(info?.version || availableUpdateVersion || "");
    sendUpdate({ type: "downloaded", version: downloadedUpdateVersion });
  });
  autoUpdater.on("error", (error) => {
    const wasDownloading = downloadInProgress;
    const manual = currentCheckManual || wasDownloading;
    if (wasDownloading) downloadErrorHandled = true;
    updateCheckInFlight = false;
    currentCheckManual = false;
    downloadInProgress = false;
    if (manual) {
      sendUpdate({
        type: "error",
        stage: wasDownloading ? "download" : "check",
        message: error?.message || (wasDownloading ? "更新下载失败" : "更新服务不可用"),
      });
    }
  });
}

async function checkForUpdates({ manual = false } = {}) {
  if (!canCheckUpdates()) {
    sendUpdateUnavailable({ manual });
    return { ok: false, reason: updateUrl ? "unsupported" : "unconfigured" };
  }
  if (updateCheckInFlight) return { ok: false, reason: "busy" };
  updateCheckInFlight = true;
  currentCheckManual = Boolean(manual);
  sendUpdate({ type: "checking", manual: currentCheckManual });
  try {
    const result = await autoUpdater.checkForUpdates();
    // electron-updater 在未打包的开发环境中会返回 null 且不触发事件；不能让手动窗口停在“正在检查”。
    if (result === null) {
      updateCheckInFlight = false;
      currentCheckManual = false;
      sendUpdateUnavailable({ manual });
      return { ok: false, reason: "unsupported" };
    }
    return { ok: true };
  } catch (error) {
    updateCheckInFlight = false;
    currentCheckManual = false;
    if (manual) sendUpdate({ type: "error", stage: "check", message: error?.message || "更新服务不可用" });
    return { ok: false, reason: "failed" };
  }
}

async function downloadUpdate() {
  if (!canCheckUpdates()) {
    sendUpdateUnavailable({ manual: true });
    return { ok: false, reason: updateUrl ? "unsupported" : "unconfigured" };
  }
  if (downloadInProgress) return { ok: false, reason: "busy" };
  downloadInProgress = true;
  downloadErrorHandled = false;
  sendUpdate({ type: "downloading", version: availableUpdateVersion, percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 });
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (error) {
    downloadInProgress = false;
    if (!downloadErrorHandled) {
      sendUpdate({ type: "error", stage: "download", message: error?.message || "更新下载失败" });
    }
    return { ok: false, reason: "failed" };
  }
}

function installDownloadedUpdate() {
  if (!downloadedUpdateVersion) return { ok: false, reason: "not-downloaded" };
  sendUpdate({ type: "installing", version: downloadedUpdateVersion });
  try {
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  } catch (error) {
    sendUpdate({ type: "error", stage: "install", message: error?.message || "无法启动更新安装程序" });
    return { ok: false, reason: "failed" };
  }
}

function getToolPaths() {
  return {
    bbchannelPath: String(settings.bbchannelPath || ""),
    emulatorPath: String(settings.emulatorPath || ""),
  };
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

ipcMain.handle("updates:status", () => getUpdateStatus());
ipcMain.handle("updates:check", (_event, options) => checkForUpdates(options));
ipcMain.handle("updates:download", () => downloadUpdate());
ipcMain.handle("updates:install", () => installDownloadedUpdate());
ipcMain.handle("updates:skip", (_event, version) => {
  settings.skippedUpdateVersion = String(version || "");
  saveSettings();
  return { ok: true };
});
ipcMain.handle("tools:get-paths", () => getToolPaths());
ipcMain.handle("tools:choose-path", (_event, kind) => chooseToolPath(kind));
ipcMain.handle("tools:open", (_event, kind) => openTool(kind));
ipcMain.handle("bbchannel:export-team-config", (_event, config) => exportBbchannelTeamConfig(config));

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

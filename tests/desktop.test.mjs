import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const desktopMainPath = new URL("../desktop/main.cjs", import.meta.url);
const preloadPath = new URL("../desktop/preload.cjs", import.meta.url);
const updateManifestScriptPath = new URL("../scripts/generate-update-manifest.mjs", import.meta.url);

test("BBchannel 可以选择并通过命令解释器启动 cmd 文件", async () => {
  const main = await readFile(desktopMainPath, "utf8");

  assert.match(main, /const \{ dirname, extname, join \} = require\("node:path"\);/);
  assert.match(main, /const toolExtensions = kind === "bbchannel" \? \["exe", "cmd"\] : \["exe"\];/);
  assert.match(main, /extensions: toolExtensions/);
  assert.match(main, /const isBbchannelCmd = kind === "bbchannel" && extname\(executable\)\.toLowerCase\(\) === "\.cmd";/);
  assert.match(main, /cwd: dirname\(executable\)/);
  assert.match(main, /isBbchannelCmd\s*\? spawn\(executable, \[\], \{ \.\.\.spawnOptions, shell: true \}\)\s*:\s*spawn\(executable, \[\], spawnOptions\)/);
});

test("桌面版通过保存对话框导出 BBchannel 队伍配置，不写入 BBchannel 原配置", async () => {
  const [main, preload] = await Promise.all([
    readFile(desktopMainPath, "utf8"),
    readFile(preloadPath, "utf8"),
  ]);

  assert.match(preload, /exportBbchannelTeamConfig: \(config\) => ipcRenderer\.invoke\("bbchannel:export-team-config", config\)/);
  assert.match(main, /async function exportBbchannelTeamConfig\(config\)/);
  assert.match(main, /dialog\.showSaveDialog\(mainWindow, \{/);
  assert.match(main, /title: "导出 BBchannel 队伍配置"/);
  assert.match(main, /filters: \[\{ name: "BBchannel 队伍配置", extensions: \["json"\] \}\]/);
  assert.match(main, /writeFileSync\(result\.filePath, `\$\{JSON\.stringify\(config, null, 2\)\}\\n`, "utf8"\)/);
  assert.match(main, /ipcMain\.handle\("bbchannel:export-team-config", \(_event, config\) => exportBbchannelTeamConfig\(config\)\)/);
  assert.doesNotMatch(main, /scripts_settings\.json/);
});


test("桌面版不再暴露 BBC 礼装制作与直接导入 IPC", async () => {
  const [main, preload] = await Promise.all([
    readFile(desktopMainPath, "utf8"),
    readFile(preloadPath, "utf8"),
  ]);

  for (const source of [main, preload]) {
    assert.doesNotMatch(source, /礼装模板/);
    assert.doesNotMatch(source, /fgo-wiki/);
    assert.doesNotMatch(source, /export-equip-templates/);
    assert.doesNotMatch(source, /get-template-install-status/);
    assert.doesNotMatch(source, /choose-cmd-path/);
  }
  assert.doesNotMatch(main, /scripts_settings\.json/);
});


test("桌面在线更新分为检测、下载与用户确认安装，并提供进度和开发环境提示", async () => {
  const [main, preload] = await Promise.all([
    readFile(desktopMainPath, "utf8"),
    readFile(preloadPath, "utf8"),
  ]);

  assert.match(main, /const requestedChannel = String\(config\?\.channel \|\| "latest"\)\.trim\(\);/);
  assert.match(main, /autoUpdater\.setFeedURL\(\{ provider: "generic", url: updateUrl, channel: updateChannel \}\);/);
  assert.match(main, /autoUpdater\.autoDownload = false;/);
  assert.match(main, /autoUpdater\.autoInstallOnAppQuit = true;/);
  assert.match(main, /autoUpdater\.on\("download-progress", \(progress = \{\}\) =>/);
  assert.match(main, /type: "downloaded", version: downloadedUpdateVersion/);
  assert.match(main, /function installDownloadedUpdate\(\)/);
  assert.match(main, /autoUpdater\.quitAndInstall\(false, true\);/);
  assert.match(main, /if \(result === null\) \{/);
  assert.match(main, /type: "unsupported"/);
  assert.match(main, /ipcMain\.handle\("updates:status", \(\) => getUpdateStatus\(\)\)/);
  assert.match(main, /ipcMain\.handle\("updates:download", \(\) => downloadUpdate\(\)\)/);
  assert.match(main, /ipcMain\.handle\("updates:install", \(\) => installDownloadedUpdate\(\)\)/);
  assert.doesNotMatch(main, /download-and-install/);

  assert.match(preload, /getUpdateStatus: \(\) => ipcRenderer\.invoke\("updates:status"\)/);
  assert.match(preload, /downloadUpdate: \(\) => ipcRenderer\.invoke\("updates:download"\)/);
  assert.match(preload, /installDownloadedUpdate: \(\) => ipcRenderer\.invoke\("updates:install"\)/);
  assert.doesNotMatch(preload, /downloadAndInstall/);
});


test("Windows 发布构建会生成包含安装包 SHA-512 的 latest.yml", async () => {
  const [packageJson, script] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(updateManifestScriptPath, "utf8"),
  ]);
  const manifest = JSON.parse(packageJson);

  assert.match(manifest.scripts["dist:win"], /electron-builder --win nsis --x64 && npm run build:update-manifest/);
  assert.equal(manifest.scripts["build:update-manifest"], "node scripts/generate-update-manifest.mjs");
  assert.match(script, /createHash\("sha512"\)/);
  assert.match(script, /resolve\(releaseDirectory, "latest\.yml"\)/);
  assert.match(script, /Setup \$\{version\}\.exe/);
  assert.match(script, /releaseDate:/);
});

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fgoDesktop", Object.freeze({
  checkForUpdates: (options = {}) => ipcRenderer.invoke("updates:check", { manual: Boolean(options.manual) }),
  getUpdateStatus: () => ipcRenderer.invoke("updates:status"),
  downloadUpdate: () => ipcRenderer.invoke("updates:download"),
  installDownloadedUpdate: () => ipcRenderer.invoke("updates:install"),
  skipUpdate: (version) => ipcRenderer.invoke("updates:skip", String(version || "")),
  getToolPaths: () => ipcRenderer.invoke("tools:get-paths"),
  chooseToolPath: (kind) => ipcRenderer.invoke("tools:choose-path", String(kind || "")),
  openTool: (kind) => ipcRenderer.invoke("tools:open", String(kind || "")),
  exportBbchannelTeamConfig: (config) => ipcRenderer.invoke("bbchannel:export-team-config", config),
  onUpdate: (listener) => {
    if (typeof listener !== "function") return () => {};
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("updates:event", wrapped);
    return () => ipcRenderer.removeListener("updates:event", wrapped);
  },
}));

/**
 * 受限 preload：只暴露桌面能力，不暴露 Node、文件系统与任意命令执行。
 */
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('bioanlysDesktop', {
  isDesktop: true,
  app: {
    getInfo: () => ipcRenderer.invoke('app:info'),
    getVersion: () => ipcRenderer.invoke('app:version'),
  },
  service: {
    status: () => ipcRenderer.invoke('service:status'),
    restart: () => ipcRenderer.invoke('service:restart'),
    onStatus: (callback) => subscribe('service:status', callback),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    isConfigured: () => ipcRenderer.invoke('settings:isConfigured'),
    dataDir: () => ipcRenderer.invoke('settings:dataDir'),
    openDataDir: () => ipcRenderer.invoke('settings:openDataDir'),
    chooseDirectory: (options) => ipcRenderer.invoke('dialog:chooseDirectory', options || {}),
    chooseFile: (options) => ipcRenderer.invoke('dialog:chooseFile', options || {}),
  },
  shell: {
    openPath: (target) => ipcRenderer.invoke('shell:openPath', target),
    showItemInFolder: (target) => ipcRenderer.invoke('shell:showItemInFolder', target),
  },
  logs: {
    recent: () => ipcRenderer.invoke('logs:recent'),
    openFolder: () => ipcRenderer.invoke('logs:openFolder'),
    onLine: (callback) => subscribe('logs:line', callback),
  },
});

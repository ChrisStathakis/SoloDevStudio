const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('solodevDesktop', {
  isDesktop: true,
  apiBase: ipcRenderer.sendSync('desktop:get-api-base'),
  getSettings: () => ipcRenderer.invoke('desktop:get-settings'),
  setBackendPort: (backendPort) => ipcRenderer.invoke('desktop:set-backend-port', backendPort),
  setCloudUrl: (cloudUrl) => ipcRenderer.invoke('desktop:set-cloud-url', cloudUrl),
  setCompanionEnabled: (enabled) => ipcRenderer.invoke('desktop:set-companion-enabled', enabled),
  updateCompanionState: (state) => ipcRenderer.send('desktop:update-companion-state', state),
  onCompanionCommand: (callback) => { const listener = (_event, command) => callback(command); ipcRenderer.on('desktop:companion-command', listener); return () => ipcRenderer.removeListener('desktop:companion-command', listener); },
});

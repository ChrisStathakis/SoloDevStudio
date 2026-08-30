const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('solodevDesktop', {
  isDesktop: true,
  apiBase: ipcRenderer.sendSync('desktop:get-api-base'),
  getSettings: () => ipcRenderer.invoke('desktop:get-settings'),
  setBackendPort: (backendPort) => ipcRenderer.invoke('desktop:set-backend-port', backendPort),
});

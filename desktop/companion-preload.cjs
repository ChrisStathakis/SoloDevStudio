const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('soloDevCompanion', {
  onState: (callback) => { const listener = (_event, state) => callback(state); ipcRenderer.on('companion:state', listener); return () => ipcRenderer.removeListener('companion:state', listener); },
  command: (command) => ipcRenderer.send('desktop:companion-command', command),
  dismiss: () => ipcRenderer.send('desktop:companion-dismiss'),
  move: (position) => ipcRenderer.send('desktop:companion-position', position),
});

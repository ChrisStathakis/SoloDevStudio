const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('soloDevCompanion', {
  onState: (callback) => { const listener = (_event, state) => callback(state); ipcRenderer.on('companion:state', listener); return () => ipcRenderer.removeListener('companion:state', listener); },
  command: (command) => ipcRenderer.send('desktop:companion-command', command),
  dismiss: () => ipcRenderer.send('desktop:companion-dismiss'),
  move: (position) => ipcRenderer.send('desktop:companion-position', position),
  setPinned: (pinned) => ipcRenderer.invoke('desktop:set-companion-pinned', pinned),
  onPinState: (callback) => { const listener = (_event, pinned) => callback(Boolean(pinned)); ipcRenderer.on('companion:pin', listener); return () => ipcRenderer.removeListener('companion:pin', listener); },
});

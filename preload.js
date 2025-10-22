const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld('electronAPI', {
  saveFloorplan: (args) => ipcRenderer.invoke('save-floorplan', args),
  openFloorplan: () => ipcRenderer.invoke('open-floorplan')
});
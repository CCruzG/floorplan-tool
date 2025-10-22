// const { app, BrowserWindow } = require('electron');
// const path = require('path');

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs/promises');
const path = require('path');

ipcMain.handle('save-floorplan', async (event, { filenameSuggested, payload }) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save Floorplan',
      defaultPath: filenameSuggested || 'floorplan.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (canceled || !filePath) {
      return { success: false };
    }

    const json = JSON.stringify(payload, null, 2);
    await fs.writeFile(filePath, json, 'utf-8');

    return { success: true, path: filePath };
  } catch (err) {
    console.error('Failed to save floorplan:', err);
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('open-floorplan', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Open Floorplan',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) {
      return { success: false };
    }

    const filePath = filePaths[0];
    const json = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(json);

    return { success: true, data, path: filePath };
  } catch (err) {
    console.error('Failed to open floorplan:', err);
    return { success: false, error: String(err) };
  }
});



function createWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.loadFile('renderer/index.html');
}

app.whenReady().then(createWindow);

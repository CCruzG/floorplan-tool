// const { app, BrowserWindow } = require('electron');
// const path = require('path');

const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');

async function renderPdfPreview(filePath) {
  return new Promise((resolve, reject) => {
    const previewWindow = new BrowserWindow({
      show: false,
      width: 1600,
      height: 2200,
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        sandbox: true,
      },
    });

    const cleanup = () => {
      if (!previewWindow.isDestroyed()) previewWindow.destroy();
    };

    const capture = async () => {
      try {
        await new Promise((ready) => setTimeout(ready, 700));
        const image = await previewWindow.webContents.capturePage();
        const size = image.getSize();
        resolve({
          mime: 'image/png',
          dataUrl: image.toDataURL(),
          naturalWidth: size.width,
          naturalHeight: size.height,
        });
      } catch (err) {
        reject(err);
      } finally {
        cleanup();
      }
    };

    previewWindow.webContents.once('did-finish-load', capture);
    previewWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
      cleanup();
      reject(new Error(`Failed to load PDF preview (${errorCode}): ${errorDescription}`));
    });

    previewWindow.loadURL(pathToFileURL(filePath).href);
  });
}

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

ipcMain.handle('save-floorplan-silent', async (event, { filePath, payload }) => {
  try {
    const json = JSON.stringify(payload, null, 2);
    await fs.writeFile(filePath, json, 'utf-8');
    return { success: true, path: filePath };
  } catch (err) {
    console.error('Failed to save floorplan silently:', err);
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

ipcMain.handle('pick-reference-asset', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import Reference Image',
      filters: [
        { name: 'Reference assets', extensions: ['pdf', 'png', 'jpg', 'jpeg'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg'] },
        { name: 'PDF', extensions: ['pdf'] },
      ],
      properties: ['openFile'],
    });

    if (canceled || filePaths.length === 0) {
      return { success: false };
    }

    const filePath = filePaths[0];
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);

    if (ext === '.pdf') {
      const preview = await renderPdfPreview(filePath);
      return {
        success: true,
        asset: {
          fileName,
          filePath,
          mime: preview.mime,
          dataUrl: preview.dataUrl,
          naturalWidth: preview.naturalWidth,
          naturalHeight: preview.naturalHeight,
        },
      };
    }

    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) {
      return { success: false, error: 'Unsupported or unreadable image file.' };
    }

    const size = image.getSize();
    const mimeByExt = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
    };
    return {
      success: true,
      asset: {
        fileName,
        filePath,
        mime: mimeByExt[ext] || 'image/png',
        dataUrl: image.toDataURL(),
        naturalWidth: size.width,
        naturalHeight: size.height,
      },
    };
  } catch (err) {
    console.error('Failed to import reference asset:', err);
    return { success: false, error: String(err) };
  }
});



function createWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    webPreferences: { 
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: true      
    },
  });
  win.loadFile('renderer/index.html');

  // Forward renderer console messages to the main process terminal so
  // logs emitted in the renderer (e.g. console.log from renderer/index.js)
  // are visible when running `npm start`.
  if (win && win.webContents && typeof win.webContents.on === 'function') {
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      // level: 0 = log, 1 = warn, 2 = error (may vary by Electron version)
      const levelStr = level === 2 ? 'ERROR' : level === 1 ? 'WARN' : 'LOG';
      console.log(`[renderer] [${levelStr}] ${message} (${sourceId}:${line})`);
    });
  }
}

app.whenReady().then(createWindow);

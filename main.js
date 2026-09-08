const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

// ── Server lifecycle ──────────────────────────────────────────────────────────

const SERVER_DIR    = path.join(__dirname, '../Project-71');
const SERVER_SCRIPT = path.join(SERVER_DIR, 'server.py');
const PYTHON_BIN    = path.join(SERVER_DIR, '.venv/bin/python');

let serverProcess = null;
let mainWin       = null;
let _appQuitting  = false;

function _broadcastStatus(status, message = '') {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('server-status', { status, message });
  }
}

function startServer() {
  if (!fsSync.existsSync(PYTHON_BIN)) {
    _broadcastStatus('error', 'Python environment not found. Run setup first.');
    return;
  }
  if (!fsSync.existsSync(SERVER_SCRIPT)) {
    _broadcastStatus('error', 'Server script not found.');
    return;
  }

  _broadcastStatus('starting');

  const proc = spawn(PYTHON_BIN, [SERVER_SCRIPT], {
    cwd: SERVER_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess = proc;
  let ready = false;

  // Flask outputs "Running on http://..." to stderr when it starts.
  // Watch both streams so we catch it regardless of Flask version.
  const checkReady = (data) => {
    const text = data.toString();
    console.log('[server]', text.trimEnd());
    if (!ready && (text.includes('Running on') || text.includes('Serving Flask'))) {
      ready = true;
      _broadcastStatus('ready');
    }
  };
  proc.stdout.on('data', checkReady);
  proc.stderr.on('data', checkReady);

  // Fallback health poll — if Flask doesn't log the expected line within 8s,
  // try the health endpoint directly before giving up.
  const fallbackTimer = setTimeout(async () => {
    if (ready) return;
    try {
      const http = require('http');
      await new Promise((resolve, reject) => {
        const req = http.get('http://127.0.0.1:5001/health', (res) => {
          if (res.statusCode === 200) { ready = true; _broadcastStatus('ready'); }
          resolve();
        });
        req.on('error', reject);
        req.setTimeout(2000, () => { req.destroy(); reject(new Error('timeout')); });
      });
    } catch {
      if (!ready) _broadcastStatus('error', 'Server did not start in time.');
    }
  }, 8000);

  proc.on('error', (err) => {
    clearTimeout(fallbackTimer);
    console.error('[server] spawn error:', err.message);
    _broadcastStatus('error', 'Failed to start optimisation server.');
    serverProcess = null;
  });

  proc.on('exit', (code, signal) => {
    clearTimeout(fallbackTimer);
    console.log(`[server] exited (code=${code}, signal=${signal})`);
    if (serverProcess === proc) serverProcess = null;
    if (!_appQuitting) _broadcastStatus('offline', 'Optimisation server stopped.');
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

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
    console.error('[main/save] FAILED:', err);
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
  mainWin = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: true,
    },
  });
  mainWin.loadFile('renderer/index.html');

  mainWin.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const levelStr = level === 2 ? 'ERROR' : level === 1 ? 'WARN' : 'LOG';
    console.log(`[renderer] [${levelStr}] ${message} (${sourceId}:${line})`);
  });

  mainWin.on('closed', () => { mainWin = null; });
}

app.whenReady().then(() => {
  createWindow();
  // Wait until the renderer has loaded before broadcasting the initial status,
  // otherwise the IPC message arrives before the listener is registered.
  mainWin.webContents.once('did-finish-load', () => startServer());
});

app.on('before-quit', () => {
  _appQuitting = true;
  stopServer();
});

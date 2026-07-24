/**
 * electronCompat.js
 *
 * Browser-native drop-in for window.electronAPI (normally injected by
 * preload.js in the Electron context). Loaded as a plain <script> before
 * the ES-module entry point so window.electronAPI is available when ui.js
 * runs. Does nothing when window.electronAPI is already defined (Electron).
 */

if (!window.electronAPI) {
  window.electronAPI = {

    // ── Save floorplan ────────────────────────────────────────────────────────
    // Returns { success, path? }
    async saveFloorplan({ filenameSuggested, payload }) {
      const json = JSON.stringify(payload, null, 2);
      const name = filenameSuggested || 'floorplan.json';

      // File System Access API (Chrome / Edge)
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: name,
            types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(json);
          await writable.close();
          return { success: true, path: handle.name };
        } catch (err) {
          if (err.name === 'AbortError') return { success: false };
          // fall through to download fallback
        }
      }

      // Fallback: trigger a browser download
      const blob = new Blob([json], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      return { success: true, path: name };
    },

    // ── Silent save (autosave) ────────────────────────────────────────────────
    // Returns { success, path? }
    async saveFloorplanSilent({ filePath, payload }) {
      try {
        const key = `floorplan_autosave:${filePath || 'default'}`;
        localStorage.setItem(key, JSON.stringify(payload));
        return { success: true, path: filePath };
      } catch {
        return { success: false };
      }
    },

    // ── Open floorplan ────────────────────────────────────────────────────────
    // Returns { success, data?, path? }
    async openFloorplan() {
      // File System Access API (Chrome / Edge)
      if (window.showOpenFilePicker) {
        try {
          const [handle] = await window.showOpenFilePicker({
            types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
            multiple: false,
          });
          const file = await handle.getFile();
          const text = await file.text();
          return { success: true, data: JSON.parse(text), path: file.name };
        } catch (err) {
          if (err.name === 'AbortError') return { success: false };
          return { success: false, error: err.message };
        }
      }

      // Fallback: hidden file input
      return new Promise((resolve) => {
        const input    = document.createElement('input');
        input.type     = 'file';
        input.accept   = '.json,application/json';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return resolve({ success: false });
          try {
            const text = await file.text();
            resolve({ success: true, data: JSON.parse(text), path: file.name });
          } catch (err) {
            resolve({ success: false, error: 'Invalid JSON file' });
          }
        };
        input.oncancel = () => resolve({ success: false });
        input.click();
      });
    },

    // ── Pick reference image ──────────────────────────────────────────────────
    // Returns { success, asset?: { fileName, filePath, mime, dataUrl, naturalWidth, naturalHeight } }
    // PDF support deferred to Phase 4 (PDF.js).
    async pickReferenceAsset() {
      return new Promise((resolve) => {
        const input    = document.createElement('input');
        input.type     = 'file';
        input.accept   = '.png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf';
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) return resolve({ success: false });

          if (file.type === 'application/pdf') {
            alert('PDF import is not yet supported in browser mode. Please use a PNG or JPG.');
            return resolve({ success: false });
          }

          const reader    = new FileReader();
          reader.onload   = (e) => {
            const dataUrl = e.target.result;
            const img     = new Image();
            img.onload    = () => resolve({
              success: true,
              asset: {
                fileName:     file.name,
                filePath:     file.name,
                mime:         file.type,
                dataUrl,
                naturalWidth:  img.naturalWidth,
                naturalHeight: img.naturalHeight,
              },
            });
            img.onerror   = () => resolve({ success: false, error: 'Could not decode image' });
            img.src       = dataUrl;
          };
          reader.onerror  = () => resolve({ success: false, error: 'Could not read file' });
          reader.readAsDataURL(file);
        };
        input.oncancel = () => resolve({ success: false });
        input.click();
      });
    },

    // ── Server status ─────────────────────────────────────────────────────────
    // Polls /health and calls callback({ status, message? }) on state changes.
    // Mirrors the Electron IPC events: starting / ready / error / offline.
    onServerStatus(callback) {
      callback({ status: 'starting' });
      let lastStatus = null;

      const poll = async () => {
        try {
          const res = await fetch('http://127.0.0.1:5001/health', {
            signal: AbortSignal.timeout(3000),
          });
          if (res.ok) {
            if (lastStatus !== 'ready') {
              lastStatus = 'ready';
              callback({ status: 'ready' });
            }
          } else {
            throw new Error(`HTTP ${res.status}`);
          }
        } catch {
          if (lastStatus !== 'error') {
            lastStatus = 'error';
            callback({ status: 'error', message: 'Cannot reach optimisation server' });
          }
        }
        setTimeout(poll, 3000);
      };

      setTimeout(poll, 1000);
    },
  };
}

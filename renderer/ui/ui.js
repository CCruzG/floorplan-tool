// renderer/ui/ui.js


import { DrawingService } from '../drawing/drawingService.js';
import { findClosestProjection, findClosestSegment, findClosestNode, findClosestEdgeProjection } from '../drawing/geometry.js';
import { FloorPlan } from '../models/FloorPlan.js'; // adjust path if needed
import { setScalePixelsPerUnit, getPixelsPerUnit, getUnitLabel } from '../../config.js';
import { validateFloorPlan } from '../models/validation.js';
import { renderPrompt } from '../models/promptRenderer.js';

// import { DrawingService, findClosestBoundaryPoint } from '../drawing/drawingService.js';


export const SNAP_TO_NODE_DIST = 10;   // pixels
export const SNAP_TO_EDGE_DIST = 8;    // pixels

function snapTo45(lastX, lastY, x, y) {
  const dx = x - lastX;
  const dy = y - lastY;
  const r = Math.hypot(dx, dy);
  if (r === 0) return { x, y };
  const angle = Math.atan2(dy, dx);
  const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: lastX + r * Math.cos(snapAngle),
    y: lastY + r * Math.sin(snapAngle)
  };
}

// Shared canvas grid display + snap settings (updated by the Canvas Grid panel)
const gridSettings = {
  snapEnabled: true,
  spacingOverride: 2, // plan units; null = auto-compute
  lineOpacity: 0.5,
};

// Returns the canvas-pixel spacing of one grid cell. Respects a manual
// spacingOverride from gridSettings; otherwise rounds to a "nice" interval
// targeting ~40 px visual spacing.
function _gridIntervalPx(fp) {
  const pxPerUnit = fp?.units?.pxPerUnit || 1;
  if (gridSettings.spacingOverride > 0) {
    return gridSettings.spacingOverride * pxPerUnit;
  }
  const raw = 40 / pxPerUnit;
  if (!isFinite(raw) || raw <= 0) return 40;
  const mag  = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * mag * pxPerUnit;
}
// Hard-snap a canvas coordinate to the nearest grid line.
function _snapGrid(coord, intervalPx) {
  return Math.round(coord / intervalPx) * intervalPx;
}

/**
 * Refresh the #inspectorPanel to show the currently selected element’s
 * properties, or an empty-state message when nothing is selected.
 */
function refreshInspector(fp, store) {
  const panel = document.getElementById('inspectorPanel');
  if (!panel) return;

  // ── Grid Point inspector ────────────────────────────────────────────────
  const selPts = fp?.selectedPoints;
  if (selPts?.size > 0) {
    const selected = (fp.Points || []).filter(p => selPts.has(p.id));
    if (selected.length === 0) { panel.innerHTML = '<p class="inspector-empty">NOTHING SELECTED</p>'; return; }
    const pxPerUnit = fp.units?.pxPerUnit || 1;
    const unitLabel = fp.units?.length || 'mm';
    const fmt = v => (v / pxPerUnit).toFixed(4);

    if (selected.length === 1) {
      const pt = selected[0];
      panel.innerHTML = [
        `<div class="inspector-header"><span class="inspector-kind">Grid Point</span></div>`,
        `<div class="inspector-body">`,
        `<div class="inspector-row"><span class="inspector-label">X</span><span class="inspector-value">${fmt(pt.x)}&nbsp;${unitLabel}</span></div>`,
        `<div class="inspector-row"><span class="inspector-label">Y</span><span class="inspector-value">${fmt(pt.y)}&nbsp;${unitLabel}</span></div>`,
        `<div class="inspector-row"><span class="inspector-label">Column</span><input id="insp-pt-column" type="checkbox"${pt.column !== false ? ' checked' : ''}></div>`,
        `<div class="inspector-row"><span class="inspector-label">Mechanical</span><input id="insp-pt-mechanical" type="checkbox"${pt.mechanical !== false ? ' checked' : ''}></div>`,
        `</div>`
      ].join('');
      panel.querySelector('#insp-pt-column').addEventListener('change', e => {
        pt.column = e.target.checked; store.update(fp);
      });
      panel.querySelector('#insp-pt-mechanical').addEventListener('change', e => {
        pt.mechanical = e.target.checked; store.update(fp);
      });
    } else {
      // Mixed-value helpers: true if all match, null if mixed
      const allColumn     = selected.every(p => p.column !== false);
      const allNotColumn  = selected.every(p => p.column === false);
      const allMech       = selected.every(p => p.mechanical !== false);
      const allNotMech    = selected.every(p => p.mechanical === false);
      panel.innerHTML = [
        `<div class="inspector-header"><span class="inspector-kind">Grid Points</span><span class="inspector-value">${selected.length} selected</span></div>`,
        `<div class="inspector-body">`,
        `<div class="inspector-row"><span class="inspector-label">Column</span>`,
        `<input id="insp-pt-column" type="checkbox"${allColumn ? ' checked' : ''}${(!allColumn && !allNotColumn) ? ' data-mixed="true"' : ''}></div>`,
        `<div class="inspector-row"><span class="inspector-label">Mechanical</span>`,
        `<input id="insp-pt-mechanical" type="checkbox"${allMech ? ' checked' : ''}${(!allMech && !allNotMech) ? ' data-mixed="true"' : ''}></div>`,
        `</div>`
      ].join('');
      // Show indeterminate state for mixed values
      const colCb = panel.querySelector('#insp-pt-column');
      const mechCb = panel.querySelector('#insp-pt-mechanical');
      if (!allColumn && !allNotColumn) colCb.indeterminate = true;
      if (!allMech && !allNotMech) mechCb.indeterminate = true;
      colCb.addEventListener('change', e => {
        selected.forEach(p => { p.column = e.target.checked; }); store.update(fp);
      });
      mechCb.addEventListener('change', e => {
        selected.forEach(p => { p.mechanical = e.target.checked; }); store.update(fp);
      });
    }
    return;
  }

  // ── Core inspector ────────────────────────────────────────────────────────
  if (fp?.selectedCore) {
    const coreWalls = (fp.Walls || []).filter(w => w.wallType === 'core');
    panel.innerHTML = [
      `<div class="inspector-header"><span class="inspector-kind">Core</span></div>`,
      `<div class="inspector-body">`,
      `<div class="inspector-row"><span class="inspector-label">Walls</span><span class="inspector-value">${coreWalls.length}</span></div>`,
      `<div class="inspector-row">`,
      `<button id="insp-core-delete" class="insp-btn insp-btn-danger">Delete Core</button>`,
      `</div>`,
      `</div>`
    ].join('');
    panel.querySelector('#insp-core-delete').addEventListener('click', () => {
      fp.deleteCore();
      store.update(fp);
    });
    return;
  }

  const sel = fp?.selectedSegment;
  if (!fp || sel == null) {
    panel.innerHTML = '<p class="inspector-empty">NOTHING SELECTED</p>';
    return;
  }

  const pxPerUnit = fp.units?.pxPerUnit || 1;
  const unitLabel = fp.units?.length || 'mm';

  const edge = fp.wall_graph.edges[sel];
  if (!edge) {
    panel.innerHTML = '<p class="inspector-empty">NOTHING SELECTED</p>';
    return;
  }

  const n1 = fp.wall_graph.nodes.find(n => n.id === edge.v1);
  const n2 = fp.wall_graph.nodes.find(n => n.id === edge.v2);
  const fmt = v => (v / pxPerUnit).toFixed(4);

  const length = (n1 && n2)
    ? Math.hypot((n2.x - n1.x) / pxPerUnit, (n2.y - n1.y) / pxPerUnit).toFixed(4)
    : '?';

  const EPS = 1;
  let wall = n1 && n2
    ? (fp.Walls || []).find(w =>
        Math.abs(w.start.x - n1.x) < EPS && Math.abs(w.start.y - n1.y) < EPS &&
        Math.abs(w.end.x   - n2.x) < EPS && Math.abs(w.end.y   - n2.y) < EPS)
    : null;

  const ensureWall = () => {
    if (!wall && n1 && n2) {
      fp.addWall(n1, n2, { wallType: 'boundary', translucent: false, locked: edge.locked || false });
      wall = fp.Walls[fp.Walls.length - 1];
    }
    return wall;
  };

  const wallType    = wall?.wallType    ?? 'boundary';
  const translucent = wall?.translucent ?? false;
  const locked      = edge.locked || false;
  const openings    = wall?.openings    ?? [];

  const openingRows = openings.map((o, i) => {
    const isWin = o.openingKind === 'window';
    return [
      `<div class="inspector-opening" data-oidx="${i}">`,
      `<select class="insp-op-kind insp-ctrl" data-oidx="${i}">`,
      `<option value="entrance"${o.openingKind === 'entrance' ? ' selected' : ''}>entrance</option>`,
      `<option value="door"${o.openingKind === 'door' ? ' selected' : ''}>door</option>`,
      `<option value="window"${o.openingKind === 'window' ? ' selected' : ''}>window</option>`,
      `<option value="opening"${o.openingKind === 'opening' ? ' selected' : ''}>opening</option>`,
      `</select>`,
      `<label class="insp-op-field">@ <input class="insp-op-t insp-ctrl" data-oidx="${i}" type="number" min="0" max="1" step="0.01" value="${o.t.toFixed(2)}"></label>`,
      `<label class="insp-op-field">w <input class="insp-op-w insp-ctrl" data-oidx="${i}" type="number" min="0" step="10" value="${o.width}"></label>`,
      isWin ? `<label class="insp-op-field">h <input class="insp-op-h insp-ctrl" data-oidx="${i}" type="number" min="0" step="10" value="${o.height}"></label>` : '',
      isWin ? `<label class="insp-op-field">sill <input class="insp-op-sill insp-ctrl" data-oidx="${i}" type="number" min="0" step="10" value="${o.sillHeight}"></label>` : '',
      `<button class="insp-op-remove insp-ctrl" data-oidx="${i}" title="Remove">&times;</button>`,
      `</div>`
    ].join('');
  }).join('');

  panel.innerHTML = [
    `<div class="inspector-header">`,
    `<span class="inspector-kind">Wall</span>`,
    `<select id="insp-wall-type" class="inspector-type-select inspector-type-${wallType}">`,
    `<option value="boundary"${wallType === 'boundary' ? ' selected' : ''}>boundary</option>`,
    `<option value="core"${wallType === 'core' ? ' selected' : ''}>core</option>`,
    `<option value="partition"${wallType === 'partition' ? ' selected' : ''}>partition</option>`,
    `</select></div>`,
    `<div class="inspector-body">`,
    `<div class="inspector-row"><span class="inspector-label">Start X</span>`,
    `<input id="insp-sx" class="inspector-coord-input" type="number" step="any" value="${n1 ? fmt(n1.x) : ''}"></div>`,
    `<div class="inspector-row"><span class="inspector-label">Start Y</span>`,
    `<input id="insp-sy" class="inspector-coord-input" type="number" step="any" value="${n1 ? fmt(n1.y) : ''}"></div>`,
    `<div class="inspector-row"><span class="inspector-label">End X</span>`,
    `<input id="insp-ex" class="inspector-coord-input" type="number" step="any" value="${n2 ? fmt(n2.x) : ''}"></div>`,
    `<div class="inspector-row"><span class="inspector-label">End Y</span>`,
    `<input id="insp-ey" class="inspector-coord-input" type="number" step="any" value="${n2 ? fmt(n2.y) : ''}"></div>`,
    `<div class="inspector-row"><span class="inspector-label">Length</span>`,
    `<span class="inspector-value">${length}\u00a0${unitLabel}</span></div>`,
    `<div class="inspector-row"><span class="inspector-label">Locked</span>`,
    `<input id="insp-locked" type="checkbox"${locked ? ' checked' : ''}></div>`,
    `<div class="inspector-row"><span class="inspector-label">Translucent</span>`,
    `<input id="insp-translucent" type="checkbox"${translucent ? ' checked' : ''}></div>`,
    `<div class="inspector-section">`,
    `<span class="inspector-label">Openings</span>`,
    `<div class="inspector-openings">${openingRows || '<span class="inspector-empty-sub">None</span>'}</div>`,
    `<div class="inspector-add-opening">`,
    `<select id="insp-new-kind"><option value="door">door</option><option value="window">window</option><option value="entrance">entrance</option><option value="opening">opening</option></select>`,
    `<label class="insp-op-field">@ <input id="insp-new-t" type="number" min="0" max="1" step="0.05" value="0.5"></label>`,
    `<label class="insp-op-field">w <input id="insp-new-w" type="number" min="0" step="10" value="1200"></label>`,
    `<button id="insp-add-op">+ Add</button>`,
    `</div></div></div>`
  ].join('');

  // ── Wire event handlers ──────────────────────────────────────────────────

  panel.querySelector('#insp-wall-type').addEventListener('change', e => {
    const w = ensureWall();
    if (w) {
      w.wallType = e.target.value;
      e.target.className = `inspector-type-select inspector-type-${w.wallType}`;
      store.update(fp);
    }
  });

  panel.querySelector('#insp-locked').addEventListener('change', e => {
    edge.locked = e.target.checked;
    const w = ensureWall();
    if (w) w.locked = e.target.checked;
    store.update(fp);
  });

  panel.querySelector('#insp-translucent').addEventListener('change', e => {
    const w = ensureWall();
    if (w) { w.translucent = e.target.checked; store.update(fp); }
  });

  const applyCoord = (node, axis, rawVal) => {
    const val = parseFloat(rawVal);
    if (isNaN(val) || !node) return;
    node[axis] = val * pxPerUnit;
    if (wall) {
      if (node.id === edge.v1) wall.start[axis] = node[axis];
      else                     wall.end[axis]   = node[axis];
    }
    store.update(fp);
  };
  const wireCoord = (id, node, axis) => {
    const el = panel.querySelector('#' + id);
    if (!el || !node) return;
    el.addEventListener('blur',    ()  => applyCoord(node, axis, el.value));
    el.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); applyCoord(node, axis, el.value); } });
  };
  wireCoord('insp-sx', n1, 'x');
  wireCoord('insp-sy', n1, 'y');
  wireCoord('insp-ex', n2, 'x');
  wireCoord('insp-ey', n2, 'y');

  panel.querySelectorAll('.insp-ctrl').forEach(el => {
    const idx = parseInt(el.dataset.oidx, 10);
    const o   = openings[idx];
    if (o === undefined) return;
    if (el.matches('.insp-op-kind')) {
      el.addEventListener('change', () => { o.openingKind = el.value; store.update(fp); });
    } else if (el.matches('.insp-op-t')) {
      el.addEventListener('change', () => { o.t = Math.max(0, Math.min(1, parseFloat(el.value) || 0)); store.update(fp); });
    } else if (el.matches('.insp-op-w')) {
      el.addEventListener('change', () => { o.width = parseFloat(el.value) || o.width; store.update(fp); });
    } else if (el.matches('.insp-op-h')) {
      el.addEventListener('change', () => { o.height = parseFloat(el.value) || o.height; store.update(fp); });
    } else if (el.matches('.insp-op-sill')) {
      el.addEventListener('change', () => { o.sillHeight = parseFloat(el.value) || 0; store.update(fp); });
    } else if (el.matches('.insp-op-remove')) {
      el.addEventListener('click', () => {
        const w = ensureWall();
        if (w) { fp.removeOpeningFromWall(w.id, o.id); store.update(fp); }
      });
    }
  });

  panel.querySelector('#insp-add-op').addEventListener('click', () => {
    const w = ensureWall();
    if (!w) return;
    const kind  = panel.querySelector('#insp-new-kind').value;
    const t     = parseFloat(panel.querySelector('#insp-new-t').value) || 0.5;
    const width = parseFloat(panel.querySelector('#insp-new-w').value) || 1200;
    fp.addOpeningToWall(w.id, t, { openingKind: kind, width });
    store.update(fp);
  });
}


function setupCanvasGridPanel(onUpdate) {
  const snapCb    = document.getElementById('cgSnapEnabled');
  const spacingIn  = document.getElementById('cgSpacing');
  const opacityIn  = document.getElementById('cgOpacity');
  const opacityPct = document.getElementById('cgOpacityPct');
  const unitLbl    = document.getElementById('cgSpacingUnit');

  // Keep spacing unit label in sync with canvas unit selector
  function syncUnit() {
    const sel = document.getElementById('canvasUnitSelect');
    if (unitLbl && sel) unitLbl.textContent = sel.value || 'm';
  }
  syncUnit();
  document.getElementById('canvasUnitSelect')?.addEventListener('change', syncUnit);

  snapCb?.addEventListener('change', () => {
    gridSettings.snapEnabled = snapCb.checked;
    onUpdate();
  });

  spacingIn?.addEventListener('input', () => {
    const v = parseFloat(spacingIn.value);
    gridSettings.spacingOverride = (isFinite(v) && v > 0) ? v : null;
    onUpdate();
  });

  opacityIn?.addEventListener('input', () => {
    gridSettings.lineOpacity = parseInt(opacityIn.value, 10) / 100;
    if (opacityPct) opacityPct.textContent = `${opacityIn.value}%`;
    onUpdate();
  });
}

export function bindUI(store, canvas, mouse) {
  const ctx = canvas.getContext('2d');
  // initialize Canvas Grid panel controls
  setupCanvasGridPanel(() => store.notify());

  // Floating palette drag support
  const palette = document.getElementById('toolPalette');
  const paletteTitle = palette?.querySelector('.palette-title');
  if (palette && paletteTitle) {
    let dragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    const onPointerMove = (e) => {
      if (!dragging) return;
      const x = e.clientX - dragOffsetX;
      const y = e.clientY - dragOffsetY;
      palette.style.left = `${x}px`;
      palette.style.top = `${y}px`;
    };

    const onPointerUp = () => {
      dragging = false;
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };

    paletteTitle.addEventListener('pointerdown', (e) => {
      const rect = palette.getBoundingClientRect();
      dragging = true;
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    });
  }

  // Redraw on store change
  store.onChange(() => {
    // console.log("store.mode: " + store.mode);
    DrawingService.render(ctx, store.active, {
      mode: store.mode,
      showVertices: true,
      ghost: mouse,
      constrain: mouse.constrain,
      tempArea: store.tempAreaActive ? store.tempArea : null,
      tempCore: store.tempCoreActive ? store.tempCore : null,
      // In area/core mode we should not show or highlight selected segments
      selectedSegment: (store.mode === 'area' || store.mode === 'core') ? null : store.active.selectedSegment,
      gridSettings,
    });

    const indicator = document.getElementById('canvasModeIndicator');
    if (indicator) {
      indicator.textContent = `Mode: ${store.mode}`;
    }

    // Show/hide finishCoreBtn depending on current mode
    const finishCoreBtn = document.getElementById('finishCoreBtn');
    if (finishCoreBtn) {
      finishCoreBtn.style.display = store.mode === 'core' ? '' : 'none';
    }

    // Highlight active mode button in tool palette
    const modeButtonMap = {
      select:      'selectModeBtn',
      draw:        'drawModeBtn',
      area:        'areaModeBtn',
      core:        'coreModeBtn',
      'grid-origin': null,
      door:        'entranceModeBtn',
    };
    Object.entries(modeButtonMap).forEach(([mode, id]) => {
      if (!id) return;
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle('active', store.mode === mode);
    });

    // Refresh inspector panel for the selected element
    refreshInspector(store.active, store);

    // Update JSON panel
    const jsonEl = document.getElementById('jsonOutput');
    if (jsonEl && store.active) {
      jsonEl.textContent = JSON.stringify(store.active.toJSON(), null, 2);
    }
  });

  // Mode controls (example buttons)
  const selectBtn = document.getElementById('selectModeBtn');
  if (selectBtn) {
    selectBtn.addEventListener('click', () => {
      store.setMode('select');
      store.notify();
    });
  }

  const drawBtn = document.getElementById('drawModeBtn');
  if (drawBtn) {
    drawBtn.addEventListener('click', () => {
      store.setMode('draw');
      store.notify();
    });
  }

  const areaBtn = document.getElementById('areaModeBtn');
  if (areaBtn) {
    areaBtn.addEventListener('click', () => {
      store.setMode("area");
      store.tempAreaActive = true;
      store.notify();
    });
  }

  // Add Core mode button
  const coreBtn = document.getElementById('coreModeBtn');
  if (coreBtn) {
    coreBtn.addEventListener('click', () => {
      store.setMode("core");
      store.tempCoreActive = true;
      store.notify();
    });
  }

  // Lock button - toggle lock on selected segment
  const lockBtn = document.getElementById('lockBtn');
  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      if (store.mode === "select") {
        const seg = store.active.selectedSegment;
        if (seg != null) {
          const edge = store.active.wall_graph.edges[seg];
          edge.locked = !edge.locked;
          store.update(store.active);
          console.log("Segment lock toggled", store.active.wall_graph.edges[seg].locked);
        }
      }
    });
  }

  // Place Door button — activate door placement mode (wall can be selected before or after)
  const placeDoorBtn = document.getElementById('entranceModeBtn');
  if (placeDoorBtn) {
    placeDoorBtn.addEventListener('click', () => {
      store.setMode('door');
      store.notify();
    });
  }

  // Track mouse movement and constraint flag (Shift key)
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
    // We only read modifier state during movement for visual cue
    mouse.constrain = e.shiftKey;

    // Apply grid snapping to the ghost position in draw/door/core modes
    // (node/edge snaps still override via the ghost renderers)
    if ((store.mode === 'draw' || store.mode === 'door' || store.mode === 'core') && gridSettings.snapEnabled) {
      const gip = _gridIntervalPx(store.active);
      mouse.x = _snapGrid(mouse.x, gip);
      mouse.y = _snapGrid(mouse.y, gip);
    }

    // Cursor feedback for snapping
    let isSnapping = false;
    if (store.mode === "area") {
      const nodeSnap = findClosestNode(store.active, { x: mouse.x, y: mouse.y }, SNAP_TO_NODE_DIST);
      const areaSnap = nodeSnap ? null : findClosestAreaVertex(store.active, { x: mouse.x, y: mouse.y }, SNAP_TO_NODE_DIST);
      const edgeSnap = (nodeSnap || areaSnap) ? null : findClosestEdgeProjection(store.active, { x: mouse.x, y: mouse.y }, SNAP_TO_EDGE_DIST);
      isSnapping = !!(nodeSnap || areaSnap || edgeSnap);
    } else if (store.mode === "core") {
      const nodeSnap = findClosestNode(store.active, { x: mouse.x, y: mouse.y }, SNAP_TO_NODE_DIST);
      const edgeSnap = nodeSnap ? null : findClosestEdgeProjection(store.active, { x: mouse.x, y: mouse.y }, SNAP_TO_EDGE_DIST);
      isSnapping = !!(nodeSnap || edgeSnap);
    } else if (store.mode === "draw") {
      const proj = findClosestProjection(store.active, { x: mouse.x, y: mouse.y });
      isSnapping = !!(proj && Math.hypot(mouse.x - proj.x, mouse.y - proj.y) < 10);
    }

    canvas.classList.toggle('cursor-snap', isSnapping);
    canvas.classList.toggle('cursor-default', !isSnapping);
    store.notify(); // trigger a repaint to update ghost
  });

  canvas.addEventListener('mousedown', (e) => {
    if (store.mode === "select" && store.active.selectedSegment) {
      const rect = canvas.getBoundingClientRect();
      store.dragStart = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
      store.active.draggingSegment = store.active.selectedSegment;
    }
  });

  canvas.addEventListener('mouseup', () => {
    if (store.mode === "select" && store.active) {
      store.active.draggingSegment = null;
      store.dragStart = null;
      store.update(store.active); // commit final state
    }
  });

  document.getElementById("finishAreaBtn").addEventListener("click", () => {
    if (store.mode === "area") {
      commitArea(store);
    }
  });

  document.getElementById("finishCoreBtn").addEventListener("click", () => {
    if (store.mode === "core") {
      commitCore(store);
    }
  });

  canvas.addEventListener('click', (e) => {
    if (!store.active) return;

    const rect = canvas.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    // GRID ORIGIN PICKING MODE
    if (store.mode === 'grid-origin') {
      // Snap to nearest wall node (vertex endpoint)
      const nodes = store.active.wall_graph?.nodes || [];
      let best = null, bestDist = 20;
      nodes.forEach(n => {
        const d = Math.hypot(x - n.x, y - n.y);
        if (d < bestDist) { bestDist = d; best = n; }
      });
      if (!best) return; // no nearby node — ignore click
      const origin = { x: best.x, y: best.y };
      const spacing = store._pendingGridSpacing || 1000;
      const gridPoints = store.active.generateGrid(spacing, origin);
      if (gridPoints?.length > 0) {
        store.active.setLayerVisibility('Points', true);
        const originDisplay = document.getElementById('gridOriginDisplay');
        if (originDisplay) originDisplay.textContent = `Origin: (${best.x.toFixed(1)}, ${best.y.toFixed(1)}) — ${gridPoints.length} pts`;
        store.update(store.active);
        console.log(`Grid generated: ${gridPoints.length} points from origin`, origin);
      } else {
        alert('No grid points generated. Check that the origin is near validly-closed boundary.');
      }
      store.setMode('select');
      return;
    }

    if (store.mode === "area") {
      const rect = canvas.getBoundingClientRect();
      let x = e.clientX - rect.left;
      let y = e.clientY - rect.top;

      // Prefer node snap, then area vertex snap, then edge projection
      const nodeSnap = findClosestNode(store.active, { x, y }, SNAP_TO_NODE_DIST);
      const areaSnap = nodeSnap ? null : findClosestAreaVertex(store.active, { x, y }, SNAP_TO_NODE_DIST);
      const edgeSnap = (nodeSnap || areaSnap) ? null : findClosestEdgeProjection(store.active, { x, y }, SNAP_TO_EDGE_DIST);

      const constrain = e.shiftKey;
      // Determine previous temp point coordinates (if any) for constrain logic
      let last = store.tempArea.length ? store.tempArea[store.tempArea.length - 1] : null;
      let lastX = null, lastY = null;
      if (last) {
        if (typeof last === 'string') {
          const n = store.active.wall_graph.nodes.find(n => n.id === last);
          if (n) { lastX = n.x; lastY = n.y; }
        } else if (Array.isArray(last)) {
          lastX = last[0]; lastY = last[1];
        }
      }

      if (nodeSnap) {
        // If constrained, store coords aligned to the previous point (cannot
        // be represented as a node id anymore). If not constrained, store
        // the node id so it stays linked to the wall graph.
        const nx = nodeSnap.x, ny = nodeSnap.y;
        // Resolve the actual node id from the index returned by findClosestNode
        const nodeObj = store.active.wall_graph.nodes[nodeSnap.index];
        const nodeId = nodeObj ? nodeObj.id : null;
        store.tempAreaLastSnap = { ...nodeSnap, id: nodeId };
        if (constrain && lastX != null && lastY != null) {
          // Align either horizontally or vertically relative to last
          const snapped = snapTo45(lastX, lastY, nx, ny);
          x = snapped.x; y = snapped.y;
          store.tempArea.push([x, y]);
          console.log("Snapped to node (constrained)", nodeSnap, "->", [x, y]);
        } else {
          x = nx; y = ny;
          console.log("Snapped to node", nodeSnap);
          // push the resolved node id so the area stays linked to the wall graph
          if (nodeId) store.tempArea.push(nodeId);
          else store.tempArea.push([x, y]);
        }
      } else if (areaSnap) {
        const ax = areaSnap.x, ay = areaSnap.y;
        store.tempAreaLastSnap = areaSnap;
        if (constrain && lastX != null && lastY != null) {
          const snapped = snapTo45(lastX, lastY, ax, ay);
          x = snapped.x; y = snapped.y;
          store.tempArea.push([x, y]);
          console.log("Snapped to area vertex (constrained)", areaSnap, "->", [x, y]);
        } else {
          x = ax; y = ay;
          store.tempArea.push([x, y]);
          console.log("Snapped to area vertex", areaSnap);
        }
      } else if (edgeSnap) {
        const ex = edgeSnap.x, ey = edgeSnap.y;
        store.tempAreaLastSnap = edgeSnap;
        if (constrain && lastX != null && lastY != null) {
          const snapped = snapTo45(lastX, lastY, ex, ey);
          x = snapped.x; y = snapped.y;
          store.tempArea.push([x, y]);
          console.log("Snapped to edge (constrained)", edgeSnap, "->", [x, y]);
        } else {
          x = ex; y = ey;
          store.tempArea.push([x, y]);
          console.log("Snapped to edge projection", edgeSnap);
        }
      } else {
        store.tempAreaLastSnap = null;
        if (constrain && lastX != null && lastY != null) {
          const snapped = snapTo45(lastX, lastY, x, y);
          x = snapped.x; y = snapped.y;
          console.log('Constrained free point ->', [x, y]);
        }
        store.tempArea.push([x, y]);
      }

      store.tempAreaActive = true;

      // If clicking close to the first temp vertex, close the polygon
      // to match the boundary drawing UX (click the first point to close)
      if (store.tempArea.length >= 3) {
        const first = store.tempArea[0];
        let fx, fy;
        if (typeof first === 'string') {
          const n = store.active.wall_graph.nodes.find(n => n.id === first);
          if (n) { fx = n.x; fy = n.y; }
        } else if (Array.isArray(first)) {
          fx = first[0]; fy = first[1];
        }

        if (fx != null && fy != null) {
          const dx = Math.hypot(x - fx, y - fy);
          if (dx < SNAP_TO_NODE_DIST) {
            // Close and commit the area just like the boundary
            commitArea(store);
            refreshAreasList(store);
            store.setMode('select');
            store.update(store.active);
            return;
          }
        }
      }

      store.notify();
      return;
    }

    // CORE MODE: similar to area drawing but for core boundaries
    if (store.mode === "core") {
      const rect = canvas.getBoundingClientRect();
      let x = e.clientX - rect.left;
      let y = e.clientY - rect.top;
      // Prefer node snap, then edge projection
      const nodeSnap = findClosestNode(store.active, { x, y }, SNAP_TO_NODE_DIST);
      const edgeSnap = nodeSnap ? null : findClosestEdgeProjection(store.active, { x, y }, SNAP_TO_EDGE_DIST);

      // Determine if the user requested constraint (Shift) to force
      // orthogonal (horizontal/vertical) alignment relative to the
      // previous tempCore vertex.
      const constrain = e.shiftKey;

      // Coordinates of the previous temp point (if any)
      const last = store.tempCore.length ? store.tempCore[store.tempCore.length - 1] : null;
      const lastX = last ? last[0] : null;
      const lastY = last ? last[1] : null;

      if (nodeSnap) {
        const nx = nodeSnap.x, ny = nodeSnap.y;
        store.tempCoreLastSnap = nodeSnap;
        if (constrain && lastX != null && lastY != null) {
          const snapped = snapTo45(lastX, lastY, nx, ny);
          x = snapped.x; y = snapped.y;
          console.log("Core: Snapped to node (constrained)", nodeSnap, "->", [x, y]);
        } else {
          x = nx; y = ny;
          console.log("Core: Snapped to node", nodeSnap);
        }
      } else if (edgeSnap) {
        const ex = edgeSnap.x, ey = edgeSnap.y;
        store.tempCoreLastSnap = edgeSnap;
        if (constrain && lastX != null && lastY != null) {
          const snapped = snapTo45(lastX, lastY, ex, ey);
          x = snapped.x; y = snapped.y;
          console.log("Core: Snapped to edge (constrained)", edgeSnap, "->", [x, y]);
        } else {
          x = ex; y = ey;
          console.log("Core: Snapped to edge projection", edgeSnap);
        }
      } else {
        store.tempCoreLastSnap = null;
        // Apply grid snap before optional 45° constraint
        if (gridSettings.snapEnabled && !constrain) {
          const gip = _gridIntervalPx(store.active);
          x = _snapGrid(x, gip);
          y = _snapGrid(y, gip);
        }
        if (constrain && lastX != null && lastY != null) {
          const snapped = snapTo45(lastX, lastY, x, y);
          x = snapped.x; y = snapped.y;
          console.log('Core: Constrained free point ->', [x, y]);
        }
      }

      store.tempCore.push([x, y]);
      store.tempCoreActive = true;

      // If clicking close to the first temp vertex, close the core boundary
      if (store.tempCore.length >= 3) {
        const first = store.tempCore[0];
        const fx = first[0], fy = first[1];
        const dx = Math.hypot(x - fx, y - fy);
        if (dx < SNAP_TO_NODE_DIST) {
          // Close and commit the core boundary
          commitCore(store);
          store.setMode('select');
          store.update(store.active);
          return;
        }
      }

      store.notify();
      return;
    }

    // SELECT MODE: select segment and return
    if (store.mode === "select") {
      // Check for nearby grid point first (within 8px)
      const pts = store.active.Points || [];
      let nearPt = null, nearDist = 8;
      pts.forEach(p => { const d = Math.hypot(x - p.x, y - p.y); if (d < nearDist) { nearDist = d; nearPt = p; } });
      if (nearPt) {
        store.active.selectedSegment = null;
        if (!store.active.selectedPoints) store.active.selectedPoints = new Set();
        if (e.shiftKey) {
          // Toggle this point in/out of the multi-selection
          if (store.active.selectedPoints.has(nearPt.id)) {
            store.active.selectedPoints.delete(nearPt.id);
          } else {
            store.active.selectedPoints.add(nearPt.id);
          }
        } else {
          // Plain click — replace selection with just this point
          store.active.selectedPoints = new Set([nearPt.id]);
        }
        store.active.selectedPoint = nearPt.id; // keep legacy compat
        store.update(store.active);
        return;
      }
      const seg = findClosestSegment(store.active, { x, y });
      if (seg) {
        store.active.selectedPoints = new Set();
        store.active.selectedPoint = null;
        store.active.selectedCore = false;
        if (seg.index === store.active.selectedSegment) {
          // Second click on the already-selected segment → split it
          // Snap the split point to the grid if snapping is enabled
          let sx = x, sy = y;
          if (gridSettings.snapEnabled) {
            const gip = _gridIntervalPx(store.active);
            sx = _snapGrid(x, gip);
            sy = _snapGrid(y, gip);
          }
          store.active.splitEdge(seg.index, sx, sy);
        } else {
          store.active.selectSegment(seg);
        }
        store.update(store.active);
      } else {
        // Check if the click lands inside the core polygon → select the whole core
        const coreBdry = (store.active.Core_Boundary || [])[0];
        const corePoly = coreBdry
          ? Object.keys(coreBdry)
              .filter(k => /^Pt_\d+$/.test(k))
              .sort((a, b) => parseInt(a.slice(3)) - parseInt(b.slice(3)))
              .map(k => coreBdry[k])
          : [];
        if (corePoly.length >= 3 && store.active._isPointInPolygon(x, y, corePoly)) {
          store.active.selectedCore = true;
          store.active.selectedSegment = null;
          store.active.selectedPoints = new Set();
          store.active.selectedPoint = null;
          store.update(store.active);
        } else {
          store.active.clearSelection();
          store.update(store.active);
        }
      }
      return;
    }

    // ENTRANCE MODE - Now supports multiple entrances
    if (store.active.boundaryClosed && store.mode === "entrance") {
      const closest = DrawingService.findClosestBoundaryPoint(store.active, { x, y });
      if (closest) {
        store.active.addEntrance(closest.edgeId, closest.x, closest.y);
        store.update(store.active);
        console.log("Entrance added at", closest);
        // Don't auto-switch to edit mode, allow adding more entrances
        console.log(`Total entrances: ${store.active.entrances.length}`);
      }
      return;
    }

    // DOOR PLACEMENT MODE — place a door opening on the selected wall
    if (store.mode === 'door') {
      // If no wall is selected yet, pick the nearest one from the click position
      let seg = store.active.selectedSegment;
      if (seg == null) {
        const nearest = findClosestSegment(store.active, { x, y }, 20);
        if (!nearest) return; // clicked nowhere near a wall — ignore
        store.active.selectSegment(nearest);
        seg = nearest.index;
      }
      const edge = store.active.wall_graph.edges[seg];
      if (!edge) return;
      const n1 = store.active.wall_graph.nodes.find(n => n.id === edge.v1);
      const n2 = store.active.wall_graph.nodes.find(n => n.id === edge.v2);
      if (!n1 || !n2) return;

      const dx = n2.x - n1.x, dy = n2.y - n1.y;
      const len2 = dx * dx + dy * dy || 1;
      const edgeLen = Math.sqrt(len2);
      // Door width: 1200 mm converted to canvas pixels, capped at 80% of wall
      const _pxU  = store.active.units?.pxPerUnit || 1;
      const _mmPU = store.active.units?.length === 'm' ? 1000 : 1;
      const doorWidthPx = Math.min((1200 / _mmPU) * _pxU, edgeLen * 0.8);
      const hw = doorWidthPx / 2;
      let t = ((x - n1.x) * dx + (y - n1.y) * dy) / len2;
      t = Math.max(hw / edgeLen, Math.min(1 - hw / edgeLen, t));

      // Find or create the Wall object for this edge
      const EPS = 1;
      let wall = store.active.Walls?.find(w =>
        Math.abs(w.start.x - n1.x) < EPS && Math.abs(w.start.y - n1.y) < EPS &&
        Math.abs(w.end.x   - n2.x) < EPS && Math.abs(w.end.y   - n2.y) < EPS);
      if (!wall) {
        store.active.addWall(n1, n2, { wallType: 'boundary', locked: !!edge.locked });
        wall = store.active.Walls[store.active.Walls.length - 1];
      }

      store.active.addOpeningToWall(wall.id, t, { openingKind: 'door', width: 1200 }); // width in mm
      store.update(store.active);
      return;
    }

    // DRAW MODE: boundary creation
    const drawConstrain = e.shiftKey;

    // Apply grid snap as baseline (node/projection snap will override if closer)
    if (!drawConstrain && gridSettings.snapEnabled) {
      const gip = _gridIntervalPx(store.active);
      x = _snapGrid(x, gip);
      y = _snapGrid(y, gip);
    }

    if (drawConstrain && store.active.wall_graph.nodes.length > 0) {
      const lastNode = store.active.wall_graph.nodes[store.active.wall_graph.nodes.length - 1];
      const snapped = snapTo45(lastNode.x, lastNode.y, x, y);
      x = snapped.x;
      y = snapped.y;
    }

    if (store.active.wall_graph.nodes.length > 0) {
      const first = store.active.wall_graph.nodes[0];
      const fx = first.x;
      const fy = first.y;
      const dist = Math.hypot(x - fx, y - fy);
      if (dist < 10) {
        // Close the boundary without adding a duplicate vertex
        store.active.closeBoundary();
        store.update(store.active);
        console.log("Boundary closed");
        store.setMode("select");
        return;
      }
    }

    // Projection snapping (only when not constraining to 45°)
    if (!drawConstrain) {
      const proj = findClosestProjection(store.active, { x, y });
      if (proj && Math.hypot(x - proj.x, y - proj.y) < 10) {
        x = proj.x;
        y = proj.y;
        console.log("Snapped to projection", proj);
      }
    }

    // Add vertex to boundary
    store.active.addVertex(x, y, { constrain: drawConstrain });
    store.update(store.active);
  });


  // Undo/redo shortcuts as before
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      if (e.shiftKey) store.redo();
      else store.undo();
    }
  });

  // Lock/unlock segment: L key
  window.addEventListener('keydown', (e) => {
    if (store.mode === "select" && e.key.toLowerCase() === 'l') {
      const seg = store.active.selectedSegment;
      console.log("Testing L key. Segment: ", seg)
      if (seg != null) {
        console.log("Segment: ", seg);
        const edge = store.active.wall_graph.edges[seg];
        edge.locked = !edge.locked;
        store.update(store.active);
        // console.log("Segment lock toggled", seg.locked);
        console.log("Segment lock toggled", store.active.wall_graph.edges[seg].locked);
      }
    }
  });

  // Delete core: Delete or Backspace key
  window.addEventListener('keydown', (e) => {
    if (store.mode === 'select' && (e.key === 'Delete' || e.key === 'Backspace')) {
      if (store.active.selectedCore) {
        store.active.deleteCore();
        store.update(store.active);
      }
    }
  });

  // Finish polygon: Enter or double-click
  window.addEventListener('keydown', (e) => {
    if (store.mode === "area" && e.key === "Enter") {
      commitArea(store);
      refreshAreasList(store);
    }
    // Core mode keyboard support
    if (store.mode === "core" && e.key === "Enter") {
      commitCore(store);
    }
    // Escape in select mode deselects everything
    if (store.mode === "select" && e.key === "Escape") {
      store.active.clearSelection();
      store.update(store.active);
    }
    // Optional: Esc to cancel
    if (store.mode === "area" && e.key === "Escape") {
      store.resetTempArea();
    }
    if (store.mode === "core" && e.key === "Escape") {
      store.resetTempCore();
    }
    if (store.mode === "entrance" && e.key === "Escape") {
      store.setMode("select");
      console.log("Exited entrance mode");
    }
    if (store.mode === "door" && e.key === "Escape") {
      store.setMode("select");
    }
    if (store.mode === "grid-origin" && e.key === "Escape") {
      store.setMode("select");
      const originDisplay = document.getElementById('gridOriginDisplay');
      if (originDisplay) originDisplay.textContent = '';
    }
  });

  canvas.addEventListener('dblclick', () => {
    if (store.mode === "area") {
      commitArea(store);
    }
    if (store.mode === "core") {
      commitCore(store);
    }
  });

  // Right-click to exit entrance mode
  canvas.addEventListener('contextmenu', (e) => {
    if (store.mode === "entrance") {
      e.preventDefault(); // Prevent context menu
      store.setMode("select");
      console.log("Exited entrance mode (right-click)");
    }
  });

  // 👉 Add Clear button listener here
  const clearBtn = document.getElementById('clearBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      store.active = new FloorPlan();   // reset to a new empty plan
      store.setMode("draw");
      store.update(store.active);       // trigger re-render
      console.log("Canvas cleared, new floorplan started");
    });
  }

  // ═══════════════════════════════════════════════════════════
  // GRID GENERATION CONTROLS
  // ═══════════════════════════════════════════════════════════
  
  const generateGridBtn = document.getElementById('generateGridBtn');
  const clearGridBtn    = document.getElementById('clearGridBtn');
  const gridSpacingInput = document.getElementById('gridSpacingInput');
  const gridOriginDisplay = document.getElementById('gridOriginDisplay');

  if (generateGridBtn) {
    generateGridBtn.addEventListener('click', () => {
      if (!store.active) return;
      if (!store.active.boundaryClosed) {
        alert('Draw and close a boundary before generating a grid.');
        return;
      }
      const spacing = parseFloat(gridSpacingInput?.value || 1000);
      if (spacing <= 0) { alert('Grid spacing must be greater than 0'); return; }
      // Enter origin-picking mode
      store._pendingGridSpacing = spacing;
      store.setMode('grid-origin');
      if (gridOriginDisplay) gridOriginDisplay.textContent = 'Click a wall node to set origin…';
      store.notify();
    });
  }
  
  if (clearGridBtn) {
    clearGridBtn.addEventListener('click', () => {
      if (!store.active) return;
      
      store.active.clearGrid();
      store.update(store.active);
      console.log('Grid cleared');
    });
  }

  // ═══════════════════════════════════════════════════════════
  // LAYER TOGGLE CONTROLS
  // ═══════════════════════════════════════════════════════════
  
  const layerCheckboxes = {
    planBoundaryLayer: 'Plan_Boundary',
    boundaryAreaLayer: 'Boundary_Area',
    coreBoundaryLayer: 'Core_Boundary',
    coreAreaLayer: 'Core_Area',
    columnsLayer: 'Columns',
    exclusionAreasLayer: 'Exclusion_Areas',
    beamsLayer: 'Beams',
    pointsLayer: 'Points',
    edgesLayer: 'Edges',
    ductsLayer: 'Ducts',
    ductPlanLayer: 'Duct_Plan'
  };

  Object.entries(layerCheckboxes).forEach(([checkboxId, layerName]) => {
    const checkbox = document.getElementById(checkboxId);
    if (checkbox) {
      // Set initial state - use default if store.active is null
      checkbox.checked = store.active?.layers?.[layerName] ?? (layerName === 'Plan_Boundary' || layerName === 'Boundary_Area' || layerName === 'Core_Boundary' || layerName === 'Core_Area' || layerName === 'Columns' || layerName === 'Exclusion_Areas');
      
      // Add event listener
      checkbox.addEventListener('change', () => {
        if (store.active) {
          console.log(`Before: Layer ${layerName} = ${store.active.layers?.[layerName]}`);
          store.active.setLayerVisibility(layerName, checkbox.checked);
          console.log(`After: Layer ${layerName} = ${store.active.layers?.[layerName]}, checkbox = ${checkbox.checked}`);
          
          // Mark this checkbox as the one that triggered the change
          checkbox._justChanged = true;
          store.notify(); // Trigger re-render
          // Clear the flag after a short delay
          setTimeout(() => { checkbox._justChanged = false; }, 10);
        }
      });
    }
  });

  // Update layer checkboxes when store changes (e.g., after loading a file)
  store.onChange(() => {
    Object.entries(layerCheckboxes).forEach(([checkboxId, layerName]) => {
      const checkbox = document.getElementById(checkboxId);
      // Skip updating if this checkbox just triggered the change
      if (checkbox && !checkbox._justChanged && store.active && store.active.layers && layerName in store.active.layers) {
        checkbox.checked = store.active.layers[layerName];
      }
    });
  });

  // Save floorplan: serialise and send to main via preload API
  const saveFloorplanBtn = document.getElementById("saveFloorplanBtn");
  if (saveFloorplanBtn) {
    saveFloorplanBtn.addEventListener("click", async () => {
      if (!store.active) return;
      const data = store.active.toJSON();

      try {
        const result = await window.electronAPI.saveFloorplan({
          filenameSuggested: `floorplan-${store.active.name}.json`,
          payload: data
        });
        if (result?.success) {
          console.log("Floorplan saved:", result.path);
        } else {
          console.warn("Save cancelled or failed.");
        }
      } catch (err) {
        console.error("Save error:", err);
      }
    });
  }

  const openFloorplanBtn = document.getElementById("openFloorplanBtn");
  if (openFloorplanBtn) {
    openFloorplanBtn.addEventListener("click", async () => {
      try {
        const result = await window.electronAPI.openFloorplan();
        if (result?.success) {
          const fp = FloorPlan.fromJSON(result.data);
          // If the loaded file contains a Plan_Boundary (raw Pt_* keyed objects),
          // create a boundaryArea so the renderer (which draws boundaryArea) will
          // display the plan boundary immediately. This is a forgiving, schema-
          // agnostic approach to visualise legacy duct_plan.json files "as-is".
          try {
            const raw = result.data;
            if (!fp.boundaryArea && raw.Plan_Boundary && Array.isArray(raw.Plan_Boundary) && raw.Plan_Boundary.length) {
              // Normalize Plan_Boundary coordinates (assumed to be in mm) into
              // a 0..50000 coordinate space so large real-world values render
              // sensibly on the canvas. We preserve aspect ratio by scaling
              // uniformly to fit the largest dimension into 50000.
              const poly = raw.Plan_Boundary[0];
              const keys = Object.keys(poly || {}).sort((a, b) => {
                const ai = parseInt(a.split('_')[1] || '0', 10);
                const bi = parseInt(b.split('_')[1] || '0', 10);
                return ai - bi;
              });
              // Read raw coords (units as stored in the file, e.g., mm)
              const rawCoords = keys.map(k => poly[k]).filter(Boolean).map(v => [ Number(v[0] || 0), Number(v[1] || 0) ]).filter(c => !Number.isNaN(c[0]) && !Number.isNaN(c[1]));
              
              // Also extract Core_Boundary if present
              let rawCoreCoords = [];
              if (raw.Core_Boundary && Array.isArray(raw.Core_Boundary) && raw.Core_Boundary.length) {
                const corePoly = raw.Core_Boundary[0];
                const coreKeys = Object.keys(corePoly || {}).sort((a, b) => {
                  const ai = parseInt(a.split('_')[1] || '0', 10);
                  const bi = parseInt(b.split('_')[1] || '0', 10);
                  return ai - bi;
                });
                rawCoreCoords = coreKeys.map(k => corePoly[k]).filter(Boolean).map(v => [ Number(v[0] || 0), Number(v[1] || 0) ]).filter(c => !Number.isNaN(c[0]) && !Number.isNaN(c[1]));
              }

              // Also extract Columns if present
              let rawColumnsData = [];
              if (raw.Columns && Array.isArray(raw.Columns)) {
                rawColumnsData = raw.Columns.map(column => {
                  const keys = Object.keys(column || {}).sort((a, b) => {
                    const ai = parseInt(a.split('_')[1] || '0', 10);
                    const bi = parseInt(b.split('_')[1] || '0', 10);
                    return ai - bi;
                  });
                  return keys.map(k => column[k]).filter(Boolean).map(v => [ Number(v[0] || 0), Number(v[1] || 0) ]).filter(c => !Number.isNaN(c[0]) && !Number.isNaN(c[1]));
                }).filter(columnCoords => columnCoords.length > 0);
              }
              
              if (rawCoords.length) {
                // Compute combined bounding box for plan, core boundaries, and columns
                const allCoords = [...rawCoords, ...rawCoreCoords];
                rawColumnsData.forEach(columnCoords => allCoords.push(...columnCoords));
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                allCoords.forEach(([x, y]) => {
                  if (x < minX) minX = x; if (y < minY) minY = y;
                  if (x > maxX) maxX = x; if (y > maxY) maxY = y;
                });
                const width = Math.max(0, maxX - minX);
                const height = Math.max(0, maxY - minY);
                const maxDim = Math.max(width, height, 1);
                const scale = 50000 / maxDim;
                
                // Normalize plan boundary coords in [0,50000]
                const verts = rawCoords.map(([x, y]) => {
                  const nx = (x - minX) * scale;
                  const ny = (y - minY) * scale;
                  return [nx, ny];
                });
                
                // Normalize core boundary coords in [0,50000]
                const coreVerts = rawCoreCoords.map(([x, y]) => {
                  const nx = (x - minX) * scale;
                  const ny = (y - minY) * scale;
                  return [nx, ny];
                });

                // Normalize columns coords in [0,50000]
                const normalizedColumns = rawColumnsData.map(columnCoords => 
                  columnCoords.map(([x, y]) => {
                    const nx = (x - minX) * scale;
                    const ny = (y - minY) * scale;
                    return [nx, ny];
                  })
                );
                
                if (verts.length) {
                  fp.boundaryArea = { id: fp.boundaryArea?.id || 'boundary_0', label: 'boundary', vertices: verts };
                  
                  // Add normalized core boundary if present
                  if (coreVerts.length) {
                    fp.coreArea = { id: 'core_0', label: 'core', vertices: coreVerts };
                    console.log('Core boundary loaded with', coreVerts.length, 'vertices:', coreVerts);
                  }

                  // Add normalized columns if present
                  if (normalizedColumns.length) {
                    fp.columnsData = normalizedColumns.map((columnVerts, i) => ({
                      id: `column_${i}`,
                      label: `Column ${i + 1}`,
                      vertices: columnVerts
                    }));
                    console.log('Columns loaded:', fp.columnsData.length, 'columns');
                  }

                  // Initialize layer visibility controls
                  fp.layers = {
                    planBoundary: true,
                    coreBoundary: true,
                    columns: true
                  };
                  
                  // Request that the renderer show only the boundary vertices
                  // for this imported plan (minimal visualisation mode).
                  fp._renderOnlyBoundaryVertices = true;

                  // Compute a view transform so the normalized boundaries fit the
                  // canvas. Store in the floorplan so the renderer can apply it.
                  try {
                    const bbMinX = 0; // normalized coords start at 0
                    const bbMinY = 0;
                    // Get the actual max from the normalized coordinates
                    const allNormalizedCoords = [...verts, ...coreVerts];
                    normalizedColumns.forEach(columnVerts => allNormalizedCoords.push(...columnVerts));
                    const bbMaxX = allNormalizedCoords.length > 0 ? Math.max(...allNormalizedCoords.map(v => v[0])) : 0;
                    const bbMaxY = allNormalizedCoords.length > 0 ? Math.max(...allNormalizedCoords.map(v => v[1])) : 0;
                    const bbW = Math.max(1, bbMaxX - bbMinX);
                    const bbH = Math.max(1, bbMaxY - bbMinY);
                    const margin = 0.9; // keep 10% padding
                    const scaleX = canvas.width / bbW;
                    const scaleY = canvas.height / bbH;
                    const viewScale = Math.min(scaleX, scaleY) * margin;
                    const offsetX = (canvas.width - (bbW * viewScale)) / 2 - (bbMinX * viewScale);
                    const offsetY = (canvas.height - (bbH * viewScale)) / 2 - (bbMinY * viewScale);
                    fp._view = { scale: viewScale, offsetX, offsetY };
                    console.log('View transform:', fp._view);
                    console.log('Canvas size:', canvas.width, 'x', canvas.height);
                    console.log('Bounding box:', { bbMinX, bbMinY, bbMaxX, bbMaxY, bbW, bbH });
                  } catch (err) {
                    console.warn('Failed to compute view transform for boundary-only view', err);
                    fp._view = null;
                  }
                }
              }
            }
          } catch (err) {
            console.warn('Failed to create boundaryArea from Plan_Boundary', err);
          }
          store.add(fp);          // set as active + push to history
          store.setActive(fp);    // triggers notify()

          // Restore saved scale (if present) so measurements and GUI reflect
          // the plan's intended physical dimensions.
          if (fp.units && fp.units.pxPerUnit) {
            setScalePixelsPerUnit(fp.units.pxPerUnit, fp.units.length || 'mm');
            // Update canvas controls if present
            const valEl = document.getElementById('canvasWidthValue');
            const unitEl = document.getElementById('canvasUnitSelect');
            if (valEl && unitEl) {
              unitEl.value = fp.units.length || unitEl.value;
              // compute the numeric value in the chosen unit from canvas width
              const numeric = Math.round((document.getElementById('canvas').width / fp.units.pxPerUnit) * 100) / 100;
              valEl.value = numeric;
            }
          }
          store.setMode("select");

          // Repopulate requirements form (guard each element in case UI panel
          // is not present in a minimal embed or during tests)
          const req = fp.requirements || {};
          const bedroomsEl = document.getElementById("bedroomsInput");
          if (bedroomsEl) bedroomsEl.value = req.bedrooms || 0;
          const bathroomsEl = document.getElementById("bathroomsInput");
          if (bathroomsEl) bathroomsEl.value = req.bathrooms || 0;
          const openKitchenEl = document.getElementById("openKitchenChk");
          if (openKitchenEl) openKitchenEl.checked = !!req.openKitchen;
          const balconyEl = document.getElementById("balconyChk");
          if (balconyEl) balconyEl.checked = !!req.balcony;
          const styleEl = document.getElementById("styleSelect");
          if (styleEl) styleEl.value = req.style || "";
          const notesEl = document.getElementById("notesInput");
          if (notesEl) notesEl.value = req.notes || "";
        }
      } catch (err) {
        console.error("Open error:", err);
      }
    });
  }

  const planNameInput = document.getElementById("planNameInput");
  if (planNameInput) {
    // Initialise field with current active plan name
    if (store.active) planNameInput.value = store.active.name;

    // Update store when user types
    planNameInput.addEventListener("input", () => {
      store.updateName(planNameInput.value.trim());
    });

    // Keep input in sync when store changes (e.g. after opening a file)
    store.onChange(() => {
      if (store.active && planNameInput.value !== store.active.name) {
        planNameInput.value = store.active.name;
      }
    });
  }

  const btnOptimise = document.getElementById('optimiseBtn');
  const aiDebug = document.getElementById('ai-debug');
  const aiError = document.getElementById('ai-error');

  if (btnOptimise) {
    btnOptimise.addEventListener('click', async () => {
      const fp = store.active;
      if (!fp) return;

    // 1) Serialize
    const planJson = fp.toJSON();

    // // 2) Validate
    // const result = validateFloorPlan(planJson);
    // if (!result.ok) {
    //   aiError.style.display = 'block';
    //   aiError.textContent = `Validation failed:\n- ${result.errors.join('\n- ')}`;
    //   aiDebug.style.display = 'none';
    //   return;
    // } else {
    //   aiError.style.display = 'none';
    // }

    // 3) Render prompt
    const prompt = renderPrompt(fp);
    // console.log("Generated prompt:\n", prompt);

    // 5) Send to local AI service (no validation for now)
    try {
      const res = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // model: "gpt-oss",
          model: "mistral-nemo",
          prompt: prompt,   // <-- your dynamic string
          stream: false
        })
      });

      if (!res.ok) {
        console.log("res not ok");
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      
      
      const data = await res.json();
      // const raw = await res.text();
      console.log("Raw service response: ", data.response);

      // Try to validate the returned JSON and perform a best-effort
      // sanitisation if it doesn't comply with the schema (common issues:
      // missing `units`, missing `entrances.edgeRef`).
      let candidate = typeof data.response === 'string' ? JSON.parse(data.response) : data.response;

      // If `units` missing, try to infer the unit used by the AI from the
      // magnitude of the returned coordinates, then set candidate.units and
      // an appropriate pxPerUnit so FloorPlan.fromJSON converts correctly.
      if (!candidate.units) {
        const nodes = (candidate.wall_graph && candidate.wall_graph.nodes) || [];
        let maxVal = 0;
        nodes.forEach(n => {
          if (n && typeof n.x === 'number' && typeof n.y === 'number') {
            maxVal = Math.max(maxVal, Math.abs(n.x), Math.abs(n.y));
          }
        });

        // Heuristic: if coordinates are large (>50) treat as mm, if medium
        // (10-50) treat as cm, otherwise meters.
        let inferredUnit = 'm';
        if (maxVal > 50) inferredUnit = 'mm';
        else if (maxVal > 10) inferredUnit = 'cm';

        const METERS = { mm: 0.001, cm: 0.01, m: 1 };
        const appUnit = getUnitLabel() || 'm';
        const pxPerApp = getPixelsPerUnit() || 1; // pixels per app unit
        // pxPerCandidate = pxPerApp * (metersPerCandidate / metersPerApp)
        const pxPerCandidate = pxPerApp * (METERS[inferredUnit] / METERS[appUnit]);

        candidate.units = { length: inferredUnit, pxPerUnit: pxPerCandidate };
      }

      // Ensure edges include a locked flag (default false) so schema validation
      // and subsequent code expecting the flag do not break.
      if (candidate.wall_graph && Array.isArray(candidate.wall_graph.edges)) {
        candidate.wall_graph.edges = candidate.wall_graph.edges.map(e => ({ ...e, locked: typeof e.locked === 'boolean' ? e.locked : false }));
      }

      // Ensure entrances have an edgeRef (best-effort: match nearest edge by projection)
      if (Array.isArray(candidate.entrances) && candidate.wall_graph && Array.isArray(candidate.wall_graph.edges) && Array.isArray(candidate.wall_graph.nodes)) {
        // helper: project point onto segment and compute distance
        function projPointToSeg(px, py, ax, ay, bx, by) {
          const vx = bx - ax, vy = by - ay;
          const wx = px - ax, wy = py - ay;
          const vv = vx*vx + vy*vy;
          const t = vv === 0 ? 0 : Math.max(0, Math.min(1, (wx*vx + wy*vy) / vv));
          const qx = ax + t*vx, qy = ay + t*vy;
          const dx = px - qx, dy = py - qy;
          return Math.hypot(dx, dy);
        }

        const nodesById = Object.fromEntries(candidate.wall_graph.nodes.map(n => [n.id, n]));
        candidate.entrances = candidate.entrances.map(ent => {
          if (!ent.edgeRef) {
            // find closest edge
            let best = null; let bestDist = Infinity;
            candidate.wall_graph.edges.forEach(edge => {
              const n1 = nodesById[edge.v1];
              const n2 = nodesById[edge.v2];
              if (!n1 || !n2) return;
              const d = projPointToSeg(ent.position.x, ent.position.y, n1.x, n1.y, n2.x, n2.y);
              if (d < bestDist) { bestDist = d; best = edge.id; }
            });
            if (best) ent.edgeRef = best;
          }
          return ent;
        });
      }

      // Validate the candidate plan JSON
      const valid = validateFloorPlan(candidate);
      if (!valid.ok) {
        // If still invalid, show errors and abort applying the plan
        aiError.style.display = 'block';
        aiError.textContent = `AI returned an invalid plan:\n- ${valid.errors.join('\n- ')}`;
        aiDebug.style.display = 'block';
        aiDebug.textContent = JSON.stringify(candidate, null, 2);
        return;
      }

      // Convert into a FloorPlan and apply
      const refined = FloorPlan.fromJSON(candidate);
      store.update(refined);

      aiError.style.display = "none"; // hide any previous error
    } catch (err) {
      aiError.style.display = "block";
      aiError.textContent = `AI service error: ${err.message}`;
    }

  });
  }

  // Wire color picker apply button (inside bindUI so `store` is available)
  const applyBtn = document.getElementById('applyAreaColorBtn');
  const colorPicker = document.getElementById('areaColorPicker');
  if (applyBtn && colorPicker) {
    applyBtn.addEventListener('click', () => {
      if (!store.active) return;
      // Resolve selected area id across boundaryArea, Temperature_Regions, and legacy areas
      const fallbackId = store.active.Temperature_Regions && store.active.Temperature_Regions.length ? store.active.Temperature_Regions[0].id : (store.active.areas && store.active.areas.length ? store.active.areas[0].id : null);
      const sel = store.selectedAreaId || fallbackId;
      if (!sel) return;

      // try boundaryArea
      if (store.active.boundaryArea && store.active.boundaryArea.id === sel) {
        // boundary area has no editable color/alpha for now
        return;
      }

      // try Temperature_Regions
      let region = (store.active.Temperature_Regions || []).find(r => r.id === sel);
      if (region) {
        const alphaInput = document.getElementById('areaAlphaRange');
        const alphaValueInput = document.getElementById('areaAlphaValue');
        const airInput = document.getElementById('areaAirReq');
        const labelInput = document.getElementById('areaLabelInput');
        const alpha = alphaInput ? parseFloat(alphaInput.value) : (region.alpha || 0.3);
        region.color = colorPicker.value;
        region.alpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.3;
        if (labelInput && labelInput.value) region.name = labelInput.value;
        if (airInput) region.air_requirement = Number.isFinite(parseFloat(airInput.value)) ? parseFloat(airInput.value) : region.air_requirement || 7.5;
        if (alphaValueInput) alphaValueInput.value = region.alpha.toFixed(2);
        store.update(store.active);
        refreshAreasList(store);
        return;
      }

      // fallback to legacy areas
      const area = store.active.areas.find(a => a.id === sel);
      if (area) {
        const alphaInput = document.getElementById('areaAlphaRange');
        const alphaValueInput = document.getElementById('areaAlphaValue');
        const airInput = document.getElementById('areaAirReq');
        const labelInput = document.getElementById('areaLabelInput');
        const alpha = alphaInput ? parseFloat(alphaInput.value) : (area.alpha || 0.3);
        area.color = colorPicker.value;
        area.alpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.3;
        if (labelInput && labelInput.value) area.label = labelInput.value;
        if (airInput) area.air_requirement = Number.isFinite(parseFloat(airInput.value)) ? parseFloat(airInput.value) : area.air_requirement || 7.5;
        if (alphaValueInput) alphaValueInput.value = area.alpha.toFixed(2);
        store.update(store.active);
        refreshAreasList(store);
      }
    });
  }

}

// Helper: commit the area, prompt for label, add to model, and reset temp state
function commitArea(store) {
  if (store.tempArea.length < 3) return;

  // Resolve all temp vertices to pixel coordinates
  const resolvedCoords = store.tempArea.map(v => {
    if (typeof v === 'string') {
      const n = store.active.wall_graph.nodes.find(n => n.id === v);
      return n ? [n.x, n.y] : null;
    }
    if (!Array.isArray(v) || v.length < 2) return null;
    const [x, y] = v;
    const node = store.active.wall_graph.nodes.find(n => Math.hypot(n.x - x, n.y - y) <= SNAP_TO_NODE_DIST);
    return node ? [node.x, node.y] : [x, y];
  }).filter(v => v !== null);

  if (resolvedCoords.length >= 3) {
    if (typeof store.active.addExclusionArea === 'function') {
      store.active.addExclusionArea(resolvedCoords);
    } else {
      // fallback for plain objects
      if (!store.active.Exclusion_Areas) store.active.Exclusion_Areas = [];
      const id = `ex_${Date.now()}`;
      store.active.Exclusion_Areas.push({ id, vertices: resolvedCoords });
    }
  }

  store.update(store.active);
  store.tempArea = [];
  store.tempAreaActive = false;
  store.setMode("select");
  refreshAreasList(store);
}

function refreshAreasList(store) {
  const listEl = document.getElementById('areasList');
  if (!listEl) return;
  listEl.innerHTML = '';

  const areas = store.active.Exclusion_Areas || [];
  if (areas.length === 0) {
    listEl.innerHTML = '<li style="color:#888; font-size:0.9em;">None</li>';
    return;
  }

  areas.forEach((area, idx) => {
    const li = document.createElement('li');
    li.textContent = `Exclusion ${idx + 1}`;

    const del = document.createElement('button');
    del.textContent = 'x';
    del.style.marginLeft = '8px';
    del.onclick = () => {
      store.active.Exclusion_Areas.splice(idx, 1);
      store.update(store.active);
      refreshAreasList(store);
    };
    li.appendChild(del);
    listEl.appendChild(li);
  });
}

// Helper: commit the core boundary, add to model, and reset temp state
function commitCore(store) {
  console.log("commit core has been called");
  if (store.tempCore.length < 3) return; // need at least a triangle

  // Convert temp core coordinates to core boundary format
  const coreVertices = store.tempCore.map(v => [v[0], v[1]]);
  
  store.active.addCoreBoundary(coreVertices);

  // Add each edge of the core polygon to the wall_graph as a 'core' wall
  // so they behave like wall segments (selectable, lockable, openings, etc.)
  const nodeIds = coreVertices.map(([x, y]) => store.active.addNode(x, y));
  const n = nodeIds.length;
  for (let i = 0; i < n; i++) {
    const v1Id = nodeIds[i];
    const v2Id = nodeIds[(i + 1) % n];
    const edgeId = store.active.addEdge(v1Id, v2Id, false);
    // Mark the edge itself so drawWalls can identify it as core
    const edge = store.active.wall_graph.edges.find(e => e.id === edgeId);
    if (edge) edge.wallType = 'core';
    // Create the matching Wall object for type-aware rendering / openings
    const n1 = store.active.wall_graph.nodes.find(nd => nd.id === v1Id);
    const n2 = store.active.wall_graph.nodes.find(nd => nd.id === v2Id);
    if (n1 && n2) store.active.addWall(n1, n2, { wallType: 'core' });
  }

  store.update(store.active);       // commit to history
  store.tempCore = [];
  store.tempCoreActive = false;

  // Optionally switch back to edit mode
  store.setMode("select");
  console.log("Core boundary added successfully");
}

// Find closest vertex from existing areas (Temperature_Regions and legacy areas)
function findClosestAreaVertex(fp, point, maxDist = SNAP_TO_NODE_DIST) {
  if (!fp) return null;
  let best = null;
  let bestDist = maxDist;

  // Temperature_Regions subregion vertices (Pt_* keyed objects)
  (fp.Temperature_Regions || []).forEach(region => {
    (region.subregions || []).forEach(sub => {
      Object.values(sub).forEach(v => {
        if (Array.isArray(v) && v.length >= 2) {
          const dx = point.x - v[0];
          const dy = point.y - v[1];
          const d = Math.hypot(dx, dy);
          if (d < bestDist) {
            bestDist = d;
            best = { x: v[0], y: v[1], source: 'temperature' };
          }
        }
      });
    });
  });

  // Legacy areas vertices
  (fp.areas || []).forEach(area => {
    (area.vertices || []).forEach(v => {
      if (typeof v === 'string') {
        const n = fp.wall_graph.nodes.find(n => n.id === v);
        if (n) {
          const dx = point.x - n.x;
          const dy = point.y - n.y;
          const d = Math.hypot(dx, dy);
          if (d < bestDist) {
            bestDist = d;
            best = { x: n.x, y: n.y, source: 'legacy-node' };
          }
        }
      } else if (Array.isArray(v) && v.length >= 2) {
        const dx = point.x - v[0];
        const dy = point.y - v[1];
        const d = Math.hypot(dx, dy);
        if (d < bestDist) {
          bestDist = d;
          best = { x: v[0], y: v[1], source: 'legacy-vertex' };
        }
      }
    });
  });

  return best;
}

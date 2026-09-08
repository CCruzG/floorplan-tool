// renderer/ui/ui.js


import { DrawingService } from '../drawing/drawingService.js';
import { findClosestProjection, findClosestSegment, findClosestNode, findClosestEdgeProjection } from '../drawing/geometry.js';
import { FloorPlan } from '../models/FloorPlan.js'; // adjust path if needed
import { setScalePixelsPerUnit, getPixelsPerUnit, getUnitLabel } from '../../config.js';
import { validateFloorPlan } from '../models/validation.js';
import { renderPrompt } from '../models/promptRenderer.js';
import { View3D } from '../drawing/view3d.js';
import { checkHealth, startOptimisation, pollOptimisation, cancelOptimisation } from '../api/apiService.js';
import MECH_DATA from '../../../Project-71/data/general/Mechanical.json';

// import { DrawingService, findClosestBoundaryPoint } from '../drawing/drawingService.js';


export const SNAP_TO_NODE_DIST = 10;   // pixels
export const SNAP_TO_EDGE_DIST = 8;    // pixels

// Returns the _coreId of the Core_Boundary entry that contains both endpoints of edge, or null.
function _findCoreIdForEdge(fp, edge) {
  const EPS = 1;
  const n1 = (fp.wall_graph.nodes || []).find(n => n.id === edge.v1);
  const n2 = (fp.wall_graph.nodes || []).find(n => n.id === edge.v2);
  if (!n1 || !n2) return null;
  for (const coreBdry of (fp.Core_Boundary || [])) {
    const coords = Object.keys(coreBdry).filter(k => /^Pt_\d+$/.test(k)).map(k => coreBdry[k]);
    const n1m = coords.some(([cx, cy]) => Math.abs(n1.x - cx) < EPS && Math.abs(n1.y - cy) < EPS);
    const n2m = coords.some(([cx, cy]) => Math.abs(n2.x - cx) < EPS && Math.abs(n2.y - cy) < EPS);
    if (n1m && n2m) return coreBdry._coreId || null;
  }
  return null;
}

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

// Criteria/design-standard settings shared between the panel and the renderer
const criteriaSettings = {
  defaultAirReq: 7.5,  // l/s·m²
  pinchVelocity: 8.0,  // m/s – ducts above this velocity are highlighted
  showPinch: true,
};

// Duct routing design settings — per-orientation air requirements + velocity/buildup limits
const ductRoutingSettings = {
  lpsPerM2: { north: 7.5, east: 7.5, south: 7.5, west: 7.5, internal: 7.5 },
  maxVelocity: 8.0,     // m/s
  maxBuildupMm: 800,    // mm
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

  // ── Buildup Inspector ──────────────────────────────────────────────────────
  if (fp?.selectedBuildup) {
    const { buildupMm, thresholdMm, type, detail } = fp.selectedBuildup;
    const fmtCost = v => `$${Math.round(v).toLocaleString()}`;
    const pct = Math.round(buildupMm / thresholdMm * 100);
    const severity = buildupMm >= thresholdMm ? 'Exceeds threshold' : `${pct}% of threshold`;
    const typeLabel = { 'duct-duct': 'Duct × Duct', 'duct-beam': 'Duct × Beam', 'duct-duct-beam': 'Duct × Duct × Beam' }[type] ?? type;
    panel.innerHTML = [
      `<div class="inspector-header"><span class="inspector-kind">Buildup</span></div>`,
      `<div class="inspector-body">`,
      `<div class="inspector-row"><span class="inspector-label">Type</span><span class="inspector-value">${typeLabel}</span></div>`,
      `<div class="inspector-row"><span class="inspector-label">Total</span><span class="inspector-value">${Math.round(buildupMm)} mm</span></div>`,
      `<div class="inspector-row"><span class="inspector-label">Threshold</span><span class="inspector-value">${Math.round(thresholdMm)} mm</span></div>`,
      `<div class="inspector-row"><span class="inspector-label">Status</span><span class="inspector-value">${severity}</span></div>`,
      `<div class="inspector-row"><span class="inspector-label">Breakdown</span><span class="inspector-value" style="font-size:0.85em">${detail}</span></div>`,
      `</div>`,
    ].join('');
    return;
  }

  // ── Fitting Inspector ──────────────────────────────────────────────────────
  if (fp?.selectedFitting) {
    const { type, cost } = fp.selectedFitting;
    const fmtCost = v => `$${Math.round(v).toLocaleString()}`;
    panel.innerHTML = [
      `<div class="inspector-header"><span class="inspector-kind">${type}</span></div>`,
      `<div class="inspector-body">`,
      `<div class="inspector-row"><span class="inspector-label">Type</span><span class="inspector-value">${type}</span></div>`,
      `<div class="inspector-row"><span class="inspector-label">Fitting cost</span><span class="inspector-value">${fmtCost(cost)}</span></div>`,
      `</div>`,
    ].join('');
    return;
  }

  // ── Duct Inspector ──────────────────────────────────────────────────────
  if (fp?.selectedDuct) {
    const duct = fp.selectedDuct; // Assuming { pA, pB, width, height, flow }
    panel.innerHTML = [
      `<div class="inspector-header"><span class="inspector-kind">Duct Segment</span></div>`,
      `<div class="inspector-body">`,
      `<div class="inspector-row"><span class="inspector-label">Width</span><span class="inspector-value">${Math.round(duct.width * 1000)} mm</span></div>`,
      `<div class="inspector-row"><span class="inspector-label">Height</span><span class="inspector-value">${Math.round(duct.height * 1000)} mm</span></div>`,
      `<div class="inspector-row"><span class="inspector-label">Flow</span><span class="inspector-value">${duct.flow.toFixed(2)} l/s</span></div>`,
      `</div>`
    ].join('');
    return;
  }
  
  // ── VAV Inspector ──────────────────────────────────────────────────────
  if (fp?.selectedVav) {
    const vav = fp.selectedVav; // Assuming { ptId, load }
    const pt = (fp.Points || []).find(p => p.id === vav.ptId);
    panel.innerHTML = [
      `<div class="inspector-header"><span class="inspector-kind">VAV Terminal</span></div>`,
      `<div class="inspector-body">`,
      `<div class="inspector-row"><span class="inspector-label">Grid ID</span><span class="inspector-value">${vav.ptId}</span></div>`,
      `<div class="inspector-row"><span class="inspector-label">Load</span><span class="inspector-value">${vav.load.toFixed(2)} l/s</span></div>`,
      pt ? `<div class="inspector-row"><span class="inspector-label">Entry Point</span><span class="inspector-value">${pt.entryPoint ? 'Yes' : 'No'}</span></div>` : '',
      `</div>`
    ].join('');
    return;
  }
  
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
      const zones = fp.Thermal_Zones || [];
      const ptZoneIndices = Array.isArray(pt.thermalZoneIndices) ? pt.thermalZoneIndices : [];
      const hasVavAssignments = pt.entryPoint === true && Array.isArray(pt.thermalRegions) && pt.thermalRegions.length > 0;
      const zoneChecks = zones.length > 0 && pt.entryPoint === true && !hasVavAssignments
        ? zones.map((z, i) =>
            `<label style="display:flex; align-items:center; gap:5px; font-size:var(--fs-xs); color:var(--text); cursor:pointer;">` +
            `<input class="insp-pt-zone-cb" type="checkbox" value="${i}"${ptZoneIndices.includes(i) ? ' checked' : ''}> Zone ${i + 1}${z.name ? ' — ' + z.name : ''}` +
            `</label>`
          ).join('')
        : '';
      const vavRows = hasVavAssignments
        ? [...pt.thermalRegions]
            .sort((a, b) => (a.zoneIndex - b.zoneIndex) || ((a.vavZoneIndex ?? a.subZoneIndex ?? 0) - (b.vavZoneIndex ?? b.subZoneIndex ?? 0)))
            .map(r =>
              `<div style="font-size:var(--fs-xs); color:var(--text);">Zone ${r.zoneIndex + 1} / VAV ${(r.vavZoneIndex ?? r.subZoneIndex ?? 0) + 1}</div>`
            ).join('')
        : '';
      panel.innerHTML = [
        `<div class="inspector-header"><span class="inspector-kind">Grid Point</span></div>`,
        `<div class="inspector-body">`,
        `<div class="inspector-row"><span class="inspector-label">X</span><span class="inspector-value">${fmt(pt.x)}&nbsp;${unitLabel}</span></div>`,
        `<div class="inspector-row"><span class="inspector-label">Y</span><span class="inspector-value">${fmt(pt.y)}&nbsp;${unitLabel}</span></div>`,
        `<div class="inspector-row"><span class="inspector-label">Column</span><input id="insp-pt-column" type="checkbox"${pt.column !== false ? ' checked' : ''}></div>`,
        `<div class="inspector-row"><span class="inspector-label">Mechanical</span><input id="insp-pt-mechanical" type="checkbox"${pt.mechanical !== false ? ' checked' : ''}></div>`,
        `<div class="inspector-row"><span class="inspector-label">Entry Point</span><input id="insp-pt-entrypoint" type="checkbox"${pt.entryPoint === true ? ' checked' : ''}></div>`,
        pt.entryPoint === true && zones.length > 0 ? [
          `<div class="inspector-row" style="flex-direction:column; align-items:flex-start; gap:3px;">`,
          `<span class="inspector-label">${hasVavAssignments ? 'VAV Control Zones' : 'Thermal Zones'}</span>`,
          `<div id="insp-pt-zone-list" style="display:flex; flex-direction:column; gap:2px; padding-left:2px;">`,
          hasVavAssignments ? vavRows : zoneChecks,
          `</div>`,
          `</div>`,
        ].join('') : '',
        hasVavAssignments
          ? `<div class="inspector-row" style="margin-top:6px;"><button id="insp-pt-clear-assignment" class="insp-btn">Clear zone assignment</button></div>`
          : '',
        `</div>`
      ].join('');
      panel.querySelector('#insp-pt-column').addEventListener('change', e => {
        pt.column = e.target.checked; store.update(fp);
      });
      panel.querySelector('#insp-pt-mechanical').addEventListener('change', e => {
        pt.mechanical = e.target.checked; store.update(fp);
      });
      panel.querySelector('#insp-pt-entrypoint').addEventListener('change', e => {
        pt.entryPoint = e.target.checked;
        if (!e.target.checked) { pt.thermalZoneIndices = []; pt.thermalRegions = []; }
        store.update(fp);
      });
      panel.querySelectorAll('.insp-pt-zone-cb').forEach(cb => {
        cb.addEventListener('change', () => {
          const checked = [...panel.querySelectorAll('.insp-pt-zone-cb:checked')].map(el => parseInt(el.value, 10));
          pt.thermalZoneIndices = checked;
          store.update(fp);
        });
      });
      const clearBtn = panel.querySelector('#insp-pt-clear-assignment');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          pt.thermalRegions = [];
          pt.thermalZoneIndices = [];
          store.update(fp);
        });
      }
    } else {
      // Mixed-value helpers: true if all match, null if mixed
      const allColumn     = selected.every(p => p.column !== false);
      const allNotColumn  = selected.every(p => p.column === false);
      const allMech       = selected.every(p => p.mechanical !== false);
      const allNotMech    = selected.every(p => p.mechanical === false);
      const allEntry      = selected.every(p => p.entryPoint === true);
      const allNotEntry   = selected.every(p => p.entryPoint !== true);
      panel.innerHTML = [
        `<div class="inspector-header"><span class="inspector-kind">Grid Points</span><span class="inspector-value">${selected.length} selected</span></div>`,
        `<div class="inspector-body">`,
        `<div class="inspector-row"><span class="inspector-label">Column</span>`,
        `<input id="insp-pt-column" type="checkbox"${allColumn ? ' checked' : ''}${(!allColumn && !allNotColumn) ? ' data-mixed="true"' : ''}></div>`,
        `<div class="inspector-row"><span class="inspector-label">Mechanical</span>`,
        `<input id="insp-pt-mechanical" type="checkbox"${allMech ? ' checked' : ''}${(!allMech && !allNotMech) ? ' data-mixed="true"' : ''}></div>`,
        `<div class="inspector-row"><span class="inspector-label">Entry Point</span>`,
        `<input id="insp-pt-entrypoint" type="checkbox"${allEntry ? ' checked' : ''}${(!allEntry && !allNotEntry) ? ' data-mixed="true"' : ''}></div>`,
        `</div>`
      ].join('');
      // Show indeterminate state for mixed values
      const colCb = panel.querySelector('#insp-pt-column');
      const mechCb = panel.querySelector('#insp-pt-mechanical');
      const entryPointCb = panel.querySelector('#insp-pt-entrypoint');
      if (!allColumn && !allNotColumn) colCb.indeterminate = true;
      if (!allMech && !allNotMech) mechCb.indeterminate = true;
      if (!allEntry && !allNotEntry) entryPointCb.indeterminate = true;
      colCb.addEventListener('change', e => {
        selected.forEach(p => { p.column = e.target.checked; }); store.update(fp);
      });
      mechCb.addEventListener('change', e => {
        selected.forEach(p => { p.mechanical = e.target.checked; }); store.update(fp);
      });
      entryPointCb.addEventListener('change', e => {
        selected.forEach(p => { p.entryPoint = e.target.checked; }); store.update(fp);
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
      fp.deleteCore(fp.selectedCore);
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
      fp.addWall(n1, n2, { wallType: 'boundary', translucent: true, locked: edge.locked || false });
      wall = fp.Walls[fp.Walls.length - 1];
    }
    return wall;
  };

  const wallType    = wall?.wallType    ?? 'boundary';
  const translucent = wall?.translucent ?? (wallType === 'boundary');
  const locked      = edge.locked || false;
  const openings    = wall?.openings    ?? [];

  const isCoreWall = (wallType === 'core');

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
    `</div></div>`,
    isCoreWall ? `<div class="inspector-row" style="margin-top:6px;"><button id="insp-core-delete-wall" class="insp-btn insp-btn-danger">Delete Core</button></div>` : '',
    `</div>`
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

  panel.querySelector('#insp-core-delete-wall')?.addEventListener('click', () => {
    fp.deleteCore(_findCoreIdForEdge(fp, edge));
    store.update(fp);
  });
}

export function ensureReferenceImageLoaded(fp, notify) {
  const ref = fp?.referenceImage;
  if (!ref || ref.image || ref._loading || !ref.src) return;

  ref._loading = true;
  const img = new Image();
  img.onload = () => {
    ref.image = img;
    ref.naturalWidth = ref.naturalWidth || img.naturalWidth;
    ref.naturalHeight = ref.naturalHeight || img.naturalHeight;
    ref._loading = false;
    if (typeof notify === 'function') notify();
  };
  img.onerror = () => {
    ref._loading = false;
    ref.error = 'Failed to load reference image.';
    if (typeof notify === 'function') notify();
  };
  img.src = ref.src;
}

function setActivePanelTab(tabName) {
  const tabs = document.querySelectorAll('[data-panel-tab]');
  tabs.forEach(btn => btn.classList.toggle('active', btn.dataset.panelTab === tabName));
  ['dashboard', 'snapshots', 'json'].forEach(name => {
    const el = document.getElementById(`${name}PanelView`);
    if (el) el.classList.toggle('active', name === tabName);
  });
}

function setActiveDisplayTab(tabName) {
  document.querySelectorAll('[data-display-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.displayTab === tabName);
  });
  const views = { grid: 'displayGridView', layers: 'displayLayersView', reference: 'displayReferenceView' };
  Object.entries(views).forEach(([tab, id]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', tab === tabName);
  });
}

function _resolveVertex(v, nodes) {
  if (typeof v === 'string') { const n = nodes.find(n => n.id === v); return n ? [n.x, n.y] : null; }
  if (Array.isArray(v)) return [v[0], v[1]];
  if (v && typeof v.x === 'number') return [v.x, v.y];
  return null;
}

function _shoelaceAreaPx(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

const _ZONE_HUES = [200, 145, 25, 280, 170, 50, 320, 90, 0, 245, 340, 120, 60, 190, 300];

function _riserColour(fp, riser) {
  if (riser.vav && riser.vav.length > 0) {
    const firstVavId = typeof riser.vav[0][0] === 'string'
      ? riser.vav[0][0]
      : fp.Points?.[riser.vav[0][0]]?.id;
    if (firstVavId) {
      const region = (fp.Thermal_Zones || []).find(r =>
        (r.vav_control_zones || []).some(cz => cz.points.includes(firstVavId))
      );
      if (region) {
        if (region.color && /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(region.color)) {
          return region.color;
        }
        const zi = fp.Thermal_Zones.indexOf(region);
        const isInternal = region.type === 'internal' || region.orientation === null;
        if (isInternal) return 'rgba(90,90,90,0.9)';
        const hue = _ZONE_HUES[zi % _ZONE_HUES.length];
        return `hsla(${hue},60%,45%,1)`;
      }
    }
  }
  return '#888';
}

/**
 * Compute per-riser metrics (lm, lmCost, fitting counts/costs) and the
 * global list of fitting nodes used by the hit test.
 */
function _buildRiserMetrics(fp) {
  const ductPlan = fp.Duct_Plan || [];
  const pointMap = new Map();
  (fp.Points || []).forEach(p => { if (p.id) pointMap.set(p.id, p); });

  const ductConfigs = MECH_DATA.duct_configs || [];
  const ductUnitCostFallback = MECH_DATA.DuctUnitCost ?? 0;
  const configByKey = new Map(
    ductConfigs.map(c => [`${Math.round(c.width * 1000)}×${Math.round(c.height * 1000)} mm`, c])
  );

  const mmPerUnit = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[fp.units?.length] ?? 1000;
  const pxPerUnit = fp.units?.pxPerUnit ?? 1;
  const metersPerPixel = mmPerUnit / (pxPerUnit * 1000);

  const riserLm     = ductPlan.map(() => 0);
  const riserLmCost = ductPlan.map(() => 0);

  ductPlan.forEach((riser, ri) => {
    (riser.ducts || []).forEach(duct => {
      if (duct.length !== 5) return;
      const [idA, idB, w, h] = duct;
      const pA = pointMap.get(idA);
      const pB = pointMap.get(idB);
      if (!pA || !pB) return;
      const segLm = Math.sqrt((pB.x - pA.x) ** 2 + (pB.y - pA.y) ** 2) * metersPerPixel;
      riserLm[ri] += segLm;
      const key = `${Math.round(w * 1000)}×${Math.round(h * 1000)} mm`;
      const cfg = configByKey.get(key);
      riserLmCost[ri] += segLm * (cfg ? cfg.unitCost + ductUnitCostFallback : ductUnitCostFallback);
    });
  });

  // Global adjacency — each edge tagged with its riser index
  const adj = new Map();
  ductPlan.forEach((riser, ri) => {
    (riser.ducts || []).forEach(duct => {
      if (duct.length !== 5) return;
      const [idA, idB, w, h] = duct;
      const pA = pointMap.get(idA);
      const pB = pointMap.get(idB);
      if (!pA || !pB) return;
      if (!adj.has(idA)) adj.set(idA, []);
      if (!adj.has(idB)) adj.set(idB, []);
      adj.get(idA).push({ w, h, otherPt: pB, ri });
      adj.get(idB).push({ w, h, otherPt: pA, ri });
    });
  });

  const riserFittings = ductPlan.map(() => ({
    elbows:      { count: 0, cost: 0 },
    transitions: { count: 0, cost: 0 },
    tees:        { count: 0, cost: 0 },
  }));
  const allFittingNodes = [];

  adj.forEach((edges, ptId) => {
    const pt = pointMap.get(ptId);
    if (!pt) return;
    const largest = edges.reduce((best, e) => (e.w * e.h > best.w * best.h ? e : best), edges[0]);
    const cfg = configByKey.get(`${Math.round(largest.w * 1000)}×${Math.round(largest.h * 1000)} mm`);
    const ri = edges[0].ri;

    if (edges.length >= 3) {
      const cost = cfg?.bendingCost ?? 0;
      riserFittings[ri].tees.count++; riserFittings[ri].tees.cost += cost;
      allFittingNodes.push({ ptId, pt, type: 'Tee', cost });
      return;
    }
    if (edges.length === 2) {
      const [e1, e2] = edges;
      if (e1.w !== e2.w || e1.h !== e2.h) {
        const cost = cfg?.transitionCost ?? 0;
        riserFittings[ri].transitions.count++; riserFittings[ri].transitions.cost += cost;
        allFittingNodes.push({ ptId, pt, type: 'Transition', cost });
        return;
      }
      const dx1 = e1.otherPt.x - pt.x, dy1 = e1.otherPt.y - pt.y;
      const dx2 = e2.otherPt.x - pt.x, dy2 = e2.otherPt.y - pt.y;
      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      if (len1 > 0 && len2 > 0) {
        const dot = (dx1 / len1) * (dx2 / len2) + (dy1 / len1) * (dy2 / len2);
        if (Math.abs(dot) < 0.3) {
          const cost = cfg?.bendingCost ?? 0;
          riserFittings[ri].elbows.count++; riserFittings[ri].elbows.cost += cost;
          allFittingNodes.push({ ptId, pt, type: 'Elbow', cost });
        }
      }
    }
  });

  return {
    risers: ductPlan.map((riser, ri) => ({
      riser,
      colour:  _riserColour(fp, riser),
      lm:      riserLm[ri],
      lmCost:  riserLmCost[ri],
      fittings: riserFittings[ri],
    })),
    allFittingNodes,
  };
}

/**
 * Find buildup points by locating grid points where beams and/or ducts from
 * multiple risers coincide. Ducts route along grid edges (never crossing beams
 * geometrically), so crossings are detected per grid point rather than by
 * segment intersection.
 *
 * Two cases generate a buildup point:
 *   1. Duct × beam  — a duct segment endpoint is within beamTolPx of a beam,
 *      AND the duct segment is NOT parallel to that beam (parallelism would
 *      mean the duct runs alongside the beam, not across it).
 *   2. Duct × duct  — a grid point is used by ducts from ≥ 2 different risers.
 *
 * Result is cached on fp._buildupPoints for the renderer.
 */
function _computeBuildupPoints(fp) {
  const settings    = fp.buildupSettings || {};
  const slabMm      = settings.slabThicknessMm ?? 120;
  const thresholdMm = settings.thresholdMm ?? 800;

  const pointMap = new Map();
  (fp.Points || []).forEach(p => { if (p.id) pointMap.set(p.id, p); });

  // beamTolPx: used for perpendicular-crossing proximity gate (dist to beam segment).
  // A genuine crossing has one endpoint exactly on the beam (dist≈0), so 1.1 cells
  // is loose enough without causing false positives in that case.
  const beamTolPx      = (fp.units?.pxPerUnit || 1) * 1.1;
  // collinearTolPx: how close (perpendicularly) a parallel duct must be to the beam
  // LINE to be treated as collinear. A duct on the beam grid line has |sd|≈0; a duct
  // one grid step away has |sd|=pxPerUnit — half a cell safely separates them.
  const collinearTolPx = (fp.units?.pxPerUnit || 1) * 0.5;
  // cos of the angle above which two segments are considered parallel (~26°).
  const PARALLEL_COS = 0.9;

  function _distPtToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-10) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  // Signed distance from (px,py) to the infinite line through (ax,ay)→(bx,by).
  // Positive on the left, negative on the right.
  function _signedDistToLine(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-10) return Math.hypot(px - ax, py - ay);
    return (dx * (py - ay) - dy * (px - ax)) / len;
  }

  const beams = (fp.Beams || []).filter(b => b.start && b.end);

  // Accumulator keyed by grid-point id:
  //   risers:  Map<ri, maxHeightMm>   (populated for both cases)
  //   beamSet: Set<beamIndex>         (prevents double-counting the same beam)
  //   totalBeamMm: number
  const acc = new Map();
  const getAcc = id => {
    if (!acc.has(id)) acc.set(id, { risers: new Map(), beamSet: new Set(), totalBeamMm: 0 });
    return acc.get(id);
  };

  (fp.Duct_Plan || []).forEach((riser, ri) => {
    (riser.ducts || []).forEach(d => {
      if (d.length !== 5) return;
      const [idA, idB, , heightM] = d;
      const pA = pointMap.get(idA), pB = pointMap.get(idB);
      if (!pA || !pB) return;
      const heightMm = Math.round(heightM * 1000);

      // ── Case 2: register both endpoints for duct×duct detection ──────────
      for (const id of [idA, idB]) {
        const r = getAcc(id).risers;
        r.set(ri, Math.max(r.get(ri) ?? 0, heightMm));
      }

      // ── Case 1: duct×beam — segment must NOT be parallel to the beam ─────
      const ddx = pB.x - pA.x, ddy = pB.y - pA.y;
      const dlen = Math.hypot(ddx, ddy);
      if (dlen < 1e-6) return;

      beams.forEach((beam, bi) => {
        const bdx = beam.end.x - beam.start.x, bdy = beam.end.y - beam.start.y;
        const blen = Math.hypot(bdx, bdy);
        if (blen < 1e-6) return;

        // Signed perpendicular distances — needed for both the collinear and
        // straddling checks below, so compute once here.
        const sdA = _signedDistToLine(pA.x, pA.y, beam.start.x, beam.start.y, beam.end.x, beam.end.y);
        const sdB = _signedDistToLine(pB.x, pB.y, beam.start.x, beam.start.y, beam.end.x, beam.end.y);

        if (Math.abs((ddx * bdx + ddy * bdy) / (dlen * blen)) > PARALLEL_COS) {
          // Duct runs parallel to this beam.
          // Only a buildup if the duct is COLLINEAR (lying on the beam line),
          // not merely running alongside it at an offset.
          if (Math.abs(sdA) > collinearTolPx || Math.abs(sdB) > collinearTolPx) return;

          // Collinear: project endpoints onto the beam direction and check for
          // overlap with the beam's extent [0, blen].
          const bDirX = bdx / blen, bDirY = bdy / blen;
          const projA = (pA.x - beam.start.x) * bDirX + (pA.y - beam.start.y) * bDirY;
          const projB = (pB.x - beam.start.x) * bDirX + (pB.y - beam.start.y) * bDirY;
          if (Math.max(projA, projB) < 0 || Math.min(projA, projB) > blen) return; // no overlap

          // Flag each endpoint that falls within the beam's projected extent.
          const depthMm = Math.round(beam.depth ?? 300);
          for (const [id, proj] of [[idA, projA], [idB, projB]]) {
            if (proj >= 0 && proj <= blen) {
              const entry = getAcc(id);
              if (!entry.beamSet.has(bi)) {
                entry.beamSet.add(bi);
                entry.totalBeamMm += depthMm;
              }
            }
          }
          return;
        }

        // Perpendicular crossing: skip if both endpoints are on the same side
        // of the beam line (segment does not straddle it).
        if (sdA * sdB > 0) return;

        // Flag only the endpoint closest to the beam segment (the one "at" the beam).
        const dA = _distPtToSeg(pA.x, pA.y, beam.start.x, beam.start.y, beam.end.x, beam.end.y);
        const dB = _distPtToSeg(pB.x, pB.y, beam.start.x, beam.start.y, beam.end.x, beam.end.y);
        if (Math.min(dA, dB) > beamTolPx) return;
        const [id] = dA <= dB ? [idA] : [idB];

        const depthMm = Math.round(beam.depth ?? 300);
        const entry = getAcc(id);
        if (!entry.beamSet.has(bi)) {
          entry.beamSet.add(bi);
          entry.totalBeamMm += depthMm;
        }
      });
    });
  });

  // Build results: emit only points with a beam crossing OR ducts from ≥ 2 risers.
  const results = [];
  for (const [id, { risers, beamSet, totalBeamMm }] of acc) {
    if (risers.size < 2 && beamSet.size === 0) continue;
    const pt = pointMap.get(id);
    if (!pt) continue;

    const ductEls   = [...risers.entries()].map(([ri, heightMm]) => ({ type: 'duct', heightMm, ri }));
    const buildupMm = slabMm + ductEls.reduce((s, e) => s + e.heightMm, 0) + totalBeamMm;

    let type;
    if (ductEls.length >= 2 && beamSet.size >= 1) type = 'duct-duct-beam';
    else if (ductEls.length >= 2)                 type = 'duct-duct';
    else                                           type = 'duct-beam';

    const ductDesc = ductEls.map(d => `${d.heightMm} mm duct`).join(' + ');
    const beamDesc = totalBeamMm ? ` + ${totalBeamMm} mm beam` : '';
    const detail   = `${slabMm} mm slab + ${ductDesc}${beamDesc}`;

    results.push({ pt: { x: pt.x, y: pt.y }, buildupMm, thresholdMm, type, detail });
  }

  return results;
}

/** Thin wrapper used by the canvas hit test. */
function _buildFittingNodes(fp) {
  return _buildRiserMetrics(fp).allFittingNodes;
}

let _branchesExpanded = false;

function refreshDashboardPanel(fp, store) {
  const panel = document.getElementById('dashboardOutput');
  if (!panel) return;

  if (!fp) {
    panel.innerHTML = '';
    return;
  }

  const columnCount = (fp.Columns || []).length;
  const beamCount = (fp.Beams || []).length;
  const pxPerUnit = fp.units?.pxPerUnit || 1;
  const unitLabel = fp.units?.length || 'mm';
  const mmPerUnit = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[unitLabel] ?? 1000;

  // ── Structure: material, dimensions, and costs from last solved solution ────
  // Fall back to reading depth/width directly from fp.Beams/fp.Columns when
  // Structural_Meta is absent (e.g. files saved before this field was added).
  const _meta = fp.Structural_Meta || (
    (fp.Beams?.length || fp.Columns?.length) ? {
      beamMaterial:  null,
      slabMaterial:  null,
      slabDepthMm:   null,
      beamDepthMm:   fp.Beams?.[0]?.depth  ?? null,
      beamWidthMm:   fp.Beams?.[0]?.width  ?? null,
      columnWidthMm: fp.Columns?.[0]?.width ?? null,
      costs:         null,
    } : null
  );
  const _hasCosts = _meta?.costs != null;
  const _fmtMm  = v => (v != null && v > 0) ? `${Math.round(v)} mm` : '—';
  const _fmtMat = s => s ? (s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()) : null;

  // ── Floor plate area (shared for unit cost calculations) ─────────────────────
  const metersPerPixel = mmPerUnit / (pxPerUnit * 1000);
  const wallNodes = fp.wall_graph?.nodes || [];
  const rawVerts = fp.boundaryArea?.vertices || [];
  const resolvedVerts = rawVerts.map(v => _resolveVertex(v, wallNodes)).filter(Boolean);
  const boundaryAreaPx2 = resolvedVerts.length >= 3 ? _shoelaceAreaPx(resolvedVerts) : 0;

  const corePolys = (fp.Core_Boundary || []).map(core =>
    Object.entries(core)
      .filter(([k]) => k.startsWith('Pt_'))
      .sort(([a], [b]) => parseInt(a.slice(3)) - parseInt(b.slice(3)))
      .map(([, v]) => Array.isArray(v) ? [v[0], v[1]] : null)
      .filter(Boolean)
  ).filter(poly => poly.length >= 3);
  const coreAreaPx2 = corePolys.reduce((sum, poly) => sum + _shoelaceAreaPx(poly), 0);

  const totalAreaM2   = boundaryAreaPx2 * metersPerPixel * metersPerPixel;
  const coreAreaM2    = coreAreaPx2 * metersPerPixel * metersPerPixel;
  const floorAreaM2   = Math.max(0, boundaryAreaPx2 - coreAreaPx2) * metersPerPixel * metersPerPixel;
  const fmtArea = v => v > 0 ? `${Math.round(v).toLocaleString()} m²` : '—';

  // ── Mechanical: duct linear metres and cost per section ─────────────────────
  const pointMap = new Map();
  (fp.Points || []).forEach(p => { if (p.id) pointMap.set(p.id, p); });

  // Build a lookup from "W×H mm" key → duct config for costing
  const ductConfigs = MECH_DATA.duct_configs || [];
  const ductUnitCostFallback = MECH_DATA.DuctUnitCost ?? 0;
  const configByKey = new Map(
    ductConfigs.map(c => [`${Math.round(c.width * 1000)}×${Math.round(c.height * 1000)} mm`, c])
  );

  // branches = number of entry points (risers), not individual duct segments
  const ductPlan = fp.Duct_Plan || [];
  const branchCount = ductPlan.filter(r => (r.ducts || []).length > 0).length;

  const ductSectionLm = {};
  const ductSectionCost = {};
  ductPlan.forEach(riser => {
    (riser.ducts || []).forEach(duct => {
      if (duct.length !== 5) return;
      const [ptA_id, ptB_id, w, h] = duct;
      const key = `${Math.round(w * 1000)}×${Math.round(h * 1000)} mm`;
      const pA = pointMap.get(ptA_id);
      const pB = pointMap.get(ptB_id);
      const segLm = (pA && pB)
        ? Math.sqrt((pB.x - pA.x) ** 2 + (pB.y - pA.y) ** 2) * metersPerPixel
        : 0;
      ductSectionLm[key] = (ductSectionLm[key] || 0) + segLm;
      const cfg = configByKey.get(key);
      const ratePerLm = cfg ? cfg.unitCost + ductUnitCostFallback : ductUnitCostFallback;
      ductSectionCost[key] = (ductSectionCost[key] || 0) + segLm * ratePerLm;
    });
  });

  const totalDuctLmCost = Object.values(ductSectionCost).reduce((s, v) => s + v, 0);
  const fmtCost = v => `$${Math.round(v).toLocaleString()}`;

  // ── Per-riser metrics (fittings + lm) ───────────────────────────────────────
  const riserMetrics = _buildRiserMetrics(fp);
  let elbowCount = 0, transitionCount = 0, teeCount = 0;
  let elbowFittingCost = 0, transitionFittingCost = 0, teeFittingCost = 0;
  riserMetrics.risers.forEach(({ fittings }) => {
    elbowCount      += fittings.elbows.count;      elbowFittingCost      += fittings.elbows.cost;
    transitionCount += fittings.transitions.count;  transitionFittingCost += fittings.transitions.cost;
    teeCount        += fittings.tees.count;          teeFittingCost        += fittings.tees.cost;
  });

  const totalFittingCost = elbowFittingCost + transitionFittingCost + teeFittingCost;
  const totalMechCost = totalDuctLmCost + totalFittingCost;
  const mechUnitCost = floorAreaM2 > 0 ? totalMechCost / floorAreaM2 : null;

  const ductRows = Object.entries(ductSectionLm)
    .sort(([a], [b]) => {
      const area = s => { const m = s.match(/\d+/g); return m ? Number(m[0]) * Number(m[1]) : 0; };
      return area(b) - area(a);
    })
    .map(([key, lm]) => [
      `<div class="dash-row">`,
      `<span class="dash-row-label">${key}</span>`,
      `<span>${lm.toFixed(1)} lm</span>`,
      `<span class="dash-row-cost">${fmtCost(ductSectionCost[key] || 0)}</span>`,
      `</div>`,
    ].join(''))
    .join('');

  const fittingRows = [
    elbowCount > 0
      ? `<div class="dash-row"><span class="dash-row-label"><span class="fitting-dot" style="background:#ffeb3b"></span>Elbows</span><span>${elbowCount}</span><span class="dash-row-cost">${fmtCost(elbowFittingCost)}</span></div>`
      : '',
    transitionCount > 0
      ? `<div class="dash-row"><span class="dash-row-label"><span class="fitting-dot" style="background:#ce93d8"></span>Transitions</span><span>${transitionCount}</span><span class="dash-row-cost">${fmtCost(transitionFittingCost)}</span></div>`
      : '',
    teeCount > 0
      ? `<div class="dash-row"><span class="dash-row-label"><span class="fitting-dot" style="background:#ff9800"></span>Tees</span><span>${teeCount}</span><span class="dash-row-cost">${fmtCost(teeFittingCost)}</span></div>`
      : '',
  ].join('');

  const ductSubtotalRow = totalDuctLmCost > 0 && totalFittingCost > 0
    ? `<div class="dash-row dash-row-subtotal"><span class="dash-row-label">Duct (lm)</span><span></span><span class="dash-row-cost">${fmtCost(totalDuctLmCost)}</span></div>`
    : '';

  const ductTotalRow = totalMechCost > 0
    ? `<div class="dash-row dash-row-total"><span class="dash-row-label">Total</span><span></span><span class="dash-row-cost">${fmtCost(totalMechCost)}</span></div>`
    : '';

  const hasStructure = columnCount > 0 || beamCount > 0;
  const hasMechanical = branchCount > 0;

  const thermalCount = (fp.Thermal_Zones || []).length;
  const hasThermal = thermalCount > 0;

  const sectionHeader = (title, btnId) => [
    `<div class="dashboard-section-header">`,
    `<span class="dashboard-section-title">${title}</span>`,
    `<button class="dash-clear-btn" id="${btnId}">Clear</button>`,
    `</div>`,
  ].join('');

  const structDetailRows = _meta ? [
    _meta.beamMaterial
      ? `<div class="dash-row"><span class="dash-row-label">Material</span><span>${_fmtMat(_meta.beamMaterial)}</span><span></span></div>`
      : '',
    (_meta.beamWidthMm != null || _meta.beamDepthMm != null)
      ? (() => {
          const parts = [_meta.beamWidthMm, _meta.beamDepthMm].filter(v => v != null).map(_fmtMm);
          const dimStr = parts.length === 2 ? `${parts[0]} × ${parts[1]}` : `${parts[0]} (D)`;
          return `<div class="dash-row"><span class="dash-row-label">Beam</span><span>${dimStr}</span>${_hasCosts ? `<span class="dash-row-cost">${fmtCost(_meta.costs.beams ?? 0)}</span>` : '<span></span>'}</div>`;
        })()
      : '',
    _meta.columnWidthMm != null
      ? `<div class="dash-row"><span class="dash-row-label">Column</span><span>${_fmtMm(_meta.columnWidthMm)} × ${_fmtMm(_meta.columnWidthMm)}</span>${_hasCosts ? `<span class="dash-row-cost">${fmtCost(_meta.costs.columns ?? 0)}</span>` : '<span></span>'}</div>`
      : '',
    _meta.slabDepthMm != null
      ? `<div class="dash-row"><span class="dash-row-label">Slab${_meta.slabMaterial ? ` (${_fmtMat(_meta.slabMaterial)})` : ''}</span><span>${_fmtMm(_meta.slabDepthMm)}</span>${_hasCosts ? `<span class="dash-row-cost">${fmtCost(_meta.costs.slab ?? 0)}</span>` : '<span></span>'}</div>`
      : '',
    _hasCosts
      ? `<div class="dash-row dash-row-total"><span class="dash-row-label">Total</span><span></span><span class="dash-row-cost">${fmtCost(_meta.costs.total)}</span></div>`
      : '',
  ].join('') : '';

  const structUnitCost = (_hasCosts && floorAreaM2 > 0)
    ? _meta.costs.total / floorAreaM2
    : null;

  const structHTML = hasStructure ? [
    `<div class="dashboard-section">`,
    sectionHeader('Structure', 'dashClearStructureBtn'),
    `<div class="metric-note">${columnCount} column${columnCount !== 1 ? 's' : ''} · ${beamCount} beam${beamCount !== 1 ? 's' : ''}</div>`,
    structUnitCost !== null ? [
      `<div class="dash-unit-cost">`,
      `<span class="dash-unit-cost-value">${fmtCost(structUnitCost)}</span>`,
      `<span class="dash-unit-cost-label">/m²</span>`,
      `</div>`,
    ].join('') : '',
    structDetailRows ? `<div class="dash-table">${structDetailRows}</div>` : '',
    (!_hasCosts && hasStructure && _meta?.costsError)
      ? `<div class="metric-note" style="font-style:italic;opacity:0.65;">Cost calculation failed — re-run Structural to retry</div>`
      : '',
    (!_hasCosts && hasStructure && !_meta?.costsError)
      ? `<div class="metric-note" style="font-style:italic;opacity:0.65;">Re-run Structural to see costs</div>`
      : '',
    `</div>`,
  ].join('') : '';

  const thermalHTML = hasThermal ? [
    `<div class="dashboard-section">`,
    sectionHeader('Thermal', 'dashClearThermalBtn'),
    `<div class="metric-note">${thermalCount} zone${thermalCount !== 1 ? 's' : ''}</div>`,
    `</div>`,
  ].join('') : '';

  // ── Branch list (per-riser breakdown) ───────────────────────────────────────
  const fmtLm = v => `${v.toFixed(1)} lm`;
  const branchListHTML = _branchesExpanded ? riserMetrics.risers
    .filter(r => r.lm > 0)
    .map((r, i) => {
      const totalCost = r.lmCost + r.fittings.elbows.cost + r.fittings.transitions.cost + r.fittings.tees.cost;
      const fRows = [
        r.fittings.elbows.count > 0
          ? `<div class="branch-detail-row"><span><span class="fitting-dot" style="background:#ffeb3b"></span>Elbows</span><span>${r.fittings.elbows.count}</span><span class="dash-row-cost">${fmtCost(r.fittings.elbows.cost)}</span></div>`
          : '',
        r.fittings.transitions.count > 0
          ? `<div class="branch-detail-row"><span><span class="fitting-dot" style="background:#ce93d8"></span>Transitions</span><span>${r.fittings.transitions.count}</span><span class="dash-row-cost">${fmtCost(r.fittings.transitions.cost)}</span></div>`
          : '',
        r.fittings.tees.count > 0
          ? `<div class="branch-detail-row"><span><span class="fitting-dot" style="background:#ff9800"></span>Tees</span><span>${r.fittings.tees.count}</span><span class="dash-row-cost">${fmtCost(r.fittings.tees.cost)}</span></div>`
          : '',
      ].join('');
      return [
        `<div class="branch-item" style="border-left-color:${r.colour}">`,
        `<div class="branch-item-header">`,
        `<span class="branch-name">Branch ${i + 1}</span>`,
        `<span class="branch-lm">${fmtLm(r.lm)}</span>`,
        `<span class="dash-row-cost">${fmtCost(totalCost)}</span>`,
        `</div>`,
        fRows,
        `</div>`,
      ].join('');
    }).join('')
    : '';

  // ── Buildup analysis ─────────────────────────────────────────────────────
  const bSettings = fp.buildupSettings || {};
  const buildupPoints = _computeBuildupPoints(fp);
  fp._buildupPoints = buildupPoints; // cache for renderer

  const bThreshold = bSettings.thresholdMm ?? 800;
  const bSlab      = bSettings.slabThicknessMm ?? 120;
  const bCritical  = buildupPoints.filter(b => b.buildupMm >= bThreshold).length;
  const bWarning   = buildupPoints.filter(b => b.buildupMm >= bThreshold * 0.8 && b.buildupMm < bThreshold).length;

  const buildupHTML = hasMechanical ? [
    `<div class="dashboard-section buildup-section">`,
    `<div class="dashboard-section-title" style="margin-bottom:6px">Buildup</div>`,
    `<div class="buildup-settings">`,
    `<label class="buildup-label">Slab<input class="buildup-input" id="buildupSlabInput" type="number" value="${bSlab}" min="0" step="10"> mm</label>`,
    `<label class="buildup-label">Threshold<input class="buildup-input" id="buildupThresholdInput" type="number" value="${bThreshold}" min="0" step="10"> mm</label>`,
    `</div>`,
    buildupPoints.length > 0 ? [
      bCritical > 0 ? `<div class="buildup-stat buildup-critical">${bCritical} critical</div>` : '',
      bWarning  > 0 ? `<div class="buildup-stat buildup-warning">${bWarning} warning</div>` : '',
      bCritical === 0 && bWarning === 0 ? `<div class="buildup-stat buildup-ok">${buildupPoints.length} crossing${buildupPoints.length !== 1 ? 's' : ''} — OK</div>` : '',
    ].join('') : `<div class="buildup-stat" style="color:var(--text-muted)">No crossings detected</div>`,
    `</div>`,
  ].join('') : '';

  const updatedMechHTML = hasMechanical ? [
    `<div class="dashboard-section">`,
    sectionHeader('Mechanical', 'dashClearMechBtn'),
    mechUnitCost !== null ? [
      `<div class="dash-unit-cost">`,
      `<span class="dash-unit-cost-value">${fmtCost(mechUnitCost)}</span>`,
      `<span class="dash-unit-cost-label">/m²</span>`,
      `</div>`,
    ].join('') : '',
    `<button class="branch-toggle" id="dashBranchToggle">${branchCount} branch${branchCount !== 1 ? 'es' : ''} ${_branchesExpanded ? '▾' : '▸'}</button>`,
    _branchesExpanded
      ? `<div class="branch-list">${branchListHTML}</div>`
      : (ductRows ? `<div class="dash-table">${ductRows}${ductSubtotalRow}${fittingRows}${ductTotalRow}</div>` : ''),
    `</div>`,
  ].join('') : '';

  const areaRowHTML = totalAreaM2 > 0 ? [
    `<div class="dash-area-grid">`,
    `<div class="metric-card"><div class="metric-label">Total area</div><div class="metric-value">${fmtArea(totalAreaM2)}</div></div>`,
    `<div class="metric-card"><div class="metric-label">Core area</div><div class="metric-value">${fmtArea(coreAreaM2)}</div></div>`,
    `<div class="metric-card"><div class="metric-label">Usable area</div><div class="metric-value">${fmtArea(floorAreaM2)}</div></div>`,
    `</div>`,
  ].join('') : '';

  panel.innerHTML = [
    areaRowHTML,
    (hasStructure || hasMechanical) ? [
      `<div class="dash-section-grid">`,
      structHTML,
      updatedMechHTML,
      `</div>`,
    ].join('') : '',
    buildupHTML,
    thermalHTML,
  ].join('');

  const bindClear = (id, action) => {
    const btn = panel.querySelector(`#${id}`);
    if (btn) btn.addEventListener('click', () => { action(); store.update(fp); });
  };
  bindClear('dashClearStructureBtn', () => {
    const EPS = 2;
    (fp.Points || []).forEach(pt => {
      if ((fp.Columns || []).some(col => Math.abs(col.x - pt.x) < EPS && Math.abs(col.y - pt.y) < EPS)) {
        pt.mechanical = true;
      }
    });
    fp.Columns = [];
    fp.Beams = [];
  });
  bindClear('dashClearMechBtn', () => {
    fp.Duct_Plan = [];
    fp.Edges = [];
    fp._ductEdges = null;
  });
  bindClear('dashClearThermalBtn', () => { fp.Thermal_Zones = []; });

  const branchToggleBtn = panel.querySelector('#dashBranchToggle');
  if (branchToggleBtn) {
    branchToggleBtn.addEventListener('click', () => {
      _branchesExpanded = !_branchesExpanded;
      refreshDashboardPanel(store.active, store);
    });
  }

  const bindBuildupInput = (id, key) => {
    const el = panel.querySelector(`#${id}`);
    if (!el) return;
    el.addEventListener('change', () => {
      const val = parseFloat(el.value);
      if (!isNaN(val) && val >= 0) {
        if (!fp.buildupSettings) fp.buildupSettings = {};
        fp.buildupSettings[key] = val;
        store.update(fp);
      }
    });
  };
  bindBuildupInput('buildupSlabInput',      'slabThicknessMm');
  bindBuildupInput('buildupThresholdInput', 'thresholdMm');
}

function refreshReferencePanel(fp, store, callbacks = {}) {
  const panel = document.getElementById('referenceImageOutput');
  if (!panel) return;

  if (!fp) {
    panel.innerHTML = '';
    return;
  }

  const ref = fp.referenceImage || {};
  const unitLabel = fp.units?.length || 'mm';
  const opacityPercent = Math.round((Number.isFinite(ref.opacity) ? ref.opacity : 0.35) * 100);

  panel.innerHTML = [
    `<div class="dashboard-actions">`,
    `<button type="button" id="importReferenceBtn" class="gp-btn">Import</button>`,
    `<button type="button" id="fitReferenceBtn" class="gp-btn">Fit to View</button>`,
    `<button type="button" id="scaleReferenceBtn" class="gp-btn"${!ref.src ? ' disabled' : ''}>Scale</button>`,
    `<button type="button" id="clearReferenceBtn" class="gp-btn gp-btn-clear">Remove</button>`,
    `</div>`,
    `<div class="cg-row"><label class="cg-label" for="referenceVisibleChk">Visible</label><input id="referenceVisibleChk" type="checkbox" ${ref.visible === false ? '' : 'checked'}></div>`,
    `<div class="cg-row"><label class="cg-label" for="referenceXInput">X</label><input id="referenceXInput" type="number" step="0.1" value="${Number.isFinite(ref.x) ? ref.x : 0}"></div>`,
    `<div class="cg-row"><label class="cg-label" for="referenceYInput">Y</label><input id="referenceYInput" type="number" step="0.1" value="${Number.isFinite(ref.y) ? ref.y : 0}"></div>`,
    `<div class="cg-row"><label class="cg-label" for="referenceWidthInput">Width</label><input id="referenceWidthInput" type="number" min="0.1" step="0.1" value="${Number.isFinite(ref.width) ? ref.width : 10}"><span class="cg-unit">${unitLabel}</span></div>`,
    `<div class="cg-row"><label class="cg-label" for="referenceOpacityInput">Opacity</label><input id="referenceOpacityInput" type="range" min="0" max="100" value="${opacityPercent}"><span class="cg-pct" id="referenceOpacityPct">${opacityPercent}%</span></div>`,
    ref.fileName ? `<div class="dashboard-note">Loaded: ${ref.fileName}</div>` : `<div class="dashboard-note">No reference image loaded.</div>`,
  ].join('');

  const bindNumber = (id, callback) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => callback(parseFloat(el.value)));
  };

  bindNumber('referenceXInput', (value) => {
    if (!fp.referenceImage || !Number.isFinite(value)) return;
    fp.referenceImage.x = value;
    store.update(fp);
  });
  bindNumber('referenceYInput', (value) => {
    if (!fp.referenceImage || !Number.isFinite(value)) return;
    fp.referenceImage.y = value;
    store.update(fp);
  });
  bindNumber('referenceWidthInput', (value) => {
    if (!fp.referenceImage || !Number.isFinite(value) || value <= 0) return;
    fp.referenceImage.width = value;
    store.update(fp);
  });

  const visibleChk = document.getElementById('referenceVisibleChk');
  if (visibleChk) {
    visibleChk.addEventListener('change', () => {
      if (!fp.referenceImage) return;
      fp.referenceImage.visible = visibleChk.checked;
      store.update(fp);
    });
  }

  const opacityInput = document.getElementById('referenceOpacityInput');
  const opacityPct   = document.getElementById('referenceOpacityPct');
  if (opacityInput && opacityPct) {
    opacityInput.addEventListener('input', () => {
      if (!fp.referenceImage) return;
      const value = Math.max(0, Math.min(100, parseInt(opacityInput.value, 10) || 0));
      opacityPct.textContent = `${value}%`;
      fp.referenceImage.opacity = value / 100;
      store.update(fp);
    });
  }

  document.getElementById('scaleReferenceBtn')?.addEventListener('click', () => {
    if (typeof callbacks.onScaleReference === 'function') callbacks.onScaleReference();
  });

  document.getElementById('clearReferenceBtn')?.addEventListener('click', () => {
    if (!fp.referenceImage) return;
    fp.referenceImage = null;
    store.update(fp);
  });

  document.getElementById('fitReferenceBtn')?.addEventListener('click', () => {
    if (!fp.referenceImage) return;
    const ppu = fp.units?.pxPerUnit || 1;
    fp.referenceImage.width = Math.max(1, Math.round(((window.innerWidth || 1024) / ppu) * 0.55 * 100) / 100);
    store.update(fp);
  });

  document.getElementById('importReferenceBtn')?.addEventListener('click', async () => {
    if (!window.electronAPI?.pickReferenceAsset || !store.active) return;
    const result = await window.electronAPI.pickReferenceAsset();
    if (!result?.success || !result.asset) return;
    const ppu = store.active.units?.pxPerUnit || 1;
    store.active.referenceImage = {
      fileName: result.asset.fileName,
      filePath: result.asset.filePath,
      mime: result.asset.mime,
      src: result.asset.dataUrl,
      naturalWidth: result.asset.naturalWidth,
      naturalHeight: result.asset.naturalHeight,
      x: 0,
      y: 0,
      width: Math.max(1, Math.round(((window.innerWidth || 1024) / ppu) * 0.45 * 100) / 100),
      opacity: 0.35,
      visible: true,
      image: null,
    };
    ensureReferenceImageLoaded(store.active, () => store.update(store.active));
    store.update(store.active);
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

// ── Criteria panel ─────────────────────────────────────────────────────────────

function setupCriteriaPanel(store) {
  const defaultAirInput = document.getElementById('defaultAirReqInput');
  const applyDefaultBtn = document.getElementById('applyDefaultAirBtn');
  const pinchInput      = document.getElementById('pinchVelocityInput');
  const showPinchChk    = document.getElementById('showPinchChk');
  const pinchSummary    = document.getElementById('pinchSummary');

  if (defaultAirInput) {
    defaultAirInput.addEventListener('input', () => {
      const v = parseFloat(defaultAirInput.value);
      if (isFinite(v) && v > 0) criteriaSettings.defaultAirReq = v;
    });
  }

  if (applyDefaultBtn) {
    applyDefaultBtn.addEventListener('click', () => {
      if (!store.active) return;
      const req = criteriaSettings.defaultAirReq;
      (store.active.Thermal_Zones || []).forEach(zone => {
        if (!Number.isFinite(zone.air_requirement)) {
          zone.air_requirement = req;
        }
      });
      store.update(store.active);
      refreshThermalZonesList(store);
    });
  }

  if (pinchInput) {
    pinchInput.addEventListener('input', () => {
      const v = parseFloat(pinchInput.value);
      if (isFinite(v) && v > 0) criteriaSettings.pinchVelocity = v;
      store.notify();
    });
  }

  if (showPinchChk) {
    showPinchChk.addEventListener('change', () => {
      criteriaSettings.showPinch = showPinchChk.checked;
      store.notify();
    });
  }

  // Update pinch summary whenever the store changes
  store.onChange(() => {
    if (!pinchSummary) return;
    const fp = store.active;
    if (!fp?.Duct_Plan?.length) { pinchSummary.textContent = ''; return; }
    let pinchCount = 0;
    const thresh = criteriaSettings.pinchVelocity;
    (fp.Duct_Plan || []).forEach(riser => {
      (riser.ducts || []).forEach(duct => {
        if (duct.length !== 5) return;
        const [,, w, h, flow] = duct;
        const cs = (w || 0.3) * (h || 0.3);
        if (cs > 0 && (flow * 0.001) / cs > thresh) pinchCount++;
      });
    });
    pinchSummary.textContent = pinchCount
      ? `⚠ ${pinchCount} pinch segment${pinchCount > 1 ? 's' : ''} > ${thresh} m/s`
      : `✓ No pinch points above ${thresh} m/s`;
    pinchSummary.style.color = pinchCount ? 'var(--warn)' : 'var(--accent-dim)';
  });
}

// ── Solutions / snapshots ─────────────────────────────────────────────────────

function _floorAreaM2(fp) {
  const mmPerUnit = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[fp.units?.length] ?? 1000;
  const pxPerUnit = fp.units?.pxPerUnit ?? 1;
  const mPerPx = mmPerUnit / (pxPerUnit * 1000);
  const wallNodes = fp.wall_graph?.nodes || [];
  const rawVerts = fp.boundaryArea?.vertices || [];
  const verts = rawVerts.map(v => _resolveVertex(v, wallNodes)).filter(Boolean);
  const boundaryPx2 = verts.length >= 3 ? _shoelaceAreaPx(verts) : 0;
  const corePx2 = (fp.Core_Boundary || []).reduce((sum, core) => {
    const poly = Object.entries(core)
      .filter(([k]) => k.startsWith('Pt_'))
      .sort(([a], [b]) => parseInt(a.slice(3)) - parseInt(b.slice(3)))
      .map(([, v]) => Array.isArray(v) ? [v[0], v[1]] : null)
      .filter(Boolean);
    return sum + (poly.length >= 3 ? _shoelaceAreaPx(poly) : 0);
  }, 0);
  return Math.max(0, boundaryPx2 - corePx2) * mPerPx * mPerPx;
}

function _solutionMetrics(fp) {
  const thermalZones = (fp.Thermal_Zones || []).length;
  const ductRisers   = (fp.Duct_Plan || []).length;
  const columns      = (fp.Columns || []).length;
  const totalAirLoad = (fp.Duct_Plan || []).reduce((sum, riser) =>
    sum + (riser.vav || []).reduce((s, v) => s + (Number.isFinite(v[1]) ? v[1] : 0), 0), 0
  );

  const floorAreaM2 = _floorAreaM2(fp);

  // Structural $/m²
  const structTotal = fp.Structural_Meta?.costs?.total ?? null;
  const structPerM2 = (structTotal != null && floorAreaM2 > 0) ? structTotal / floorAreaM2 : null;

  // Mechanical $/m² — sum duct lm cost + all fitting costs
  const rm = _buildRiserMetrics(fp);
  const mechTotal = rm.risers.reduce((sum, r) =>
    sum + r.lmCost + r.fittings.elbows.cost + r.fittings.transitions.cost + r.fittings.tees.cost, 0
  );
  const mechPerM2 = (mechTotal > 0 && floorAreaM2 > 0) ? mechTotal / floorAreaM2 : null;

  // Total $/m²
  const totalCost = (structTotal ?? 0) + mechTotal;
  const totalPerM2 = (totalCost > 0 && floorAreaM2 > 0) ? totalCost / floorAreaM2 : null;

  return { thermalZones, ductRisers, columns, totalAirLoad, structPerM2, mechPerM2, totalPerM2 };
}

function refreshSolutionsPanel(store) {
  const listEl = document.getElementById('solutionsList');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (!store.solutions.length) {
    listEl.innerHTML = '<div style="color:var(--text-muted);font-size:11px;">No snapshots yet</div>';
    return;
  }

  store.solutions.forEach((sol, idx) => {
    const div = document.createElement('div');
    const isActive = store._loadedSnapshotId === sol.id;
    div.className = 'solution-item' + (isActive ? ' solution-active' : '');

    const sm = sol.json?.structural_meta;
    const structLines = [];
    if (sm?.beamMaterial) {
      const mat = sm.beamMaterial.charAt(0).toUpperCase() + sm.beamMaterial.slice(1).toLowerCase();
      let line = mat;
      if (sm.beamSpanM) line += ` · ${sm.beamSpanM} m grid`;
      if (sm.beamDirection) line += ` · ${sm.beamDirection}`;
      structLines.push(line);
    }

    const m = sol.metrics;
    const metricsStr = m
      ? `zones: ${m.thermalZones ?? '—'} · risers: ${m.ductRisers ?? '—'} · air: ${m.totalAirLoad != null ? Number(m.totalAirLoad).toFixed(0) : '—'} l/s · cols: ${m.columns ?? '—'}`
      : '';

    div.innerHTML = [
      `<div class="solution-name">`,
      `  <span><span style="color:var(--text-muted);margin-right:5px;">#${idx + 1}</span>${sol.name}</span>`,
      `  <span class="solution-time">${sol.timestamp}</span>`,
      `</div>`,
      metricsStr ? `<div class="solution-metrics">${metricsStr}</div>` : '',
      structLines.length ? `<div class="solution-metrics" style="color:var(--text-dim);">${structLines.join('<br>')}</div>` : '',
      `<div class="solution-actions">`,
      `  <button class="sol-load-btn">Load</button>`,
      `  <button class="sol-update-btn">Update</button>`,
      `  <button class="sol-del-btn">Delete</button>`,
      `</div>`,
    ].join('');

    div.querySelector('.sol-load-btn').addEventListener('click', () => {
      const currentLayers = store.active?.layers ? { ...store.active.layers } : null;
      const fp = FloorPlan.fromJSON(sol.json);
      if (currentLayers) fp.layers = currentLayers;
      store.add(fp);
      store.setActive(fp);
      store._loadedSnapshotId = sol.id;
      store.notify();
      refreshSolutionsPanel(store);
    });

    div.querySelector('.sol-update-btn').addEventListener('click', () => {
      if (!store.active) return;
      sol.json    = store.active.toJSON();
      sol.metrics = _solutionMetrics(store.active);
      sol.timestamp = new Date().toLocaleTimeString();
      refreshSolutionsPanel(store);
    });

    div.querySelector('.sol-del-btn').addEventListener('click', () => {
      if (store._loadedSnapshotId === sol.id) store._loadedSnapshotId = null;
      store.solutions.splice(idx, 1);
      refreshSolutionsPanel(store);
    });

    listEl.appendChild(div);
  });

  // Comparison table when ≥ 2 solutions exist
  if (store.solutions.length >= 2) {
    // Backfill cost-per-m² fields for snapshots saved before these metrics were added.
    store.solutions.forEach(sol => {
      if (sol.metrics && sol.metrics.structPerM2 === undefined) {
        try {
          const fresh = _solutionMetrics(FloorPlan.fromJSON(sol.json));
          Object.assign(sol.metrics, { structPerM2: fresh.structPerM2, mechPerM2: fresh.mechPerM2, totalPerM2: fresh.totalPerM2 });
        } catch (_) { /* leave undefined — will display as '—' */ }
      }
    });

    const table = document.createElement('div');
    table.style.cssText = 'margin-top:8px; border-top:1px solid var(--border); padding-top:6px;';
    const fmtPerM2 = v => v != null ? `$${Math.round(v)}/m²` : '—';
    const keys = [
      ['thermalZones', 'Zones',         v => v != null ? String(v) : '—'],
      ['ductRisers',   'Risers',         v => v != null ? String(v) : '—'],
      ['totalAirLoad', 'Air (l/s)',      v => v != null ? Number(v).toFixed(0) : '—'],
      ['columns',      'Cols',           v => v != null ? String(v) : '—'],
      ['structPerM2',  'Struct $/m²',   fmtPerM2],
      ['mechPerM2',    'Mech $/m²',     fmtPerM2],
      ['totalPerM2',   'Total $/m²',    fmtPerM2],
    ];
    const rows = keys.map(([key, label, fmt]) => {
      const vals = store.solutions.map(s => fmt(s.metrics?.[key] ?? null));
      return `<tr><td style="color:var(--text-muted);padding-right:6px;font-size:10px;">${label}</td>${vals.map(v => `<td style="font-size:10px;padding:1px 5px;text-align:right;">${v}</td>`).join('')}</tr>`;
    });
    table.innerHTML = [
      `<div style="font-size:10px;color:var(--text-section);text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;">Compare</div>`,
      `<table style="border-collapse:collapse;width:100%;">`,
      `<tr><td></td>${store.solutions.map((s, i) => `<td style="font-size:10px;color:var(--text-dim);text-align:right;padding:1px 5px;">#${i+1}</td>`).join('')}</tr>`,
      ...rows,
      `</table>`,
    ].join('');
    listEl.appendChild(table);
  }
}

export function bindUI(store, canvas, mouse) {
  const ctx = canvas.getContext('2d');
  let _currentFilePath = null;  // path of the currently open/saved file
  let _boxSelect = null; // active drag-box in content space
  let _suppressNextClick = false;
  let _calibratePoints = []; // content-space [{x,y}] for two-click scale calibration
  let _refScalePoints = []; // content-space [{x,y}] for two-click reference image scaling

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = _toContent(sx, sy);
    const fp = store.active;
    if (!fp) return;

    // Hit test Duct Plan
    let found = false;
    if (fp.Duct_Plan) {
      // VAV Terminals (check before ducts so they can be clicked)
      fp.Duct_Plan.forEach(riser => {
        (riser.vav || []).forEach(vav => {
          const ptId = vav[0];
          const pt = fp.Points.find(p => p.id === ptId);
          if (pt) {
            const dist = Math.hypot(world.x - pt.x, world.y - pt.y);
            if (dist < 8 / vp.scale) {
              fp.selectedVav = { ptId: vav[0], load: vav[1] };
              fp.selectedDuct = null;
              found = true;
            }
          }
        });
      });

      if (!found) {
        // Buildup warning points
        for (const bp of (fp._buildupPoints || [])) {
          const dist = Math.hypot(world.x - bp.pt.x, world.y - bp.pt.y);
          if (dist < 10 / vp.scale) {
            fp.selectedBuildup  = bp;
            fp.selectedFitting  = null;
            fp.selectedDuct     = null;
            fp.selectedVav      = null;
            found = true;
            break;
          }
        }
      }

      if (!found) {
        // Fitting nodes (elbows, transitions, tees)
        for (const node of _buildFittingNodes(fp)) {
          const dist = Math.hypot(world.x - node.pt.x, world.y - node.pt.y);
          if (dist < 8 / vp.scale) {
            fp.selectedFitting = node;
            fp.selectedDuct = null;
            fp.selectedVav = null;
            found = true;
            break;
          }
        }
      }

      if (!found) {
        // Duct Segments
        fp.Duct_Plan.forEach(riser => {
          (riser.ducts || []).forEach(duct => {
            const [ptA_id, ptB_id] = duct;
            const pA = fp.Points.find(p => p.id === ptA_id);
            const pB = fp.Points.find(p => p.id === ptB_id);
            if (pA && pB) {
              const dx = pB.x - pA.x;
              const dy = pB.y - pA.y;
              const segLenSq = dx * dx + dy * dy;
              const t = ((world.x - pA.x) * dx + (world.y - pA.y) * dy) / segLenSq;
              
              // Ensure we are strictly between 0.1 and 0.9 (avoiding endpoints)
              if (t > 0.1 && t < 0.9) {
                const projX = pA.x + t * dx;
                const projY = pA.y + t * dy;
                const dist = Math.hypot(world.x - projX, world.y - projY);
                if (dist < 6 / vp.scale) {
                  fp.selectedDuct = { pA: duct[0], pB: duct[1], width: duct[2], height: duct[3], flow: duct[4] };
                  fp.selectedVav = null;
                  found = true;
                }
              }
            }
          });
        });
      }
    }

    if (!found) {
      fp.selectedDuct    = null;
      fp.selectedVav     = null;
      fp.selectedFitting = null;
      fp.selectedBuildup = null;
    }
    // Tell the select-mode handler (registered separately below, on the
    // `click` listener) that this interaction already selected a duct-plan
    // object, so it doesn't immediately clear it again — select mode has no
    // buildup/fitting/duct/VAV hit-test of its own and would otherwise
    // always fall through to its "nothing hit" branch and null this
    // selection out right after mousedown set it. `click` is a distinct
    // MouseEvent from `mousedown`, so this can't be a property on `e` (that
    // was the actual bug — the flag never survived to the click handler,
    // which read a fresh event object every time); it's set unconditionally
    // on every mousedown, so a drag that never produces a `click` can't
    // leave a stale value behind either.
    store._lastDuctPlanHit = found;
    store.update(fp);
  });

  // store.viewport is the live { scale, tx, ty } object shared with index.js.
  const vp = store.viewport;   // shorthand reference — mutate in place

  // Convert canvas-relative screen coordinates to content (plan) space.
  function _toContent(sx, sy) {
    return { x: (sx - vp.tx) / vp.scale, y: (sy - vp.ty) / vp.scale };
  }

  function _rectFromPoints(a, b) {
    return {
      minX: Math.min(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxX: Math.max(a.x, b.x),
      maxY: Math.max(a.y, b.y),
    };
  }

  function _applyBoxPointSelection(fp, rect, mode) {
    const pts = fp?.Points || [];
    const insideIds = new Set(
      pts
        .filter(p => p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY)
        .map(p => p.id)
    );

    if (!fp.selectedPoints) fp.selectedPoints = new Set();

    if (mode === 'add') {
      insideIds.forEach(id => fp.selectedPoints.add(id));
    } else if (mode === 'subtract') {
      insideIds.forEach(id => fp.selectedPoints.delete(id));
    } else {
      fp.selectedPoints = insideIds;
    }

    fp.selectedPoint = fp.selectedPoints.size === 1 ? [...fp.selectedPoints][0] : null;
    fp.selectedSegment = null;
    fp.selectedCore = false;
    _setThermalSelection(store, null, null);
  }

  // Fit all plan content to the canvas with padding.
  function _zoomExtents() {
    const fp = store.active;
    if (!fp) return;
    const xs = [], ys = [];
    (fp.wall_graph?.nodes || []).forEach(n => { xs.push(n.x); ys.push(n.y); });
    (fp.Points || []).forEach(p => { xs.push(p.x); ys.push(p.y); });
    if (!xs.length) return;
    const W = canvas.width, H = canvas.height;
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const cW = Math.max(1, maxX - minX), cH = Math.max(1, maxY - minY);
    const pad = 48;
    vp.scale = Math.min((W - 2 * pad) / cW, (H - 2 * pad) / cH);
    vp.tx = (W - cW * vp.scale) / 2 - minX * vp.scale;
    vp.ty = (H - cH * vp.scale) / 2 - minY * vp.scale;
    store.notify();
  }

  let _panStart = null; // { sx, sy, tx0, ty0 } for middle-button pan

  // initialize Canvas Grid panel controls
  setupCanvasGridPanel(() => store.notify());

  document.querySelectorAll('[data-panel-tab]').forEach(btn => {
    btn.addEventListener('click', () => setActivePanelTab(btn.dataset.panelTab || 'dashboard'));
  });
  setActivePanelTab('dashboard');

  document.querySelectorAll('[data-display-tab]').forEach(btn => {
    btn.addEventListener('click', () => setActiveDisplayTab(btn.dataset.displayTab || 'grid'));
  });
  setActiveDisplayTab('grid');

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
    // Push criteria settings onto fp so renderers can read them without extra plumbing
    if (store.active) {
      store.active._pinchVelocityThreshold = criteriaSettings.pinchVelocity;
      store.active._showPinchPoints = criteriaSettings.showPinch;
    }

    // console.log("store.mode: " + store.mode);
    DrawingService.render(ctx, store.active, {
      mode: store.mode,
      showVertices: true,
      ghost: mouse,
      constrain: mouse.constrain,
      selectionBox: mouse.selectionBox || null,
      viewport: store.viewport,
      tempArea: store.tempAreaActive ? store.tempArea : null,
      tempCore: store.tempCoreActive ? store.tempCore : null,
      // In area/core mode we should not show or highlight selected segments
      selectedSegment: (store.mode === 'area' || store.mode === 'core') ? null : store.active?.selectedSegment,
      gridSettings,
    });

    // Draw calibrate line on top of everything
    if (store.mode === 'calibrate' && _calibratePoints.length > 0) {
      ctx.save();
      ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.tx, vp.ty);
      ctx.strokeStyle = '#ff9800';
      ctx.lineWidth = 2 / vp.scale;
      ctx.setLineDash([6 / vp.scale, 4 / vp.scale]);
      ctx.beginPath();
      ctx.moveTo(_calibratePoints[0].x, _calibratePoints[0].y);
      if (_calibratePoints.length >= 2) {
        ctx.lineTo(_calibratePoints[1].x, _calibratePoints[1].y);
      } else {
        ctx.lineTo(mouse.x, mouse.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      _calibratePoints.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5 / vp.scale, 0, Math.PI * 2);
        ctx.fillStyle = '#ff9800';
        ctx.fill();
      });
      ctx.restore();
    }

    // Draw ref-scale measurement line on top of everything
    if (store.mode === 'ref-scale' && _refScalePoints.length > 0) {
      ctx.save();
      ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.tx, vp.ty);
      ctx.strokeStyle = '#4fc3f7';
      ctx.lineWidth = 2 / vp.scale;
      ctx.setLineDash([6 / vp.scale, 4 / vp.scale]);
      ctx.beginPath();
      ctx.moveTo(_refScalePoints[0].x, _refScalePoints[0].y);
      if (_refScalePoints.length >= 2) {
        ctx.lineTo(_refScalePoints[1].x, _refScalePoints[1].y);
      } else {
        ctx.lineTo(mouse.x, mouse.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      _refScalePoints.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5 / vp.scale, 0, Math.PI * 2);
        ctx.fillStyle = '#4fc3f7';
        ctx.fill();
        // Label: P1 stays anchored after scaling
        if (i === 0) {
          ctx.save();
          ctx.scale(1 / vp.scale, 1 / vp.scale);
          ctx.font = `${11}px monospace`;
          ctx.fillStyle = '#4fc3f7';
          ctx.textAlign = 'left';
          ctx.fillText('anchor', (p.x * vp.scale) + 7, (p.y * vp.scale) - 4);
          ctx.restore();
        }
      });
      ctx.restore();
    }

    const indicator = document.getElementById('canvasModeIndicator');
    if (indicator) {
      const calMsg = store.mode === 'calibrate'
        ? `Calibrate — click ${_calibratePoints.length === 0 ? 'first' : 'second'} point`
        : store.mode === 'ref-scale'
          ? `Scale Reference — click ${_refScalePoints.length === 0 ? 'first' : 'second'} point on the reference image`
          : `Mode: ${store.mode}`;
      indicator.textContent = calMsg;
    }

    // Show/hide finish buttons depending on current mode
    const finishCoreBtn = document.getElementById('finishCoreBtn');
    if (finishCoreBtn) {
      finishCoreBtn.style.display = store.mode === 'core' ? '' : 'none';
    }
    // Highlight active mode button in tool palette
    const modeButtonMap = {
      select:       'selectModeBtn',
      draw:         'drawModeBtn',
      core:         'coreModeBtn',
      'grid-origin': null,
      door:         'entranceModeBtn',
      calibrate:    'calibrateLineBtn',
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

    // Refresh thermal zones panel
    refreshThermalZonesList(store);

    ensureReferenceImageLoaded(store.active, () => store.update(store.active));
    refreshDashboardPanel(store.active, store);
    const _onScaleReference = () => {
      if (!store.active?.referenceImage) return;
      _refScalePoints = [];
      document.getElementById('refScaleOverlay').style.display = 'none';
      store.setMode('ref-scale');
      const statusEl = document.getElementById('calibrateStatus');
      if (statusEl) {
        statusEl.style.color = '#4fc3f7';
        statusEl.textContent = 'Scale Reference — click first point on the reference image';
        statusEl.style.display = 'block';
      }
      store.notify();
    };
    refreshReferencePanel(store.active, store, { onScaleReference: _onScaleReference });
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

  // 3D View toggle button
  const view3dBtn      = document.getElementById('view3dBtn');
  const canvasBg       = document.getElementById('canvasBg');
  const view3dControls = document.getElementById('view3dControls');
  const heightSlider   = document.getElementById('heightSlider');
  const heightSliderPct = document.getElementById('heightSliderPct');
  let view3d = null;
  let is3dActive = false;

  if (heightSlider && heightSliderPct) {
    heightSlider.addEventListener('input', () => {
      const cm = parseInt(heightSlider.value, 10);
      heightSliderPct.textContent = `${cm} cm`;
      if (view3d) view3d.setHeightCm(cm);
    });
  }

  if (view3dBtn && canvasBg) {
    view3dBtn.addEventListener('click', () => {
      is3dActive = !is3dActive;

      if (is3dActive) {
        // Show 3D view, hide 2D canvas
        canvas.style.display = 'none';
        if (!view3d) view3d = new View3D(canvasBg);
        view3d.show(store.active, parseInt(heightSlider?.value ?? 300, 10));
        view3dBtn.textContent = '2D View';
        view3dBtn.classList.add('active');
        if (view3dControls) view3dControls.style.display = 'flex';
      } else {
        // Show 2D canvas, pause 3D view
        if (view3d) view3d.hide();
        canvas.style.display = '';
        view3dBtn.textContent = '3D View';
        view3dBtn.classList.remove('active');
        if (view3dControls) view3dControls.style.display = 'none';
        // Trigger a 2D redraw
        store.notify();
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

  // Calibrate-by-line scale tool
  const calibrateLineBtn = document.getElementById('calibrateLineBtn');
  if (calibrateLineBtn) {
    calibrateLineBtn.addEventListener('click', () => {
      _calibratePoints = [];
      const overlay = document.getElementById('calibrateOverlay');
      if (overlay) overlay.style.display = 'none';
      store.setMode('calibrate');
      const statusEl = document.getElementById('calibrateStatus');
      if (statusEl) {
        statusEl.style.color = '#ff9800';
        statusEl.textContent = 'Click two points on the canvas to define a known distance';
        statusEl.style.display = 'block';
      }
      store.notify();
    });
  }

  const calibrateConfirmBtn = document.getElementById('calibrateConfirmBtn');
  if (calibrateConfirmBtn) {
    calibrateConfirmBtn.addEventListener('click', () => {
      if (_calibratePoints.length < 2) return;
      const dist = parseFloat(document.getElementById('calibrateDistInput')?.value || '0');
      const unit = document.getElementById('calibrateUnitSel')?.value || 'm';
      if (!isFinite(dist) || dist <= 0) { alert('Enter a positive distance.'); return; }

      const dx = _calibratePoints[1].x - _calibratePoints[0].x;
      const dy = _calibratePoints[1].y - _calibratePoints[0].y;
      const pixelDist = Math.hypot(dx, dy);
      if (pixelDist < 1) { alert('Points are too close together.'); return; }

      const pxPerUnit = pixelDist / dist;
      setScalePixelsPerUnit(pxPerUnit, unit);
      if (store.active) store.active.units = { length: unit, pxPerUnit };

      // Sync the toolbar canvas-width inputs
      const canvasWidthEl = document.getElementById('canvasWidthValue');
      const canvasUnitEl  = document.getElementById('canvasUnitSelect');
      if (canvasWidthEl && canvasUnitEl) {
        canvasUnitEl.value   = unit;
        canvasWidthEl.value  = (canvas.width / pxPerUnit).toFixed(3);
      }

      document.getElementById('calibrateOverlay').style.display = 'none';
      const statusEl = document.getElementById('calibrateStatus');
      if (statusEl) statusEl.style.display = 'none';
      _calibratePoints = [];
      store.setMode('select');
      store.notify();
    });
  }

  const calibrateCancelBtn = document.getElementById('calibrateCancelBtn');
  if (calibrateCancelBtn) {
    calibrateCancelBtn.addEventListener('click', () => {
      document.getElementById('calibrateOverlay').style.display = 'none';
      const statusEl = document.getElementById('calibrateStatus');
      if (statusEl) statusEl.style.display = 'none';
      _calibratePoints = [];
      store.setMode('select');
      store.notify();
    });
  }

  function _exitRefScaleMode() {
    document.getElementById('refScaleOverlay').style.display = 'none';
    const statusEl = document.getElementById('calibrateStatus');
    if (statusEl) statusEl.style.display = 'none';
    _refScalePoints = [];
    store.setMode('select');
  }

  const refScaleConfirmBtn = document.getElementById('refScaleConfirmBtn');
  if (refScaleConfirmBtn) {
    refScaleConfirmBtn.addEventListener('click', () => {
      if (_refScalePoints.length < 2) return;
      const fp = store.active;
      if (!fp?.referenceImage) return;

      const dist = parseFloat(document.getElementById('refScaleDistInput')?.value || '0');
      const unit = document.getElementById('refScaleUnitSel')?.value || 'm';
      if (!isFinite(dist) || dist <= 0) { alert('Enter a positive distance.'); return; }

      const ref = fp.referenceImage;
      const pxPerUnit = fp.units?.pxPerUnit || 1;

      // Distance between the two clicked points in plan units
      const dx = _refScalePoints[1].x - _refScalePoints[0].x;
      const dy = _refScalePoints[1].y - _refScalePoints[0].y;
      const d_plan_current = Math.hypot(dx, dy) / pxPerUnit;
      if (d_plan_current < 0.0001) { alert('Points are too close together.'); return; }

      // Convert user-input distance and current plan distance both to mm for ratio
      const unitToMm = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
      const planUnit = fp.units?.length || 'mm';
      const d_real_mm = dist * (unitToMm[unit] || 1);
      const d_current_mm = d_plan_current * (unitToMm[planUnit] || 1);
      const scaleFactor = d_real_mm / d_current_mm;

      const naturalAspect = (ref.naturalHeight || 1) / (ref.naturalWidth || 1);
      const old_width = Number.isFinite(ref.width) && ref.width > 0 ? ref.width : 10;
      const old_height = Number.isFinite(ref.height) && ref.height > 0 ? ref.height : old_width * naturalAspect;

      // Fractional position of P1 within the image — keep it anchored after scaling
      const p1_plan = { x: _refScalePoints[0].x / pxPerUnit, y: _refScalePoints[0].y / pxPerUnit };
      const f1_x = (p1_plan.x - (ref.x || 0)) / old_width;
      const f1_y = (p1_plan.y - (ref.y || 0)) / old_height;

      const new_width = old_width * scaleFactor;
      const new_height = new_width * naturalAspect;

      ref.width = new_width;
      ref.x = p1_plan.x - f1_x * new_width;
      ref.y = p1_plan.y - f1_y * new_height;

      _exitRefScaleMode();
      store.update(fp);
    });
  }

  const refScaleCancelBtn = document.getElementById('refScaleCancelBtn');
  if (refScaleCancelBtn) {
    refScaleCancelBtn.addEventListener('click', () => {
      _exitRefScaleMode();
      store.notify();
    });
  }

  // Snapshot button (tool palette)
  const snapshotSolutionBtn = document.getElementById('snapshotSolutionBtn');
  if (snapshotSolutionBtn) {
    snapshotSolutionBtn.addEventListener('click', () => {
      if (!store.active) return;
      const nameInput = document.getElementById('snapshotNameInput');
      const baseName  = nameInput?.value?.trim() || `Solution ${store.solutions.length + 1}`;
      store.solutions.push({
        id:        Date.now(),
        name:      baseName,
        timestamp: new Date().toLocaleTimeString(),
        json:      store.active.toJSON(),
        metrics:   _solutionMetrics(store.active),
      });
      if (nameInput) nameInput.value = '';
      refreshSolutionsPanel(store);
      setActivePanelTab('snapshots');
    });
  }

  // Snapshot button (solutions panel)
  const snapshotBtn = document.getElementById('snapshotBtn');
  if (snapshotBtn) {
    snapshotBtn.addEventListener('click', () => {
      snapshotSolutionBtn?.click(); // reuse the same handler
    });
  }

  // Setup criteria panel
  setupCriteriaPanel(store);
  // Initial solutions panel render
  refreshSolutionsPanel(store);

  // ── Server status indicator ─────────────────────────────────────────────────
  const _serverDot   = document.getElementById('serverStatusDot');
  const _serverLabel = document.getElementById('serverStatusLabel');

  function _applyServerStatus({ status, message }) {
    if (!_serverDot || !_serverLabel) return;
    const configs = {
      starting: { dot: 'dot-starting', label: 'server starting…' },
      ready:    { dot: 'dot-ready',    label: 'server ready' },
      error:    { dot: 'dot-error',    label: message || 'server error' },
      offline:  { dot: 'dot-offline',  label: 'server offline' },
    };
    const cfg = configs[status] ?? configs.offline;
    _serverDot.className   = `server-dot ${cfg.dot}`;
    _serverLabel.textContent = cfg.label;
    _serverLabel.title = message || '';
  }

  if (window.electronAPI?.onServerStatus) {
    window.electronAPI.onServerStatus(_applyServerStatus);
  } else {
    // Web mode: poll the health endpoint directly
    _applyServerStatus({ status: 'starting' });
    const _pollHealth = async () => {
      const ok = await checkHealth().catch(() => false);
      _applyServerStatus({ status: ok ? 'ready' : 'offline' });
    };
    _pollHealth();
    setInterval(_pollHealth, 10000);
  }

  // Track mouse movement and constraint flag (Shift key)
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Middle-button pan
    if (_panStart) {
      vp.tx = _panStart.tx0 + (e.clientX - _panStart.sx);
      vp.ty = _panStart.ty0 + (e.clientY - _panStart.sy);
      store.notify();
      return;
    }

    const c = _toContent(sx, sy);
    mouse.x = c.x;
    mouse.y = c.y;
        if (_boxSelect?.active) {
          _boxSelect.end = { x: c.x, y: c.y };
          _boxSelect.mode = e.altKey ? 'subtract' : (e.shiftKey ? 'add' : 'replace');
          const dragDx = sx - _boxSelect.startScreen.x;
          const dragDy = sy - _boxSelect.startScreen.y;
          _boxSelect.moved = (dragDx * dragDx + dragDy * dragDy) > 16;
          mouse.selectionBox = {
            start: _boxSelect.start,
            end: _boxSelect.end,
          };
          store.notify();
          return;
        }

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
    // Middle button: start panning
    if (e.button === 1) {
      e.preventDefault();
      _panStart = { sx: e.clientX, sy: e.clientY, tx0: vp.tx, ty0: vp.ty };
      return;
    }
    if (store.mode === "select" && store.active.selectedSegment) {
      const rect = canvas.getBoundingClientRect();
      const c = _toContent(e.clientX - rect.left, e.clientY - rect.top);
      store.dragStart = { x: c.x, y: c.y };
      store.active.draggingSegment = store.active.selectedSegment;
      return;
    }

    if (store.mode === 'select' && e.button === 0 && store.active) {
      // When a core interior is selected (selectedCore is set), skip box-select
      // so the click event fires freely and can deselect or pick a wall/segment.
      if (store.active.selectedCore) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const c = _toContent(sx, sy);
      _boxSelect = {
        active: true,
        start: { x: c.x, y: c.y },
        end: { x: c.x, y: c.y },
        startScreen: { x: sx, y: sy },
        moved: false,
        mode: e.altKey ? 'subtract' : (e.shiftKey ? 'add' : 'replace'),
      };
      mouse.selectionBox = { start: _boxSelect.start, end: _boxSelect.end };
      store.notify();
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    if (e.button === 1) {
      _panStart = null;
      return;
    }
    if (store.mode === "select" && store.active) {
      if (_boxSelect?.active) {
        const cRect = _rectFromPoints(_boxSelect.start, _boxSelect.end);
        const didDrag = _boxSelect.moved;
        const mode = _boxSelect.mode;
        _boxSelect = null;
        mouse.selectionBox = null;

        if (didDrag) {
          _applyBoxPointSelection(store.active, cRect, mode);
          _suppressNextClick = true;
          store.update(store.active);
          return;
        }
      }

      store.active.draggingSegment = null;
      store.dragStart = null;
      store.update(store.active); // commit final state
    }
  });

  document.getElementById("finishCoreBtn").addEventListener("click", () => {
    if (store.mode === "core") {
      commitCore(store);
    }
  });

  canvas.addEventListener('click', (e) => {
    if (_suppressNextClick) {
      _suppressNextClick = false;
      return;
    }

    if (!store.active) return;

    const rect = canvas.getBoundingClientRect();
    let { x, y } = _toContent(e.clientX - rect.left, e.clientY - rect.top);
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
        if (typeof store.active.markCoreAdjacentPointsAsEntry === 'function') {
          store.active.markCoreAdjacentPointsAsEntry();
        }
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

    // CALIBRATE MODE — collect two content-space points
    if (store.mode === 'calibrate') {
      _calibratePoints.push({ x, y });
      if (_calibratePoints.length === 2) {
        // Position the overlay near the midpoint in screen space
        const midContent = {
          x: (_calibratePoints[0].x + _calibratePoints[1].x) / 2,
          y: (_calibratePoints[0].y + _calibratePoints[1].y) / 2,
        };
        const screenX = midContent.x * vp.scale + vp.tx;
        const screenY = midContent.y * vp.scale + vp.ty;
        const overlay = document.getElementById('calibrateOverlay');
        if (overlay) {
          overlay.style.display = 'flex';
          overlay.style.left = `${Math.max(0, screenX + 14)}px`;
          overlay.style.top  = `${Math.max(0, screenY - 40)}px`;
          document.getElementById('calibrateDistInput')?.focus();
        }
      }
      store.notify();
      return;
    }

    // REF-SCALE MODE — collect two content-space points for reference image scaling
    if (store.mode === 'ref-scale') {
      _refScalePoints.push({ x, y });
      const statusEl = document.getElementById('calibrateStatus');
      if (_refScalePoints.length === 1 && statusEl) {
        statusEl.textContent = 'Scale Reference — click second point on the reference image';
      }
      if (_refScalePoints.length === 2) {
        const midContent = {
          x: (_refScalePoints[0].x + _refScalePoints[1].x) / 2,
          y: (_refScalePoints[0].y + _refScalePoints[1].y) / 2,
        };
        const screenX = midContent.x * vp.scale + vp.tx;
        const screenY = midContent.y * vp.scale + vp.ty;
        const overlay = document.getElementById('refScaleOverlay');
        if (overlay) {
          overlay.style.display = 'flex';
          overlay.style.left = `${Math.max(0, screenX + 14)}px`;
          overlay.style.top = `${Math.max(0, screenY - 40)}px`;
          document.getElementById('refScaleDistInput')?.focus();
        }
        if (statusEl) statusEl.style.display = 'none';
      }
      store.notify();
      return;
    }

    if (store.mode === "area") {
      const rect = canvas.getBoundingClientRect();
      let { x, y } = _toContent(e.clientX - rect.left, e.clientY - rect.top);

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
      let { x, y } = _toContent(e.clientX - rect.left, e.clientY - rect.top);
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
          // Remove the duplicate closing vertex that was just pushed, then commit
          store.tempCore.pop();
          commitCore(store);
          store.setMode('select');
          store.update(store.active);
          return;
        }
      }

      store.notify();
      return;
    }

    // ENTRY POINT PICK MODE: intercept canvas click to assign a grid point to thermal zones
    if (store._entryPickTarget) {
      const allPts = store.active.Points || [];
      let nearPt = null, nearDist = 12;
      allPts.forEach(p => { const d = Math.hypot(x - p.x, y - p.y); if (d < nearDist) { nearDist = d; nearPt = p; } });
      if (nearPt) {
        nearPt.entryPoint = true;
        if (!nearPt.thermalRegions) nearPt.thermalRegions = [];
        const incoming = store._entryPickTarget.regions || [];
        incoming.forEach(r => {
          const exists = nearPt.thermalRegions.some(er => er.zoneIndex === r.zoneIndex && er.vavZoneIndex === r.vavZoneIndex);
          if (!exists) nearPt.thermalRegions.push({ zoneIndex: r.zoneIndex, vavZoneIndex: r.vavZoneIndex });
        });
        nearPt.thermalZoneIndices = [...new Set(nearPt.thermalRegions.map(r => r.zoneIndex))];
      }
      store._entryPickTarget = null;
      document.getElementById('canvas').style.cursor = '';
      store.update(store.active);
      return;
    }

    // SELECT MODE: select segment and return
    if (store.mode === "select") {
      // A duct-plan object (buildup point, fitting, duct segment, VAV) was
      // already selected by the mousedown handler above — don't immediately
      // clear it via the "nothing hit" branch below.
      if (store._lastDuctPlanHit) {
        store._lastDuctPlanHit = false;
        return;
      }

      // Check for nearby grid point first (within 8px) — grid points respect pointsLayer,
      // but entry points are always selectable when the Entry_Points layer is on.
      const allPts = store.active.Points || [];
      const _pointsOn = store.active.layers?.Points !== false;
      const _entryOn  = store.active.layers?.Entry_Points !== false;
      const pts = allPts.filter(p => p.entryPoint ? _entryOn : _pointsOn);
      let nearPt = null, nearDist = 8;
      pts.forEach(p => { const d = Math.hypot(x - p.x, y - p.y); if (d < nearDist) { nearDist = d; nearPt = p; } });
      if (nearPt) {
        _setThermalSelection(store, null, null);
        store.active.selectedBuildup = null;
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

      const thermalHit = store.active.layers?.Thermal_Zones !== false
        ? pickThermalRegionAtPoint(store.active, x, y)
        : null;
      if (thermalHit) {
        store.active.selectedBuildup = null;
        store.active.selectedSegment = null;
        store.active.selectedCore = false;
        store.active.selectedPoints = new Set();
        store.active.selectedPoint = null;
        const hit = thermalHit;
        if (e.shiftKey) {
          // Shift-click: toggle this specific region (zone+subzone pair) in the selection list.
          if (!store._selectedRegions) store._selectedRegions = [];
          const idx = store._selectedRegions.findIndex(r => r.zoneIndex === hit.zoneIndex && r.vavZoneIndex === hit.vavZoneIndex);
          if (idx >= 0) {
            store._selectedRegions = store._selectedRegions.filter((_, i) => i !== idx);
          } else {
            store._selectedRegions = [...store._selectedRegions, { zoneIndex: hit.zoneIndex, vavZoneIndex: hit.vavZoneIndex }];
          }
          if (!Number.isInteger(store.active.selectedThermalZoneIndex)) {
            _setThermalSelection(store, hit.zoneIndex, hit.vavZoneIndex);
          }
        } else {
          // Plain click: single region selected.
          store._selectedRegions = [{ zoneIndex: hit.zoneIndex, vavZoneIndex: hit.vavZoneIndex }];
          _setThermalSelection(store, hit.zoneIndex, hit.vavZoneIndex);
        }
        store.active._thermalSelectionRegions = store._selectedRegions;
        refreshThermalZonesList(store);
        refreshThermalEditor(store);
        store.notify();
        return;
      }

      const seg = findClosestSegment(store.active, { x, y });
      if (seg) {
        _setThermalSelection(store, null, null);
        store.active.selectedBuildup = null;
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
        // Check if the click lands inside any core polygon → select that core
        let hitCoreId = null;
        if (store.active.layers?.Core_Boundary !== false) {
          for (const coreBdry of (store.active.Core_Boundary || [])) {
            if (!coreBdry) continue;
            const corePoly = Object.keys(coreBdry)
              .filter(k => /^Pt_\d+$/.test(k))
              .sort((a, b) => parseInt(a.slice(3)) - parseInt(b.slice(3)))
              .map(k => coreBdry[k]);
            if (corePoly.length >= 3 && store.active._isPointInPolygon(x, y, corePoly)) {
              hitCoreId = coreBdry._coreId || null;
              break;
            }
          }
        }
        if (hitCoreId) {
          _setThermalSelection(store, null, null);
          store.active.selectedBuildup = null;
          store.active.selectedCore = hitCoreId;
          store.active.selectedSegment = null;
          store.active.selectedPoints = new Set();
          store.active.selectedPoint = null;
          store.update(store.active);
        } else {
          _setThermalSelection(store, null, null);
          store.active.selectedBuildup = null;
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
      const fp = store.active;
      if (!fp) return;
      if (fp.selectedCore) {
        fp.deleteCore(fp.selectedCore);
        store.update(fp);
      } else if (fp.selectedSegment != null) {
        const edge = fp.wall_graph.edges[fp.selectedSegment];
        if (edge?.wallType === 'core') {
          fp.deleteCore(_findCoreIdForEdge(fp, edge));
          store.update(fp);
        }
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
    // Escape cancels entry point pick mode
    if (e.key === "Escape" && store._entryPickTarget) {
      store._entryPickTarget = null;
      document.getElementById('canvas').style.cursor = '';
      refreshThermalEditor(store);
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
    if (store.mode === 'ref-scale' && e.key === 'Escape') {
      _exitRefScaleMode();
      store.notify();
    }
  });

  // Scroll wheel: zoom in/out centred on cursor
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newScale = Math.max(0.02, Math.min(100, vp.scale * factor));
    // Keep the content point under the cursor fixed
    vp.tx = sx - (sx - vp.tx) * (newScale / vp.scale);
    vp.ty = sy - (sy - vp.ty) * (newScale / vp.scale);
    vp.scale = newScale;
    store.notify();
  }, { passive: false });

  // Keyboard: Shift+E = zoom extents
  document.addEventListener('keydown', (e) => {
    if (e.key === 'E' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // Ignore if focus is inside a text input
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      _zoomExtents();
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
  // GRID GENERATION MODAL
  // ═══════════════════════════════════════════════════════════

  const _gridModal = document.getElementById('gridGenModal');

  function _openGridModal() {
    if (_gridModal) _gridModal.style.display = 'block';
  }
  function _closeGridModal() {
    if (_gridModal) _gridModal.style.display = 'none';
  }

  document.getElementById('openGridModalBtn')?.addEventListener('click', _openGridModal);
  document.getElementById('closeGridModalBtn')?.addEventListener('click', _closeGridModal);

  // STRUCTURAL SETTINGS MODAL
  // ═══════════════════════════════════════════════════════════

  const _structModal = document.getElementById('structuralSettingsModal');
  let _structSavedState = null;

  function _structModalSnapshot() {
    return {
      method:       document.getElementById('structMethodSelect')?.value ?? 'heuristic',
      material:     document.getElementById('structMaterialSelect')?.value ?? 'steel+concrete',
      direction:    document.querySelector('input[name="structBeamDir"]:checked')?.value ?? 'horizontal',
      beamSpan:     parseFloat(document.getElementById('structBeamSpanInput')?.value ?? '9'),
      beamDistance: parseFloat(document.getElementById('structBeamDistInput')?.value ?? '9'),
    };
  }

  function _structModalRestore(state) {
    if (!state) return;
    const m = document.getElementById('structMethodSelect');
    if (m) m.value = state.method;
    const mat = document.getElementById('structMaterialSelect');
    if (mat) mat.value = state.material;
    const dir = document.querySelector(`input[name="structBeamDir"][value="${state.direction}"]`);
    if (dir) dir.checked = true;
    const spanEl = document.getElementById('structBeamSpanInput');
    if (spanEl) spanEl.value = state.beamSpan ?? 9;
    const distEl = document.getElementById('structBeamDistInput');
    if (distEl) distEl.value = state.beamDistance ?? 9;
  }

  function _openStructModal() {
    _structSavedState = _structModalSnapshot();
    if (_structModal) _structModal.style.display = 'block';
  }
  function _closeStructModal() { if (_structModal) _structModal.style.display = 'none'; }
  function _cancelStructModal() { _structModalRestore(_structSavedState); _closeStructModal(); }

  document.getElementById('openStructuralModalBtn')?.addEventListener('click', _openStructModal);
  document.getElementById('closeStructuralModalBtn')?.addEventListener('click', _cancelStructModal);
  document.getElementById('structSettingsOkBtn')?.addEventListener('click', _closeStructModal);
  document.getElementById('structSettingsCancelBtn')?.addEventListener('click', _cancelStructModal);

  function _getStructuralConfig() {
    const method   = document.getElementById('structMethodSelect')?.value ?? 'heuristic';
    const material = document.getElementById('structMaterialSelect')?.value ?? 'steel+concrete';
    const [beamMat, slabMat] = material.split('+');
    const beamDir  = document.querySelector('input[name="structBeamDir"]:checked')?.value ?? 'horizontal';
    const beamSpan = parseFloat(document.getElementById('structBeamSpanInput')?.value ?? '9');
    const beamDist = parseFloat(document.getElementById('structBeamDistInput')?.value ?? '9');
    return {
      structural_planning: {
        method,
        beam_material: beamMat,
        slab_material: slabMat,
        beam_direction: beamDir,
        beamSpan:    beamSpan,
        beamSpacing: beamDist,
      },
    };
  }

  function _showStructuralFailureHint(errorMsg, structCfg, aiError) {
    if (!aiError) return;
    const err = errorMsg ?? '';
    const sp  = structCfg?.structural_planning ?? {};
    const isNoPoints  = err.includes('no allowed column grid points');
    const isInfeasible = err.includes('feasible column layout');
    if (!isNoPoints && !isInfeasible) return; // generic handler already set the message
    const gridLabel   = `${sp.beamSpan ?? 9}×${sp.beamSpacing ?? 9} m`;
    const methodLabel = sp.method === 'optimisation' ? 'Optimisation' : 'Heuristic';
    const dirLabel    = sp.beam_direction === 'vertical' ? 'vertical' : 'horizontal';
    let msg;
    if (isNoPoints) {
      msg = `Structural: no valid column positions for a ${gridLabel} grid — the floorplan may be too small for this span/distance. ` +
            `Try a smaller beam span or distance in Structural Settings.`;
    } else {
      msg = `Structural: solver could not place columns with ${methodLabel} method, ${gridLabel} grid, ${dirLabel} beams. ` +
            `Try: switch to Heuristic method, use a smaller beam span or distance, or change beam direction.`;
    }
    aiError.style.display = 'block';
    aiError.style.color = '';
    aiError.textContent = msg;
  }

  // DUCT ROUTING SETTINGS MODAL
  // ═══════════════════════════════════════════════════════════
  const _ductModal = document.getElementById('ductRoutingSettingsModal');
  function _openDuctModal() { if (_ductModal) _ductModal.style.display = 'block'; }
  function _closeDuctModal() { if (_ductModal) _ductModal.style.display = 'none'; }

  document.getElementById('openDuctSettingsBtn')?.addEventListener('click', _openDuctModal);
  document.getElementById('closeDuctSettingsModalBtn')?.addEventListener('click', _closeDuctModal);
  document.getElementById('ductSettingsOkBtn')?.addEventListener('click', () => {
    const read = id => { const v = parseFloat(document.getElementById(id)?.value); return isFinite(v) && v > 0 ? v : null; };
    for (const dir of ['north', 'east', 'south', 'west', 'internal']) {
      const v = read(`ductLps_${dir}`);
      if (v) ductRoutingSettings.lpsPerM2[dir] = v;
    }
    const vel = read('ductMaxVelocityInput');
    if (vel) { ductRoutingSettings.maxVelocity = vel; criteriaSettings.pinchVelocity = vel; }
    const bup = read('ductMaxBuildupInput');
    if (bup) {
      ductRoutingSettings.maxBuildupMm = bup;
      if (store.active) { if (!store.active.buildupSettings) store.active.buildupSettings = {}; store.active.buildupSettings.thresholdMm = bup; store.update(store.active); }
    }
    _closeDuctModal();
  });

  document.getElementById('applyDuctLpsBtn')?.addEventListener('click', () => {
    if (!store.active) return;
    const orientMap = { north: 'north', east: 'east', south: 'south', west: 'west', internal: 'internal', perimeter: null };
    (store.active.Thermal_Zones || []).forEach(zone => {
      const orient = (zone.orientation ?? '').toLowerCase();
      const isInternal = zone.type === 'internal' || zone.orientation == null;
      const key = isInternal ? 'internal' : (orient in ductRoutingSettings.lpsPerM2 ? orient : null);
      if (key && !Number.isFinite(zone.air_requirement)) {
        zone.air_requirement = ductRoutingSettings.lpsPerM2[key];
      }
    });
    store.update(store.active);
    refreshThermalZonesList(store);
    _closeDuctModal();
  });

  const generateGridBtn   = document.getElementById('generateGridBtn');
  const clearGridBtn      = document.getElementById('clearGridBtn');
  const gridSpacingInput  = document.getElementById('gridSpacingInput');
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
      store._pendingGridSpacing = spacing;
      store.setMode('grid-origin');
      if (gridOriginDisplay) gridOriginDisplay.textContent = 'Click a wall node to set origin…';
      _closeGridModal();
      store.notify();
    });
  }

  if (clearGridBtn) {
    clearGridBtn.addEventListener('click', () => {
      if (!store.active) return;
      store.active.clearGrid();
      store.update(store.active);
    });
  }

  const resetGridBtn = document.getElementById('resetGridBtn');
  if (resetGridBtn) {
    resetGridBtn.addEventListener('click', () => {
      if (!store.active) return;
      store.active.resetGridPoints();
      store.update(store.active);
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
    thermalZonesLayer: 'Thermal_Zones',
    thermalRegionsLayer: 'Thermal_Regions',
    vavControlZonesLayer: 'VAV_Control_Zones',
    beamsLayer: 'Beams',
    pointsLayer: 'Points',
    entryPointsLayer: 'Entry_Points',
    entryConnectionsLayer: 'Entry_Connections',
    edgesLayer: 'Edges',
    ductPlanLayer: 'Duct_Plan'
  };

  const _defaultOnLayers = new Set([
    'Plan_Boundary', 'Boundary_Area', 'Core_Boundary', 'Core_Area',
    'Columns', 'Exclusion_Areas', 'Thermal_Zones', 'VAV_Control_Zones', 'Entry_Points', 'Entry_Connections',
  ]);

  Object.entries(layerCheckboxes).forEach(([checkboxId, layerName]) => {
    const checkbox = document.getElementById(checkboxId);
    if (checkbox) {
      // Set initial state - use default if store.active is null
      checkbox.checked = store.active?.layers?.[layerName] ?? _defaultOnLayers.has(layerName);
      
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

  // Quick-save: write to the current file path silently; fall back to Save As if no path yet.
  function _buildSavePayload() {
    const data = store.active.toJSON();
    if (store.solutions.length) data.snapshots = store.solutions.map(s => ({ ...s }));
    return data;
  }

  function _flashBtn(btn, successText, failText, ok) {
    const orig = btn.textContent;
    btn.textContent = ok ? successText : failText;
    btn.disabled = true;
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1400);
  }

  const saveQuickBtn = document.getElementById("saveQuickBtn");
  if (saveQuickBtn) {
    saveQuickBtn.addEventListener("click", async () => {
      if (!store.active) return;
      if (_currentFilePath) {
        try {
          const result = await window.electronAPI.saveFloorplanSilent({
            filePath: _currentFilePath,
            payload: _buildSavePayload()
          });
          _flashBtn(saveQuickBtn, "Saved ✓", "Save failed", result?.success);
          if (!result?.success) console.warn("Quick save failed:", result?.error);
        } catch (err) {
          _flashBtn(saveQuickBtn, "Saved ✓", "Save failed", false);
          console.error("Quick save error:", err);
        }
      } else {
        saveFloorplanBtn?.click();
      }
    });
  }

  // Save As: serialise and send to main via preload API
  const saveFloorplanBtn = document.getElementById("saveFloorplanBtn");
  if (saveFloorplanBtn) {
    saveFloorplanBtn.addEventListener("click", async () => {
      if (!store.active) return;
      try {
        const result = await window.electronAPI.saveFloorplan({
          filenameSuggested: `floorplan-${store.active.name}.json`,
          payload: _buildSavePayload()
        });
        if (result?.success) {
          console.log("Floorplan saved:", result.path);
          _currentFilePath = result.path;
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
                    // Sync the interactive viewport so zoom/pan starts from the fitted view
                    vp.scale = viewScale;
                    vp.tx    = offsetX;
                    vp.ty    = offsetY;
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
          _currentFilePath = result.path;

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

          // Restore snapshots that were saved alongside this floorplan.
          if (Array.isArray(result.data.snapshots) && result.data.snapshots.length) {
            store.solutions = result.data.snapshots;
          } else {
            store.solutions = [];
          }
          refreshSolutionsPanel(store);

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

  const btnOptimise        = document.getElementById('optimiseBtn');
  const btnOptimiseStructure = document.getElementById('optimiseStructureBtn');
  const btnOptimiseThermal   = document.getElementById('optimiseThermalBtn');
  const btnOptimiseDuct      = document.getElementById('optimiseDuctBtn');
  const btnStop     = document.getElementById('stopOptBtn');
  const btnContinue = document.getElementById('continueOptBtn');
  const aiError = document.getElementById('ai-error');

  // All trigger buttons — disabled together while any run is active
  const _allOptBtns = [btnOptimise, btnOptimiseStructure, btnOptimiseThermal, btnOptimiseDuct].filter(Boolean);

  // Shared run-time state (only one run at a time)
  let _abortCtrl   = null;
  let _activeJobId = null;

  // ── Core runner ─────────────────────────────────────────────────────────────
  // stageLogic: async (fp, runStage, waitForContinue, aiError) => void
  const runFlow = async (triggerBtn, stageLogic) => {
    if (_abortCtrl) return; // already running
    const fp = store.active;
    if (!fp) return;

    _abortCtrl = new AbortController();

    _allOptBtns.forEach(b => { b.disabled = true; });
    triggerBtn.textContent = 'running… 0s';
    if (btnStop) btnStop.style.display = '';
    if (btnContinue) btnContinue.style.display = 'none';
    if (aiError) aiError.style.display = 'none';

    _activeJobId = null;
    if (btnStop) {
      btnStop.onclick = async () => {
        _abortCtrl.abort();
        if (_activeJobId) await cancelOptimisation(_activeJobId);
        if (aiError) { aiError.style.display = 'block'; aiError.textContent = 'Optimisation stopped.'; }
      };
    }

    const statusEl = document.getElementById('optimiseStatus');
    const _optStart = Date.now();
    const _phaseLabels = { segmentation: 'regions', structural: 'structural', zones: 'thermal zones', duct: 'duct routing' };
    const _phaseOrder  = ['structural', 'segmentation', 'zones', 'duct'];
    let _currentPhase = 'structural';
    let _isPaused = false;
    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'starting…'; }
    const _timerInterval = setInterval(() => {
      if (_isPaused) return;
      const elapsed = Math.round((Date.now() - _optStart) / 1000);
      if (statusEl) statusEl.textContent = `phase: ${_phaseLabels[_currentPhase] || _currentPhase}  ${elapsed}s`;
      triggerBtn.textContent = `running… ${elapsed}s`;
    }, 1000);

    const waitForContinue = (_label, message) => new Promise((resolve) => {
      if (!btnContinue) { resolve(window.confirm(message)); return; }
      _isPaused = true;
      if (statusEl) statusEl.textContent = `paused: ${message}`;
      if (aiError) { aiError.style.display = 'block'; aiError.style.color = '#e6a817'; aiError.textContent = message; }
      btnContinue.textContent = 'continue';
      btnContinue.style.display = '';
      const onAbort = () => { _isPaused = false; btnContinue.style.display = 'none'; btnContinue.onclick = null; resolve(false); };
      btnContinue.onclick = () => {
        _isPaused = false;
        _abortCtrl.signal.removeEventListener('abort', onAbort);
        btnContinue.style.display = 'none';
        btnContinue.onclick = null;
        resolve(true);
      };
      _abortCtrl.signal.addEventListener('abort', onAbort, { once: true });
    });

    // Apply a partial or final data payload to the active floorplan
    const applyData = (d) => {
      if (!d) return;
      if (Array.isArray(d.thermal_zones) && d.thermal_zones.length) {
        _mergeThermalZonesFromBackend(fp, d.thermal_zones);
      }
      if (d.thermal_zones) refreshThermalZonesList(store);

      if (d.structural_components) {
        const sc = d.structural_components;
        const mmMap = { mm: 1, cm: 10, m: 1000, 'in': 25.4, ft: 304.8 };
        const srcUnit = sc?.units?.length || d?.units?.length || fp.units?.length || 'm';
        const mmPerSrc = mmMap[srcUnit] ?? 1000;
        const mmPerCanvas = mmMap[fp.units?.length ?? 'm'] ?? 1000;
        const lenToPx = v => v * (fp.units?.pxPerUnit ?? 1) * mmPerSrc / mmPerCanvas;
        if (Array.isArray(sc.columns) && sc.columns.length) {
          fp.Columns = sc.columns
            .map((c, i) => {
              if (Array.isArray(c)) {
                const pts = c.filter(p => p && typeof p.x === 'number' && typeof p.y === 'number');
                if (!pts.length) return null;
                const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
                const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
                return { id: `Column_${i}`, x: lenToPx(cx), y: lenToPx(cy) };
              }
              return { ...c, x: lenToPx(c.x), y: lenToPx(c.y) };
            })
            .filter(Boolean);
          const EPS = 2;
          (fp.Points || []).forEach(pt => {
            if (fp.Columns.some(col => Math.abs(col.x - pt.x) < EPS && Math.abs(col.y - pt.y) < EPS)) {
              pt.mechanical = false;
            }
          });
        }
        if (Array.isArray(sc.beams) && sc.beams.length) {
          fp.Beams = sc.beams
            .map(b => {
              if (!b?.start || !b?.end) return null;
              return { ...b, start: { x: lenToPx(b.start.x), y: lenToPx(b.start.y) }, end: { x: lenToPx(b.end.x), y: lenToPx(b.end.y) } };
            })
            .filter(Boolean);

          // A grid point where a beam meets the core can't function as an
          // entry point — a beam runs straight through it. Decommission any
          // such point's entry-point assignment.
          const corePolys = (fp.Core_Boundary || []).map(core =>
            Object.keys(core)
              .filter(k => /^Pt_\d+$/.test(k))
              .sort((a, b) => parseInt(a.slice(3)) - parseInt(b.slice(3)))
              .map(k => core[k])
          ).filter(poly => poly.length >= 3);

          if (corePolys.length) {
            const beamEPS = 2;
            const beamEndpoints = fp.Beams.flatMap(b => [b.start, b.end]).filter(Boolean);
            (fp.Points || []).forEach(pt => {
              if (!pt.entryPoint) return;
              const touchesBeam = beamEndpoints.some(bp => Math.abs(bp.x - pt.x) < beamEPS && Math.abs(bp.y - pt.y) < beamEPS);
              if (!touchesBeam) return;
              const onCoreEdge = corePolys.some(poly => fp._isPointOnPolygonEdge(pt.x, pt.y, poly, beamEPS));
              if (onCoreEdge) pt.entryPoint = false;
            });
          }
        }
        fp.layers.Beams   = true;
        fp.layers.Columns = true;

        const cvc = d.cost_volume_calculation;
        const _pendingCfg = fp._structCfgPending || {};
        fp._structCfgPending = null;
        fp.Structural_Meta = {
          beamMaterial:  cvc?.material     || sc.beam_material  || null,
          slabMaterial:  sc.slab_material  || null,
          slabDepthMm:   sc.slab_depth     ?? null,
          beamDepthMm:   sc.beams?.[0]?.depth  ?? null,
          beamWidthMm:   sc.beams?.[0]?.width  ?? null,
          columnWidthMm: sc.columns?.[0]?.width ?? null,
          beamDirection: _pendingCfg.beam_direction ?? null,
          beamSpanM:     _pendingCfg.beamSpan       ?? null,
          // null (not a zeroed object) when the backend never produced a
          // result — e.g. it threw (d.cost_volume_calculation_error set) or
          // this snapshot predates cost calculation entirely. A real result,
          // even an honest $0 (no beams placed), is kept as-is rather than
          // hidden — see _hasCosts/dashboard rendering below.
          costsError: d.cost_volume_calculation_error || null,
          costs: cvc ? {
            columns: cvc.columns_cost ?? 0,
            beams:   cvc.beam_cost    ?? 0,
            slab:    cvc.slab_cost    ?? 0,
            total:   cvc.total_cost   ?? 0,
          } : null,
        };
      }

      const rawDuctPlan = d?.mechanical_components?.duct_plan || d?.mechanical_components?.ductPlan || d?.ductPlan || d?.Duct_Plan;
      if (Array.isArray(rawDuctPlan)) {
        fp.Duct_Plan = rawDuctPlan;
        if (Array.isArray(fp.Edges) && fp.Edges.length && Array.isArray(fp.Points) && fp.Points.length) {
          const pointIndexById = new Map(fp.Points.map((p, i) => [p.id, i]));
          const idxOf = v => typeof v === 'number' ? v : pointIndexById.get(v);
          fp._ductEdges = fp.Edges.map(e => {
            const a = idxOf(e?.v1), b = idxOf(e?.v2);
            if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
            return [a, b, e?.length ?? e?.step ?? 1];
          }).filter(Boolean);
        }
        fp.layers.Duct_Plan = true;
      }
    };

    const runStage = async (phases, pollIntervalMs = 2000, config = null) => {
      if (phases.includes('zones')) clearAllEntryPointAssignments(fp);
      const planJson = fp.toJSON();
      const units = fp.units || { length: getUnitLabel() || 'm', pxPerUnit: getPixelsPerUnit() || 1 };
      if (phases.length > 0) _currentPhase = phases[0];
      const started = await startOptimisation(planJson, units, { phases, ...(config ? { config } : {}) });
      if (!started.ok) {
        if (aiError) { aiError.style.display = 'block'; aiError.textContent = `Optimisation failed: ${started.error}`; }
        return { ok: false, error: started.error };
      }
      _activeJobId = started.job_id;
      const result = await pollOptimisation(started.job_id, (phase, data) => {
        const inStageIdx = phases.indexOf(phase);
        if (inStageIdx >= 0 && inStageIdx < phases.length - 1) {
          _currentPhase = phases[inStageIdx + 1];
        } else {
          const globalIdx = _phaseOrder.indexOf(phase);
          _currentPhase = _phaseOrder[Math.min(globalIdx + 1, _phaseOrder.length - 1)] || phase;
        }
        applyData(data);
        store.notify();
      }, pollIntervalMs, _abortCtrl.signal);
      _activeJobId = null;
      if (!result.ok) {
        if (!result.cancelled && !_abortCtrl.signal.aborted && aiError) {
          aiError.style.display = 'block';
          aiError.textContent = `Optimisation failed: ${result.error}`;
        }
        return result;
      }
      applyData(result.data);
      store.notify();
      return result;
    };

    try {
      // Pre-flight validation
      const _issues = [];
      if (!fp.boundaryClosed || (fp.wall_graph?.nodes?.length ?? 0) < 3)
        _issues.push('No closed boundary — draw a wall outline first.');
      if (!fp.Points || fp.Points.length === 0)
        _issues.push('No routing grid — generate a grid (Grid → Generate) first.');
      if (_issues.length) {
        if (aiError) { aiError.style.display = 'block'; aiError.style.color = ''; aiError.textContent = _issues.join(' '); }
        return;
      }
      if (!fp.Points.some(p => p.entryPoint)) {
        if (aiError) {
          aiError.style.display = 'block';
          aiError.style.color = '#e6a817';
          aiError.textContent = 'No entry point selected — the server will auto-pick one. Select a grid point and tick Entry Point in the inspector to set it manually.';
        }
      } else if (aiError) {
        aiError.style.color = '';
      }

      const alive = await checkHealth();
      if (!alive) {
        if (aiError) { aiError.style.display = 'block'; aiError.style.color = ''; aiError.textContent = 'Optimisation server is not responding. Please restart the app.'; }
        return;
      }

      await stageLogic(fp, runStage, waitForContinue, aiError);

    } catch (err) {
      if (aiError && !_abortCtrl.signal.aborted) {
        aiError.style.display = 'block';
        aiError.textContent = `Optimisation error: ${err.message}`;
      }
    } finally {
      clearInterval(_timerInterval);
      _abortCtrl = null;
      _allOptBtns.forEach(b => { b.disabled = false; });
      triggerBtn.textContent = triggerBtn.dataset.defaultLabel;
      if (btnStop) btnStop.style.display = 'none';
      if (btnContinue) { btnContinue.style.display = 'none'; btnContinue.onclick = null; }
      if (statusEl) statusEl.style.display = 'none';
    }
  };

  // ── Stage logic functions ────────────────────────────────────────────────────

  const _stageStructural = async (fp, runStage, waitForContinue, aiError) => {
    const hasExisting = (Array.isArray(fp.Columns) && fp.Columns.length > 0) ||
                        (Array.isArray(fp.Beams)   && fp.Beams.length   > 0);
    if (hasExisting && !window.confirm('Existing structural elements were found. Re-run structural optimisation?')) return;
    const structCfg = _getStructuralConfig();
    fp._structCfgPending = structCfg.structural_planning;
    const result = await runStage(['structural'], 2000, structCfg);
    if (!result.ok) {
      fp._structCfgPending = null;
      _showStructuralFailureHint(result.error, structCfg, aiError);
      return;
    }
    if (aiError) { aiError.style.display = 'block'; aiError.style.color = '#e6a817'; aiError.textContent = 'Structural complete. Review columns/beams, then run Thermal Zones or Full Optimise.'; }
  };

  const _stageThermal = async (fp, runStage, waitForContinue, aiError) => {
    const hasExisting = Array.isArray(fp.Thermal_Zones) && fp.Thermal_Zones.length > 0;
    if (hasExisting && !window.confirm('Existing thermal zones found. Re-generate thermal regions + zones?')) return;
    const segResult = await runStage(['segmentation']);
    if (!segResult.ok) return;
    const zoneResult = await runStage(['zones']);
    if (!zoneResult.ok) return;
    if (aiError) { aiError.style.display = 'block'; aiError.style.color = '#e6a817'; aiError.textContent = 'Thermal zones ready. Edit air requirements in the Thermal Zones panel, then run Duct Routing.'; }
  };

  const _stageDuct = async (fp, runStage, waitForContinue, aiError) => {
    const zoneCount = Array.isArray(fp.Thermal_Zones) ? fp.Thermal_Zones.length : 0;
    const hasGeometry = (fp.Thermal_Zones || []).some(_hasThermalGeometry);
    if (!zoneCount || !hasGeometry) {
      if (aiError) { aiError.style.display = 'block'; aiError.style.color = ''; aiError.textContent = 'Duct routing requires thermal zones with region geometry. Run Thermal Zones first.'; }
      return;
    }
    const result = await runStage(['duct'], 700);
    if (!result.ok) return;
    if (aiError) { aiError.style.display = 'none'; aiError.style.color = ''; }
  };

  const _stageFull = async (fp, runStage, waitForContinue, aiError) => {
    const thermalZoneCount = () => (Array.isArray(fp.Thermal_Zones) ? fp.Thermal_Zones.length : 0);
    const hasThermalGeometry = () => (fp.Thermal_Zones || []).some(_hasThermalGeometry);

    const hasExistingStructural = (Array.isArray(fp.Columns) && fp.Columns.length > 0) ||
                                  (Array.isArray(fp.Beams)   && fp.Beams.length   > 0);
    let shouldRunStructural = true;
    if (hasExistingStructural) {
      shouldRunStructural = window.confirm('Existing structural elements were found. Click OK to re-run structural optimisation, or Cancel to keep them and continue to the next step.');
    }
    if (shouldRunStructural) {
      const structCfg = _getStructuralConfig();
      fp._structCfgPending = structCfg.structural_planning;
      const r = await runStage(['structural'], 2000, structCfg);
      if (!r.ok) { fp._structCfgPending = null; _showStructuralFailureHint(r.error, structCfg, aiError); return; }
      if (!await waitForContinue('continue', 'Structural optimisation complete. Review columns/beams, then click Continue.')) {
        if (aiError) { aiError.style.display = 'block'; aiError.style.color = '#e6a817'; aiError.textContent = 'Optimisation paused after structural stage.'; }
        return;
      }
    }

    let hasThermalZones = thermalZoneCount() > 0;
    let shouldRunThermal = !hasThermalZones;
    if (hasThermalZones) {
      shouldRunThermal = window.confirm('Existing thermal zones/regions were found. Click OK to re-generate, or Cancel to keep existing data and continue to duct routing.');
    }
    if (shouldRunThermal) {
      const segResult = await runStage(['segmentation']);
      if (!segResult.ok) return;
      if (!await waitForContinue('continue', 'Thermal regions segmented. Review/edit, then click Continue to partition into thermal zones.')) {
        if (aiError) { aiError.style.display = 'block'; aiError.style.color = '#e6a817'; aiError.textContent = 'Optimisation paused after region segmentation.'; }
        return;
      }
      const zoneResult = await runStage(['zones']);
      if (!zoneResult.ok) return;
      if (!await waitForContinue('continue', 'Thermal zones ready. Edit air requirements, then click Continue to run duct routing.')) {
        if (aiError) { aiError.style.display = 'block'; aiError.style.color = '#e6a817'; aiError.textContent = 'Optimisation paused after thermal stage.'; }
        return;
      }
    }

    hasThermalZones = thermalZoneCount() > 0;
    if (hasThermalZones && !hasThermalGeometry()) {
      if (aiError) { aiError.style.display = 'block'; aiError.textContent = 'Thermal zones exist but have no region geometry. Please regenerate thermal zones before duct routing.'; }
      return;
    }
    if (!hasThermalZones) {
      if (aiError) { aiError.style.display = 'block'; aiError.textContent = 'Duct routing skipped: thermal zones are still missing.'; }
      return;
    }
    const ductResult = await runStage(['duct'], 700);
    if (!ductResult.ok) return;
    if (aiError) { aiError.style.display = 'none'; aiError.style.color = ''; }
  };

  // ── Wire buttons ─────────────────────────────────────────────────────────────
  [
    [btnOptimise,          'Full Optimise', _stageFull],
    [btnOptimiseStructure, 'Structure',     _stageStructural],
    [btnOptimiseThermal,   'Thermal Zones', _stageThermal],
    [btnOptimiseDuct,      'Duct Routing',  _stageDuct],
  ].forEach(([btn, label, logic]) => {
    if (!btn) return;
    btn.dataset.defaultLabel = label;
    btn.textContent = label;
    btn.addEventListener('click', () => runFlow(btn, logic));
  });

  // Wire color picker apply button (inside bindUI so `store` is available)
  const applyBtn = document.getElementById('applyAreaColorBtn');
  const colorPicker = document.getElementById('areaColorPicker');
  if (applyBtn && colorPicker) {
    applyBtn.addEventListener('click', () => {
      if (!store.active) return;
      // Resolve selected area id across boundaryArea and thermal_zones
      const fallbackId = store.active.Thermal_Zones && store.active.Thermal_Zones.length ? store.active.Thermal_Zones[0].id : null;
      const sel = store.selectedAreaId || fallbackId;
      if (!sel) return;

      // try boundaryArea
      if (store.active.boundaryArea && store.active.boundaryArea.id === sel) {
        // boundary area has no editable color/alpha for now
        return;
      }

      // try thermal_zones
      let region = (store.active.Thermal_Zones || []).find(r => r.id === sel);
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

  const areas = store.active?.Exclusion_Areas || [];
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

// Colour palette matching renderers.js _ZONE_HUES for swatch display
const _TZ_HUES = [200, 145, 25, 280, 170, 50, 320, 90, 0, 245, 340, 120, 60, 190, 300];

function _tzColour(idx, isInternal) {
  if (isInternal) return '#888';
  const h = _TZ_HUES[idx % _TZ_HUES.length];
  return `hsl(${h},60%,42%)`;
}

function _subregionVertexCount(sub) {
  if (!Array.isArray(sub)) return 0;
  return sub.filter(v => v && typeof v.x === 'number' && typeof v.y === 'number').length;
}

function _polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    if (!p1 || !p2) continue;
    if (!Number.isFinite(p1.x) || !Number.isFinite(p1.y) || !Number.isFinite(p2.x) || !Number.isFinite(p2.y)) continue;
    twiceArea += (p1.x * p2.y) - (p2.x * p1.y);
  }
  return Math.abs(twiceArea) * 0.5;
}

function _thermalAreaInPlanUnits(store, polygon) {
  const mmArea = _polygonArea(polygon);
  const unit = store?.active?.units?.length || 'mm';
  const mmPerUnit = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[unit] ?? 1;
  return mmArea / (mmPerUnit * mmPerUnit);
}

function _subregionFormat(sub) {
  if (!Array.isArray(sub)) return 'invalid';
  return (sub.length && sub[0] && typeof sub[0].x === 'number') ? '{x,y}' : 'unknown';
}

function _validVavZonePolygons(region) {
  const vavZones = Array.isArray(region?.vav_control_zones) ? region.vav_control_zones : [];
  return vavZones
    .map((cz, i) => ({
      polygon: Array.isArray(cz?.polygon)
        ? cz.polygon.filter(pt => pt && typeof pt.x === 'number' && typeof pt.y === 'number')
        : [],
      load: Number.isFinite(cz?.load) ? cz.load : null,
      index: i, // original index into vav_control_zones — preserved through filtering
    }))
    .filter(cz => cz.polygon.length >= 3);
}

function _getDisplayedVavZones(region) {
  const vavPolys = _validVavZonePolygons(region);
  return {
    items: vavPolys.map(cz => cz.polygon),
    loads: vavPolys.map(cz => cz.load),
    indices: vavPolys.map(cz => cz.index), // original vav_control_zones indices
  };
}

function _hasThermalGeometry(region) {
  return Array.isArray(region?.thermal_region_geometry) && region.thermal_region_geometry.some(sub => Array.isArray(sub) && sub.length >= 3);
}

function _setThermalSelection(store, zoneIndex = null, vavZoneIndex = null) {
  if (!store?.active) return;
  const fp = store.active;
  if (!Number.isInteger(zoneIndex) || zoneIndex < 0 || zoneIndex >= (fp.Thermal_Zones || []).length) {
    fp.selectedThermalZoneIndex = null;
    fp.selectedVavZoneIndex = null;
    store.selectedAreaId = null;
    return;
  }
  fp.selectedThermalZoneIndex = zoneIndex;
  fp.selectedVavZoneIndex = Number.isInteger(vavZoneIndex) ? vavZoneIndex : null;
  const region = fp.Thermal_Zones[zoneIndex];
  store.selectedAreaId = region?.id ?? null;
}

function _getSelectedThermalRegion(store) {
  const zi = store?.active?.selectedThermalZoneIndex;
  if (!Number.isInteger(zi)) return null;
  const zones = store.active?.Thermal_Zones || [];
  return zones[zi] || null;
}

// Merge a backend "thermal_zones" payload into fp.Thermal_Zones, preserving
// UI-only metadata (color/alpha/air_requirement/vavAirRequirements) for any
// field the backend didn't send a fresh value for. Shared by the staged
// optimisation flow's applyData() and the single-shot sub-zone recalculation
// triggered from the Thermal Zones panel.
function _mergeThermalZonesFromBackend(fp, thermalZones) {
  if (!Array.isArray(thermalZones) || !thermalZones.length) return;
  const prevMeta = (fp.Thermal_Zones || []).map(z => ({
    color: z.color ?? null,
    alpha: z.alpha ?? null,
    air_requirement: Number.isFinite(z.air_requirement) ? z.air_requirement : null,
    vavAirRequirements: Array.isArray(z.vavAirRequirements) ? [...z.vavAirRequirements] : [],
  }));
  fp.Thermal_Zones = thermalZones.map(({ thermal_region_geometry, vav_control_zones, ...tz }, i) => ({
    ...tz,
    thermal_region_geometry: thermal_region_geometry || [],
    vav_control_zones: vav_control_zones || [],
    color: tz.color ?? prevMeta[i]?.color ?? null,
    alpha: tz.alpha ?? prevMeta[i]?.alpha ?? null,
    air_requirement: Number.isFinite(tz.air_requirement) ? tz.air_requirement : prevMeta[i]?.air_requirement,
    vavAirRequirements: Array.isArray(tz.vavAirRequirements)
      ? tz.vavAirRequirements
      : (prevMeta[i]?.vavAirRequirements || []),
  }));
}

// The backend "zones" phase recomputes region/vavZone indices for ALL zones
// with no per-zone scoping, so any existing entry-point → VAV-zone
// assignment (pt.thermalRegions / pt.thermalZoneIndices) is stale the moment
// this phase reruns. Call before every code path that triggers it.
function clearAllEntryPointAssignments(fp) {
  for (const p of (fp?.Points || [])) {
    if (p.thermalRegions && p.thermalRegions.length) p.thermalRegions = [];
    if (p.thermalZoneIndices && p.thermalZoneIndices.length) p.thermalZoneIndices = [];
  }
}

// Re-runs the backend "zones" phase so existing sub-zone (vav_control_zones)
// boundaries reflect an edited zone's air_requirement, then redraws the
// canvas. Recomputes every zone's sub-zones (the backend has no per-zone
// scoping today), not just the edited one.
let _thermalRecomputeInFlight = false;
async function _recomputeZoneSubdivisions(store) {
  if (_thermalRecomputeInFlight) return;
  const fp = store?.active;
  if (!fp) return;

  const applyBtn = document.getElementById('applyThermalAirBtn');
  const inputEl = document.getElementById('thermalAirReqInput');
  const labelEl = document.getElementById('thermalSelectionLabel');
  const prevLabel = labelEl ? labelEl.textContent : '';
  _thermalRecomputeInFlight = true;
  if (applyBtn) applyBtn.disabled = true;
  if (inputEl) inputEl.disabled = true;
  if (labelEl) labelEl.textContent = 'Recalculating sub-zones…';

  try {
    clearAllEntryPointAssignments(fp);
    const planJson = fp.toJSON();
    const units = fp.units || { length: getUnitLabel() || 'm', pxPerUnit: getPixelsPerUnit() || 1 };
    const started = await startOptimisation(planJson, units, { phases: ['zones'] });
    if (!started.ok) {
      alert(`Sub-zone recalculation failed: ${started.error}`);
      return;
    }
    const result = await pollOptimisation(started.job_id, (phase, data) => {
      _mergeThermalZonesFromBackend(fp, data?.thermal_zones);
      if (data?.thermal_zones) refreshThermalZonesList(store);
      store.notify();
    }, 2000);
    if (!result.ok) {
      if (!result.cancelled) alert(`Sub-zone recalculation failed: ${result.error}`);
      return;
    }
    _mergeThermalZonesFromBackend(fp, result.data?.thermal_zones);
    if (result.data?.thermal_zones) refreshThermalZonesList(store);
    store.update(fp);
  } finally {
    _thermalRecomputeInFlight = false;
    if (labelEl && labelEl.textContent === 'Recalculating sub-zones…') labelEl.textContent = prevLabel;
    refreshThermalEditor(store);
  }
}

function refreshThermalEditor(store) {
  const labelEl = document.getElementById('thermalSelectionLabel');
  const inputEl = document.getElementById('thermalAirReqInput');
  const applyBtn = document.getElementById('applyThermalAirBtn');
  if (!labelEl || !inputEl || !applyBtn) return;

  const region = _getSelectedThermalRegion(store);
  const subIdx = store?.active?.selectedVavZoneIndex;

  if (!region) {
    labelEl.textContent = 'Selected: none';
    inputEl.value = '';
    inputEl.disabled = true;
    applyBtn.disabled = true;
    const entryListEl = document.getElementById('thermalEntryList');
    if (entryListEl) entryListEl.innerHTML = '';
    const assignEntryBtn = document.getElementById('assignEntryPointBtn');
    if (assignEntryBtn) { assignEntryBtn.textContent = 'Assign Entry Point'; assignEntryBtn.disabled = true; }
    if (store._entryPickTarget) {
      store._entryPickTarget = null;
      document.getElementById('canvas').style.cursor = '';
    }
    return;
  }

  const zoneIdx = store.active.selectedThermalZoneIndex;
  const zoneLabel = `Zone ${zoneIdx + 1}`;
  const nSel = (store._selectedRegions || []).length;
  const multiTag = nSel > 1 ? ` (+${nSel - 1} more region${nSel - 1 !== 1 ? 's' : ''} selected)` : '';
  if (Number.isInteger(subIdx)) {
    labelEl.textContent = `${zoneLabel} / VAV Zone ${subIdx + 1}${multiTag}`;
  } else {
    labelEl.textContent = `${zoneLabel}${multiTag}`;
  }

  if (!Array.isArray(region.vavAirRequirements)) {
    region.vavAirRequirements = [];
  }

  const currentAir = Number.isInteger(subIdx)
    ? (Array.isArray(region.vav_control_zones) ? region.vav_control_zones[subIdx]?.load : null)
    : (Number.isFinite(region.air_requirement) ? region.air_requirement : null);

  inputEl.value = Number.isFinite(currentAir) ? String(currentAir) : '';
  inputEl.disabled = false;
  applyBtn.disabled = false;

  applyBtn.onclick = () => {
    const val = parseFloat(inputEl.value);
    if (!Number.isFinite(val) || val <= 0) {
      alert('Air flow requirement must be a positive number.');
      return;
    }
    if (Number.isInteger(subIdx)) {
      if (!Array.isArray(region.vav_control_zones)) region.vav_control_zones = [];
      const cz = region.vav_control_zones[subIdx];
      if (cz && typeof cz === 'object') {
        cz.load = val;
      }
    } else {
      region.air_requirement = val;
    }
    store.update(store.active);
    // If this zone's air rate changed and it already has sub-zones, those
    // sub-zone boundaries were computed for the old load — recalculate them.
    const hasSubZones = Array.isArray(region.vav_control_zones) && region.vav_control_zones.length > 0;
    if (!Number.isInteger(subIdx) && hasSubZones) {
      _recomputeZoneSubdivisions(store);
    }
  };

  // ── Entry points section ──────────────────────────────────────────────────
  const entryListEl = document.getElementById('thermalEntryList');
  const assignEntryBtn = document.getElementById('assignEntryPointBtn');
  const selectedRegions = store._selectedRegions || [];

  if (entryListEl) {
    const fp = store.active;
    // Show entry points that have any thermalRegion belonging to the currently-edited zone.
    const assigned = (fp?.Points || []).filter(p => {
      if (!p.entryPoint) return false;
      if (Array.isArray(p.thermalRegions) && p.thermalRegions.length > 0) {
        return p.thermalRegions.some(r => r.zoneIndex === zoneIdx);
      }
      return Array.isArray(p.thermalZoneIndices) && p.thermalZoneIndices.includes(zoneIdx);
    });
    if (store._entryPickTarget) {
      const n = store._entryPickTarget.regions?.length ?? 0;
      entryListEl.innerHTML = `<div style="color:#f9a825; font-size:var(--fs-xs);">Click a grid point to assign ${n} region${n !== 1 ? 's' : ''}…</div>`;
    } else if (assigned.length === 0) {
      entryListEl.innerHTML = '<div style="color:var(--text-muted); font-size:var(--fs-xs);">None assigned</div>';
    } else {
      entryListEl.innerHTML = assigned.map(p => {
        // List which regions of this zone are assigned to this entry point.
        const regs = (p.thermalRegions || []).filter(r => r.zoneIndex === zoneIdx);
        const regTag = regs.length > 0
          ? `<span style="color:var(--text-muted); margin-left:4px;">${regs.map(r => `v${(r.vavZoneIndex ?? r.subZoneIndex ?? 0) + 1}`).join(', ')}</span>`
          : '';
        return `<div style="display:flex; justify-content:space-between; align-items:center; font-size:var(--fs-xs); padding:2px 0; border-bottom:1px solid var(--border);">` +
          `<span style="color:var(--text); font-family:var(--font);">${p.id}${regTag}</span>` +
          `<button class="ep-remove-btn" data-pt-id="${p.id}" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:13px; line-height:1; padding:0 2px;">×</button>` +
          `</div>`;
      }).join('');
      entryListEl.querySelectorAll('.ep-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const pt = (fp?.Points || []).find(p => p.id === btn.dataset.ptId);
          if (pt) {
            pt.thermalRegions = (pt.thermalRegions || []).filter(r => r.zoneIndex !== zoneIdx);
            pt.thermalZoneIndices = [...new Set((pt.thermalRegions || []).map(r => r.zoneIndex))];
            store.update(fp);
          }
        });
      });
    }
  }
  if (assignEntryBtn) {
    const nSel = selectedRegions.length;
    if (nSel === 0) {
      assignEntryBtn.textContent = 'Select regions on canvas first';
      assignEntryBtn.disabled = !store._entryPickTarget;
    } else {
      assignEntryBtn.disabled = false;
      assignEntryBtn.textContent = store._entryPickTarget
        ? 'Cancel'
        : `Assign ${nSel} region${nSel !== 1 ? 's' : ''} to entry point`;
    }
    assignEntryBtn.onclick = () => {
      if (store._entryPickTarget) {
        store._entryPickTarget = null;
        document.getElementById('canvas').style.cursor = '';
      } else if (selectedRegions.length > 0) {
        store._entryPickTarget = { regions: [...selectedRegions] };
        document.getElementById('canvas').style.cursor = 'crosshair';
      }
      refreshThermalEditor(store);
    };
  }
}

function _mergeThermalZones(fp, zoneIndices) {
  if (!fp || !Array.isArray(fp.Thermal_Zones) || zoneIndices.length < 2) return;
  const sorted = [...zoneIndices].sort((a, b) => a - b);
  const targetIdx = sorted[0];
  const toRemove  = sorted.slice(1);
  const target = fp.Thermal_Zones[targetIdx];

  // Track VAV offset so entry point vavZoneIndex can be remapped
  const vavOffsets = new Map();
  for (const srcIdx of toRemove) {
    const src = fp.Thermal_Zones[srcIdx];
    vavOffsets.set(srcIdx, (target.vav_control_zones || []).length);
    target.thermal_region_geometry = [
      ...(target.thermal_region_geometry || []),
      ...(src.thermal_region_geometry   || []),
    ];
    target.vav_control_zones = [
      ...(target.vav_control_zones || []),
      ...(src.vav_control_zones   || []),
    ];
    if (!Number.isFinite(target.air_requirement) && Number.isFinite(src.air_requirement)) {
      target.air_requirement = src.air_requirement;
    }
    if (!target.orientation && src.orientation) target.orientation = src.orientation;
  }

  // Remove merged zones in descending order to preserve lower indices
  for (const idx of [...toRemove].reverse()) fp.Thermal_Zones.splice(idx, 1);

  // Build old→new zone index remap
  const originalLength = fp.Thermal_Zones.length + toRemove.length;
  const removedSet = new Set(toRemove);
  const remap = new Map();
  let shift = 0;
  for (let i = 0; i < originalLength; i++) {
    if (removedSet.has(i)) { remap.set(i, targetIdx); shift++; }
    else                   { remap.set(i, i - shift); }
  }

  // Update entry point assignments
  (fp.Points || []).forEach(pt => {
    if (Array.isArray(pt.thermalRegions)) {
      const seen = new Set();
      pt.thermalRegions = pt.thermalRegions.map(r => {
        const newZone = remap.get(r.zoneIndex) ?? r.zoneIndex;
        const newVav  = removedSet.has(r.zoneIndex) && vavOffsets.has(r.zoneIndex)
          ? r.vavZoneIndex + vavOffsets.get(r.zoneIndex) : r.vavZoneIndex;
        return { ...r, zoneIndex: newZone, vavZoneIndex: newVav };
      }).filter(r => { const k = `${r.zoneIndex}:${r.vavZoneIndex}`; if (seen.has(k)) return false; seen.add(k); return true; });
    }
    if (Array.isArray(pt.thermalZoneIndices)) {
      pt.thermalZoneIndices = [...new Set(pt.thermalZoneIndices.map(zi => remap.get(zi) ?? zi))];
    }
  });

  // Fix selected zone index
  if (Number.isInteger(fp.selectedThermalZoneIndex) && remap.has(fp.selectedThermalZoneIndex)) {
    fp.selectedThermalZoneIndex = remap.get(fp.selectedThermalZoneIndex);
  }
}

export function refreshThermalZonesList(store) {
  const listEl = document.getElementById('thermalZonesList');
  if (!listEl) return;
  // Keep fp._thermalSelectionRegions in sync so renderers always see the current selection.
  if (store.active) store.active._thermalSelectionRegions = store._selectedRegions ?? null;
  listEl.innerHTML = '';

  const regions = store.active?.Thermal_Zones || [];
  if (regions.length === 0) {
    listEl.innerHTML = '<li style="color:var(--text-muted); font-size:0.85em; padding:6px 0;">No zones yet — run Thermal Zones or Full Optimise to generate.</li>';
    const mergeBtn = document.getElementById('mergeZonesBtn');
    if (mergeBtn) mergeBtn.disabled = true;
    return;
  }

  // Enable merge button when 2+ distinct zones are selected via the per-zone toggle buttons.
  // _mergeSelection is separate from _selectedRegions (canvas/entry-point selection).
  const selectedZoneIndices = [...new Set((store._mergeSelection || []).map(r => r.zoneIndex))];
  const mergeBtn = document.getElementById('mergeZonesBtn');
  if (mergeBtn) {
    mergeBtn.disabled = selectedZoneIndices.length < 2;
    mergeBtn.title = selectedZoneIndices.length < 2
      ? 'Click ○ next to zones below to select for merge'
      : `Merge ${selectedZoneIndices.length} selected zones into one`;
    mergeBtn.onclick = () => {
      if (!store.active || selectedZoneIndices.length < 2) return;
      _mergeThermalZones(store.active, selectedZoneIndices);
      store._mergeSelection = [];
      store.update(store.active);
      refreshThermalZonesList(store);
    };
  }

  regions.forEach((region, ri) => {
    const isInternal = region.type === 'internal' || region.orientation === null || region.orientation === undefined;
    const colour = _tzColour(ri, isInternal);
    const selectedZone = store.active?.selectedThermalZoneIndex === ri;
    const displayedRegions = _getDisplayedVavZones(region);
    const subZones = displayedRegions.items;
    const unitLabel = store.active?.units?.length || 'mm';
    const zoneArea = subZones.reduce((sum, sub) => sum + _thermalAreaInPlanUnits(store, sub), 0);
    const zoneAreaText = Number.isFinite(zoneArea) ? `${zoneArea.toFixed(2)} ${unitLabel}²` : '—';

    // inMergeSet: zone is queued for merging via the ○ toggle button
    const inMergeSet = (store._mergeSelection || []).some(r => r.zoneIndex === ri);
    // inAssignSet: zone has canvas-selected regions (for entry point assignment)
    const inAssignSet = (store._selectedRegions || []).some(r => r.zoneIndex === ri);
    const li = document.createElement('li');
    li.style.cssText = `display:flex; align-items:flex-start; gap:6px; padding:4px 0; border-bottom:1px solid #2a2a2a; cursor:pointer; user-select:none; ${selectedZone ? 'background:#182018;' : inMergeSet ? 'background:#1a2030;' : ''}`;
    li.onclick = () => {
      _setThermalSelection(store, ri, null);
      store.update(store.active);
    };

    // Colour swatch
    const swatch = document.createElement('span');
    swatch.style.cssText = `display:inline-block; width:12px; height:12px; border-radius:2px; background:${colour}; flex-shrink:0; margin-top:2px;`;
    li.appendChild(swatch);
    // Merge-set toggle button — always present
    const mergeToggle = document.createElement('button');
    mergeToggle.textContent = inMergeSet ? '⊕' : '○';
    mergeToggle.title = inMergeSet ? 'Selected for merge — click to deselect' : 'Click to select this zone for merge';
    mergeToggle.style.cssText = `font-size:11px; color:${inMergeSet ? '#7cb8ff' : '#555'}; background:none; border:none; cursor:pointer; flex-shrink:0; padding:0 2px; line-height:1; margin-top:1px;`;
    mergeToggle.onclick = (ev) => {
      ev.stopPropagation();
      if (!store._mergeSelection) store._mergeSelection = [];
      const already = store._mergeSelection.some(r => r.zoneIndex === ri);
      if (already) {
        store._mergeSelection = store._mergeSelection.filter(r => r.zoneIndex !== ri);
      } else {
        store._mergeSelection = [...store._mergeSelection, { zoneIndex: ri }];
      }
      refreshThermalZonesList(store);
    };
    li.appendChild(mergeToggle);
    // Canvas-selection badge (entry point assignment)
    if (inAssignSet) {
      const badge = document.createElement('span');
      badge.textContent = '⊕';
      badge.title = 'Canvas-selected for entry point assignment';
      badge.style.cssText = 'font-size:10px; color:#f9a825; flex-shrink:0; margin-top:1px; line-height:1;';
      li.appendChild(badge);
    }

    // Info block
    const info = document.createElement('span');
    info.style.cssText = 'font-size:0.82em; line-height:1.5; color:#ccc;';

    const type = region.type || 'perimeter';
    const isIntZone = region.orientation === null || region.orientation === undefined;
    const typeLabel = isIntZone ? 'internal' : type;
    const vavCount = Array.isArray(region.vav_control_zones) ? region.vav_control_zones.length : 0;
    const airReqPerArea = Number.isFinite(region.air_requirement)
      ? region.air_requirement
      : (Number.isFinite(region.airRequirement) ? region.airRequirement : null);
    const summedVavLoad = Array.isArray(region.vav_control_zones)
      ? region.vav_control_zones.reduce((s, z) => s + (Number.isFinite(z?.load) ? z.load : 0), 0)
      : null;
    const totalLoad = (Number.isFinite(region.total_load) && region.total_load > 0)
      ? region.total_load
      : (vavCount > 0 ? summedVavLoad : null);
    // Show total airflow load if computed; otherwise show rate if set; otherwise pending
    const airDisplay = totalLoad !== null
      ? `${Math.round(totalLoad)} L/s`
      : (airReqPerArea !== null ? `${Math.round(airReqPerArea)} L/s·m²` : 'not set');

    info.innerHTML =
      `<strong>Zone ${ri + 1}</strong> <span style="color:var(--text-muted);">${typeLabel}</span><br>` +
      `VAV zones: ${vavCount} · ${zoneAreaText}<br>` +
      `Airflow: <span style="color:${airReqPerArea !== null || totalLoad !== null ? 'var(--text)' : 'var(--text-muted)'};">${airDisplay}</span>`;

    li.appendChild(info);

    if (subZones.length) {
      const subList = document.createElement('div');
      subList.style.cssText = 'display:flex; flex-direction:column; gap:2px; margin-left:4px;';
      subZones.forEach((sub, si) => {
        const subBtn = document.createElement('button');
        const vavIdx = displayedRegions.indices[si];
        const isSelectedSub = selectedZone && store.active?.selectedVavZoneIndex === vavIdx;
        const subArea = _thermalAreaInPlanUnits(store, sub);
        const subAreaText = Number.isFinite(subArea) ? `${subArea.toFixed(2)} ${unitLabel}²` : '—';
        const load = displayedRegions.loads[si];
        subBtn.textContent = `VAV zone ${vavIdx + 1} · ${subAreaText}${Number.isFinite(load) ? ` · ${Math.round(load)} L/s` : ''}`;
        subBtn.style.cssText = `font-size:10px; padding:2px 4px; text-align:left; background:${isSelectedSub ? '#223822' : '#1a1a1a'}; color:#bbb; border:1px solid #333; cursor:pointer;`;
        subBtn.onclick = (ev) => {
          ev.stopPropagation();
          _setThermalSelection(store, ri, vavIdx);
          store.update(store.active);
        };
        subList.appendChild(subBtn);
      });
      li.appendChild(subList);
    }

    // Delete button
    const del = document.createElement('button');
    del.textContent = '×';
    del.title = 'Remove zone';
    del.style.cssText = 'margin-left:auto; background:none; border:none; color:#888; cursor:pointer; font-size:14px; flex-shrink:0;';
    del.onclick = () => {
      _setThermalSelection(store, null, null);
      store.active.Thermal_Zones.splice(ri, 1);
      store.update(store.active);
      refreshThermalZonesList(store);
    };
    li.appendChild(del);
    listEl.appendChild(li);
  });

  refreshThermalEditor(store);
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

// Find closest vertex from existing thermal zone polygons
function findClosestAreaVertex(fp, point, maxDist = SNAP_TO_NODE_DIST) {
  if (!fp) return null;
  let best = null;
  let bestDist = maxDist;

  // thermal_zones sub-zone vertices ({x,y} objects)
  (fp.Thermal_Zones || []).forEach(region => {
    (region.thermal_region_geometry || []).forEach(sub => {
      (sub || []).forEach(v => {
        if (v && typeof v.x === 'number' && typeof v.y === 'number') {
          const dx = point.x - v.x;
          const dy = point.y - v.y;
          const d = Math.hypot(dx, dy);
          if (d < bestDist) {
            bestDist = d;
            best = { x: v.x, y: v.y, source: 'temperature' };
          }
        }
      });
    });
  });

  return best;
}

function pickThermalRegionAtPoint(fp, x, y) {
  if (!fp || !Array.isArray(fp.Thermal_Zones) || fp.Thermal_Zones.length === 0) return null;

  const mmPerUnit = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[fp.units?.length] ?? 1000;
  const pxPerUnit = fp.units?.pxPerUnit ?? 1;
  const toCanvas = mm => mm * pxPerUnit / mmPerUnit;

  for (let zi = 0; zi < fp.Thermal_Zones.length; zi++) {
    const region = fp.Thermal_Zones[zi];
    // Only hit-test vav_control_zones — users select VAV zones, not raw geometry polygons.
    const vavZones = _getDisplayedVavZones(region);
    for (let si = 0; si < vavZones.items.length; si++) {
      const sub = vavZones.items[si];
      if (!Array.isArray(sub) || sub.length < 3) continue;
      const poly = sub
        .map(pt => (pt && typeof pt.x === 'number' && typeof pt.y === 'number') ? [toCanvas(pt.x), toCanvas(pt.y)] : null)
        .filter(Boolean);
      if (poly.length < 3) continue;

      const inside = fp._isPointInPolygon ? fp._isPointInPolygon(x, y, poly) : false;
      const onEdge = fp._isPointOnPolygonEdge ? fp._isPointOnPolygonEdge(x, y, poly, 3) : false;
      if (inside || onEdge) {
        // Return the original vav_control_zones index (preserved through polygon filtering).
        return { zoneIndex: zi, vavZoneIndex: vavZones.indices[si] };
      }
    }
  }
  return null;
}

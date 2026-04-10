// renderer/drawing/renderers.js
import { closestPointOnSegment, findClosestProjection, edgeLength, edgeMidpoint, isPointNearEdge, closestEdgeProjection, polygonArea, findClosestNode, findClosestEdgeProjection, projectToVertex } from './geometry.js';
import { formatLen, formatArea } from '../../config.js'
import { drawTooltip } from '../ui/labels.js'
import { getNodeById } from '../models/floorPlanUtils.js';

const SNAP_DISTANCE = 10;

export function isNearFirstNode(fp, mouse) {
  if (!fp || fp.wall_graph.nodes.length === 0) return false;
  const first = fp.wall_graph.nodes[0];
  return Math.hypot(mouse.x - first.x, mouse.y - first.y) < SNAP_DISTANCE;
}

export function drawEdgeWithDimension(ctx, fp, edge) {
  // resolve nodes to coordinates
  const n1 = getNodeById(fp.wall_graph.nodes, edge.v1);
  const n2 = getNodeById(fp.wall_graph.nodes, edge.v2);
  if (!n1 || !n2) return;

  ctx.beginPath();
  ctx.moveTo(n1.x, n1.y);
  ctx.lineTo(n2.x, n2.y);
  ctx.stroke();

  const len = edgeLength(fp, edge);
  const mid = edgeMidpoint(fp, edge);
  ctx.save();
  ctx.fillStyle = "#444";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(formatLen(len), mid.x, mid.y);
  ctx.restore();
}

export function drawBoundaryArea(ctx, fp) {
  if (!fp.boundaryArea) return;
  
  const area = fp.boundaryArea;
  const ptsRaw = area.vertices || [];
  if (ptsRaw.length === 0) return;
  
  // Normalize vertices (may be node ids or coordinate pairs)
  const resolved = ptsRaw.map(v => {
    if (typeof v === 'string') {
      const n = getNodeById(fp.wall_graph.nodes, v);
      return n ? [n.x, n.y] : null;
    }
    if (Array.isArray(v) && v.length >= 2) return [v[0], v[1]];
    if (v && typeof v.x === 'number' && typeof v.y === 'number') return [v.x, v.y];
    return null;
  }).filter(Boolean);
  
  if (resolved.length === 0) return;
  
  ctx.save();
  ctx.beginPath();
  resolved.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  
  const palette = areaColour(area.label || 'boundary');
  let fill = palette.fill || 'rgba(120,120,120,0.15)';
  if (area.color) {
    const alpha = typeof area.alpha === 'number' ? area.alpha : 0.3;
    if (/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(area.color)) {
      fill = hexToRgba(area.color, alpha);
    } else {
      fill = area.color;
      ctx.globalAlpha = alpha;
    }
  }
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

export function drawAreas(ctx, fp) {
  // Build a unified list of area-like objects: Temperature_Regions and legacy areas
  const unified = [];

  // Temperature_Regions: convert Pt_* subregions to coordinate arrays
  (fp.Temperature_Regions || []).forEach(region => {
    // pick the first subregion for rendering
    const sub = (region.subregions && region.subregions[0]) || {};
    const coords = Object.keys(sub).sort((a,b)=>{
      const ai = parseInt(a.replace(/^Pt_/,''),10);
      const bi = parseInt(b.replace(/^Pt_/,''),10);
      return ai - bi;
    }).map(k => {
      const v = sub[k];
      if (!v) return null;
      return [v[0], v[1]];
    }).filter(Boolean);
    if (coords.length) unified.push({ label: region.name || 'temp', vertices: coords, color: region.color, alpha: region.alpha });
  });

  // legacy areas
  (fp.areas || []).forEach(area => unified.push({ label: area.label, vertices: area.vertices, color: area.color, alpha: area.alpha }));

  unified.forEach(area => {
    // normalize vertices (may be node ids or coordinate pairs)
    const ptsRaw = area.vertices || [];
    if (ptsRaw.length === 0) return;
    const resolved = ptsRaw.map(v => {
      if (typeof v === 'string') {
        const n = getNodeById(fp.wall_graph.nodes, v);
        return n ? [n.x, n.y] : null;
      }
      if (Array.isArray(v) && v.length >= 2) return [v[0], v[1]];
      if (v && typeof v.x === 'number' && typeof v.y === 'number') return [v.x, v.y];
      return null;
    }).filter(Boolean);
    const pts = resolved;
    if (pts.length === 0) return;

    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();

    const palette = areaColour(area.label || '');
    let fill = palette.fill || 'rgba(120,120,120,0.15)';
    if (area.color) {
      const alpha = typeof area.alpha === 'number' ? area.alpha : 0.3;
      if (/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(area.color)) {
        fill = hexToRgba(area.color, alpha);
      } else {
        fill = area.color;
        ctx.globalAlpha = alpha;
      }
    }
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.globalAlpha = 1;

    const cx = pts.reduce((s, v) => s + v[0], 0) / pts.length;
    const cy = pts.reduce((s, v) => s + v[1], 0) / pts.length;
    ctx.fillStyle = '#000';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(area.label, cx, cy - 8);

    try {
      const areaPx = polygonArea(pts);
      const areaText = formatArea(areaPx);
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#222';
      ctx.fillText(areaText, cx, cy + 10);
    } catch (err) {
      console.warn('Area formatting failed', err);
    }
  });
}

function hexToRgba(hex, alpha = 1) {
  // strip '#'
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h.split('').map(ch => ch + ch).join('');
  }
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function drawExclusionAreas(ctx, fp) {
  const areas = fp.Exclusion_Areas || [];
  if (!areas.length) return;
  ctx.save();
  areas.forEach((area, idx) => {
    const pts = area.vertices;
    if (!pts || pts.length < 3) return;
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(220, 50, 50, 0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 40, 40, 0.75)';
    ctx.setLineDash([7, 4]);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    // Label centroid
    const cx = pts.reduce((s, v) => s + v[0], 0) / pts.length;
    const cy = pts.reduce((s, v) => s + v[1], 0) / pts.length;
    ctx.fillStyle = 'rgba(180, 30, 30, 0.9)';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`⛔ Exclusion ${idx + 1}`, cx, cy);
  });
  ctx.restore();
}

export function drawAreaGhost(ctx, fp, points, mouse) {
  if (!points.length) return;
  ctx.save();
  ctx.strokeStyle = "#007acc";
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 2;

  // Draw the current temporary polygon (resolve node ids to coords)
  ctx.beginPath();
  points.forEach((v, i) => {
    let px = null, py = null;
    if (typeof v === 'string') {
      const n = getNodeById(fp.wall_graph.nodes, v);
      if (n) { px = n.x; py = n.y; }
    } else if (Array.isArray(v)) {
      px = v[0]; py = v[1];
    }
    if (px == null || py == null) return;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });

  // Compute preview point for the next vertex (snapping + constrain)
  let previewX = mouse?.x ?? null;
  let previewY = mouse?.y ?? null;
  let previewMode = 'free'; // 'node' | 'edge' | 'constrained' | 'free'

  // find last drawn vertex to support constrain
  const lastRaw = points[points.length - 1];
  let lastX = null, lastY = null;
  if (typeof lastRaw === 'string') {
    const n = getNodeById(fp.wall_graph.nodes, lastRaw);
    if (n) { lastX = n.x; lastY = n.y; }
  } else if (Array.isArray(lastRaw)) {
    lastX = lastRaw[0]; lastY = lastRaw[1];
  }

  if (mouse) {
    const nodeSnap = findClosestNode(fp, { x: mouse.x, y: mouse.y }, SNAP_DISTANCE);
    const edgeSnap = findClosestEdgeProjection(fp, { x: mouse.x, y: mouse.y }, 8);
    const constrain = mouse.constrain;

    if (nodeSnap && !constrain) {
      previewX = nodeSnap.x; previewY = nodeSnap.y; previewMode = 'node';
    } else if (nodeSnap && constrain && lastX != null) {
      const dx = nodeSnap.x - lastX;
      const dy = nodeSnap.y - lastY;
      const r = Math.hypot(dx, dy);
      if (r > 0) {
        const angle = Math.atan2(dy, dx);
        const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        previewX = lastX + r * Math.cos(snapAngle);
        previewY = lastY + r * Math.sin(snapAngle);
      }
      previewMode = 'constrained';
    } else if (edgeSnap && !constrain) {
      previewX = edgeSnap.x; previewY = edgeSnap.y; previewMode = 'edge';
    } else if (edgeSnap && constrain && lastX != null) {
      const dx = edgeSnap.x - lastX;
      const dy = edgeSnap.y - lastY;
      const r = Math.hypot(dx, dy);
      if (r > 0) {
        const angle = Math.atan2(dy, dx);
        const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        previewX = lastX + r * Math.cos(snapAngle);
        previewY = lastY + r * Math.sin(snapAngle);
      }
      previewMode = 'constrained';
    } else if (constrain && lastX != null) {
      const dx = mouse.x - lastX;
      const dy = mouse.y - lastY;
      const r = Math.hypot(dx, dy);
      if (r > 0) {
        const angle = Math.atan2(dy, dx);
        const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        previewX = lastX + r * Math.cos(snapAngle);
        previewY = lastY + r * Math.sin(snapAngle);
      }
      previewMode = 'constrained';
    } else {
      previewMode = 'free';
      previewX = mouse.x; previewY = mouse.y;
    }
  }

  // Draw line to preview point
  if (previewX != null && previewY != null) {
    ctx.lineTo(previewX, previewY);
  }
  ctx.stroke();

  // Draw small markers for temporary vertices (resolve node ids)
  points.forEach(v => {
    let px = null, py = null;
    if (typeof v === 'string') {
      const n = getNodeById(fp.wall_graph.nodes, v);
      if (n) { px = n.x; py = n.y; }
    } else if (Array.isArray(v)) {
      px = v[0]; py = v[1];
    }
    if (px == null || py == null) return;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#007acc";
    ctx.fill();
  });

  // Draw preview marker for the next vertex
  if (previewX != null && previewY != null) {
    let fill = '#999';
    if (previewMode === 'node') fill = '#2a9d8f';
    else if (previewMode === 'edge') fill = '#007acc';
    else if (previewMode === 'constrained') fill = '#e76f51';

    ctx.beginPath();
    ctx.arc(previewX, previewY, 5, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#fff';
    ctx.stroke();

    // Show length from last point to preview when possible
    if (lastX != null && lastY != null) {
      const dx = previewX - lastX;
      const dy = previewY - lastY;
      const d = Math.hypot(dx, dy);
      const midX = (previewX + lastX) / 2;
      const midY = (previewY + lastY) / 2;
      const text = formatLen(d);
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      // draw subtle background box
      const metrics = ctx.measureText(text);
      const padding = 6;
      const bw = metrics.width + padding;
      const bh = 16;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(midX - bw/2, midY - bh - 6, bw, bh);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#000';
      ctx.fillText(text, midX, midY - 2);
    }
  }

  // Show a small shift/constrain indicator near the mouse when user
  // holds Shift (mouse.constrain === true).
  if (mouse && mouse.constrain) {
    try {
      const ix = mouse.x + 12;
      const iy = mouse.y + 12;
      const w = 28;
      const h = 18;
      ctx.fillStyle = 'rgba(30,30,30,0.9)';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1;
      // rounded rect
      const r = 4;
      ctx.beginPath();
      ctx.moveTo(ix + r, iy);
      ctx.arcTo(ix + w, iy, ix + w, iy + h, r);
      ctx.arcTo(ix + w, iy + h, ix, iy + h, r);
      ctx.arcTo(ix, iy + h, ix, iy, r);
      ctx.arcTo(ix, iy, ix + w, iy, r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('\u21E7', ix + w / 2, iy + h / 2); // up-pointing double arrow as shift symbol
    } catch (err) {
      // swallow
    }
  }

  ctx.restore();
}

export function areaColour(label) {
  const map = {
    private: { fill: "rgba(200,0,0,0.2)", stroke: "#a22" },
    common: { fill: "rgba(0,150,0,0.2)", stroke: "#2a2" },
    circulation: { fill: "rgba(0,0,200,0.2)", stroke: "#22a" }
  };
  // Special casing for the canonical boundary area so it is visually
  // distinct and users understand it's the plan boundary (non-deletable).
  if (label === 'boundary') return { fill: 'rgba(46,204,113,0.06)', stroke: '#2ecc71', strokeWidth: 2, dashed: false };
  return map[label] || { fill: "rgba(120,120,120,0.2)", stroke: "#666" };
}

// ── Door symbol helper (not exported) ────────────────────────────────────
// Draws an architectural plan-view door symbol centred at parametric t on
// the line n1→n2.  widthPx is the full opening width in canvas pixels.
function _drawDoorSymbol(ctx, n1x, n1y, n2x, n2y, t, widthPx, opts = {}) {
  const { color = '#333', wallThick = 5, ghost = false } = opts;
  const dx = n2x - n1x, dy = n2y - n1y;
  const edgeLen = Math.hypot(dx, dy) || 1;
  const angle = Math.atan2(dy, dx);
  const cx = n1x + t * dx, cy = n1y + t * dy;
  const hw = widthPx / 2;     // half opening width along wall
  const halfWall = wallThick / 2 + 1; // clearance for white fill

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);

  if (ghost) {
    // Semi-transparent rectangle preview
    ctx.fillStyle = 'rgba(80,140,255,0.25)';
    ctx.fillRect(-hw, -halfWall, hw * 2, halfWall * 2);
    ctx.strokeStyle = 'rgba(80,140,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(-hw, -halfWall, hw * 2, halfWall * 2);
    ctx.setLineDash([]);
  } else {
    // White fill clears the wall behind the opening
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-hw - 0.5, -halfWall, (hw + 0.5) * 2, halfWall * 2);

    // Jamb ticks at each edge of the opening
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-hw, -halfWall); ctx.lineTo(-hw, halfWall + 4);
    ctx.moveTo( hw, -halfWall); ctx.lineTo( hw, halfWall + 4);
    ctx.stroke();

    // Door leaf (line along the inside wall face, hinge at left jamb)
    const hingeX = -hw, hingeY = halfWall + 4;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hingeX, hingeY);
    ctx.lineTo(hingeX + widthPx, hingeY);  // closed position
    ctx.stroke();

    // Swing arc (quarter circle from closed → perpendicular open)
    ctx.beginPath();
    ctx.arc(hingeX, hingeY, widthPx, 0, Math.PI / 2);
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

// ── Background grid ────────────────────────────────────────────────────────
// Returns the canvas-pixel size of one grid cell given pxPerUnit so that
// lines are visually ~40 px apart, rounded to a "nice" plan-unit interval.
function _niceGridIntervalPx(pxPerUnit) {
  const targetPx = 40;
  const raw = targetPx / pxPerUnit;
  if (!isFinite(raw) || raw <= 0) return targetPx;
  const mag  = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * mag * pxPerUnit;
}

/**
 * Draw a scale-aware background grid on the canvas.
 * Called as the very first draw operation so all geometry renders on top.
 * @param {object} gridSettings - optional overrides: spacingOverride (plan units), lineOpacity (0-1)
 */
export function drawBackgroundGrid(ctx, fp, gridSettings = {}) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;

  // White background
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, W, H);

  const pxPerUnit = fp?.units?.pxPerUnit || 1;

  // Use manual spacing override (plan units) if provided, otherwise auto-compute
  let intervalPx;
  const spacing = gridSettings.spacingOverride;
  if (spacing > 0) {
    intervalPx = spacing * pxPerUnit;
  } else {
    intervalPx = _niceGridIntervalPx(pxPerUnit);
  }
  if (intervalPx < 4) return; // too dense to be useful

  const opacity = gridSettings.lineOpacity ?? 0.5;
  ctx.save();
  ctx.strokeStyle = `rgba(160, 160, 160, ${Math.max(0, Math.min(1, opacity))})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= W + intervalPx; x += intervalPx) {
    const px = Math.round(x) + 0.5;
    ctx.moveTo(px, 0);
    ctx.lineTo(px, H);
  }
  for (let y = 0; y <= H + intervalPx; y += intervalPx) {
    const py = Math.round(y) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(W, py);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawWalls(ctx, fp, options = {}) {
  ctx.save();
  
  fp.wall_graph.edges.forEach((edge, i) => {
    const n1 = getNodeById(fp.wall_graph.nodes, edge.v1);
    const n2 = getNodeById(fp.wall_graph.nodes, edge.v2);
    if (!n1 || !n2) return;

    // Visual differentiation: selected segment and locked segments
    let isSelected = fp.selectedSegment === i || options.selectedSegment === i;
    const isLocked = !!edge.locked;

    // Look up matching Wall object for type/translucent-aware drawing
    const _EPS = 1;
    const wall = (fp.Walls || []).find(w =>
      Math.abs(w.start.x - n1.x) < _EPS && Math.abs(w.start.y - n1.y) < _EPS &&
      Math.abs(w.end.x   - n2.x) < _EPS && Math.abs(w.end.y   - n2.y) < _EPS);

    // Hoist wall-type flags so they're available both for rendering and opening drawing
    const wallType = wall?.wallType ?? edge.wallType ?? 'boundary';
    const isBoundaryWall = wallType === 'boundary' || (!wall && !edge.wallType);
    const isCoreWall     = wallType === 'core';
    const isTranslucent  = isBoundaryWall && !!wall?.translucent;

    // When the entire core is selected, highlight all core walls
    if (fp.selectedCore && isCoreWall) isSelected = true;

    ctx.beginPath();
    ctx.moveTo(n1.x, n1.y);
    ctx.lineTo(n2.x, n2.y);

    if (isSelected) {
      ctx.strokeStyle = "#ff8800"; // highlight color
      ctx.lineWidth = 4;
      ctx.stroke();
      // draw an inner stroke for the edge itself
      ctx.beginPath();
      ctx.moveTo(n1.x, n1.y);
      ctx.lineTo(n2.x, n2.y);
      ctx.strokeStyle = "#222";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      // Locked edges use red instead of black but keep the same line style
      const baseColor = isLocked ? '#c22' : '#000';

      if (isBoundaryWall && isTranslucent) {
        // Two parallel thin lines (translucent boundary wall)
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny =  dx / len;
        const offset = 2;
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(n1.x + nx * offset, n1.y + ny * offset);
        ctx.lineTo(n2.x + nx * offset, n2.y + ny * offset);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(n1.x - nx * offset, n1.y - ny * offset);
        ctx.lineTo(n2.x - nx * offset, n2.y - ny * offset);
        ctx.stroke();
      } else if (isCoreWall) {
        // Core walls: thick line in a distinct core colour
        ctx.strokeStyle = isLocked ? '#c22' : '#cc5500';
        ctx.lineWidth = 4;
        ctx.stroke();
      } else if (isBoundaryWall) {
        // Thick solid line (opaque boundary wall)
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 5;
        ctx.stroke();
      } else {
        ctx.strokeStyle = isLocked ? '#c22' : '#222';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    if (options.mode === "draw") {
        const len = edgeLength(fp, edge);
        const mid = edgeMidpoint(fp, edge);

        ctx.fillStyle = "#000";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(formatLen(len), mid.x, mid.y);
    }

    // Draw any door/window openings placed on this wall
    if (wall?.openings?.length && n1 && n2) {
      // o.width is stored in mm; convert to canvas pixels before drawing
      const _pxU  = fp.units?.pxPerUnit || 1;
      const _mmPU = fp.units?.length === 'm' ? 1000 : 1; // mm per plan-unit
      const doorColor = isLocked ? '#c22' : '#333';
      const wallThickPx = isBoundaryWall ? 5 : isCoreWall ? 4 : 2;
      wall.openings.forEach(o => {
        if (o.openingKind === 'door' || o.openingKind === 'entrance') {
          const openingWidthPx = (o.width / _mmPU) * _pxU;
          _drawDoorSymbol(ctx, n1.x, n1.y, n2.x, n2.y, o.t, openingWidthPx, {
            color: doorColor,
            wallThick: wallThickPx,
            ghost: false
          });
        } else if (o.openingKind === 'opening') {
          // Plain gap: white fill only, no symbol
          const openingWidthPx = (o.width / _mmPU) * _pxU;
          const dx = n2.x - n1.x, dy = n2.y - n1.y;
          const angle = Math.atan2(dy, dx);
          const cx = n1.x + o.t * dx, cy = n1.y + o.t * dy;
          const hw = openingWidthPx / 2;
          const halfWall = wallThickPx / 2 + 1;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(-hw - 0.5, -halfWall, (hw + 0.5) * 2, halfWall * 2);
          ctx.restore();
        }
      });
    }
  });
  
  ctx.restore();
}

/** Draws a door placement ghost on the selected wall while in 'door' mode. */
export function drawDoorGhost(ctx, fp, mouse) {
  if (fp.selectedSegment == null) return;
  const edge = fp.wall_graph.edges[fp.selectedSegment];
  if (!edge) return;
  const n1 = getNodeById(fp.wall_graph.nodes, edge.v1);
  const n2 = getNodeById(fp.wall_graph.nodes, edge.v2);
  if (!n1 || !n2) return;

  const dx = n2.x - n1.x, dy = n2.y - n1.y;
  const edgeLen = Math.hypot(dx, dy) || 1;
  const len2 = dx * dx + dy * dy || 1;

  // Project mouse onto edge
  let t = ((mouse.x - n1.x) * dx + (mouse.y - n1.y) * dy) / len2;

  // Compute ghost door width: 1200 mm converted to canvas pixels
  const pxPerUnit = fp.units?.pxPerUnit || 1;
  const mmPerUnit = fp.units?.length === 'm' ? 1000 : 1;
  const doorWidth = Math.min((1200 / mmPerUnit) * pxPerUnit, edgeLen * 0.8);
  const hw = doorWidth / 2;
  // Clamp t so door stays fully on the wall
  t = Math.max(hw / edgeLen, Math.min(1 - hw / edgeLen, t));

  _drawDoorSymbol(ctx, n1.x, n1.y, n2.x, n2.y, t, doorWidth, { ghost: true });
}

/**
 * Draw a ghost crosshair at the nearest wall node while in 'grid-origin' mode.
 * Snaps only to wall graph nodes (vertex endpoints).
 */
export function drawGridOriginGhost(ctx, fp, mouse) {
  if (!fp || !mouse) return;
  const nodes = fp.wall_graph?.nodes;
  if (!nodes?.length) return;

  // Find closest node within 20px
  let best = null;
  let bestDist = 20;
  nodes.forEach(n => {
    const d = Math.hypot(mouse.x - n.x, mouse.y - n.y);
    if (d < bestDist) { bestDist = d; best = n; }
  });

  const px = best ? best.x : mouse.x;
  const py = best ? best.y : mouse.y;
  const snapping = !!best;

  ctx.save();
  const color = snapping ? '#e67e22' : 'rgba(230,126,34,0.4)';
  ctx.strokeStyle = color;
  ctx.lineWidth = snapping ? 1.5 : 1;
  const r = 6;
  // Circle
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.stroke();
  // Cross
  ctx.beginPath();
  ctx.moveTo(px - r * 2, py); ctx.lineTo(px + r * 2, py);
  ctx.moveTo(px, py - r * 2); ctx.lineTo(px, py + r * 2);
  ctx.stroke();
  ctx.restore();
}

export function drawVertices(ctx, fp) {
  ctx.fillStyle = "rgba(180, 60, 60, 0.35)";
  fp.wall_graph.nodes.forEach(node => {
    ctx.beginPath();
    ctx.arc(node.x, node.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

// Draw the boundary polygon outline and vertices (if present).
export function drawBoundaryVertices(ctx, fp) {
  if (!fp || !fp.boundaryArea || !Array.isArray(fp.boundaryArea.vertices)) return;
  
  // Resolve all vertices to coordinate pairs first
  const resolvedVertices = [];
  fp.boundaryArea.vertices.forEach(v => {
    let x = null, y = null;
    if (typeof v === 'string') {
      const n = getNodeById(fp.wall_graph.nodes, v);
      if (n) { x = n.x; y = n.y; }
    } else if (Array.isArray(v) && v.length >= 2) {
      x = v[0]; y = v[1];
    }
    if (x != null && y != null) {
      resolvedVertices.push([x, y]);
    }
  });
  
  if (resolvedVertices.length === 0) return;

  // If a view transform was applied (fp._view), the canvas context will
  // already be scaled. Drawing fixed-size UI markers in that transformed
  // space results in extremely small on-screen radii (marker_radius * scale).
  // To keep markers a readable device-pixel size, compute screen-space
  // positions from the stored view and draw the markers using the identity
  // transform (so radius is in device pixels).
  const useView = fp._view && typeof fp._view.scale === 'number';
  const pxRadius = 6; // marker radius in device pixels

  if (useView) {
    // Draw in screen space: reset transform and compute screen coords
    ctx.save();
    // temporarily reset transform so we draw in device coordinates
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    const s = fp._view.scale;
    const ox = fp._view.offsetX || 0;
    const oy = fp._view.offsetY || 0;
    
    // Convert world coordinates to screen coordinates
    const screenVertices = resolvedVertices.map(([wx, wy]) => [
      wx * s + ox,
      wy * s + oy
    ]);
    
    // Draw polygon outline
    if (screenVertices.length > 2) {
      ctx.beginPath();
      screenVertices.forEach(([sx, sy], i) => {
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
      ctx.strokeStyle = '#2ecc71';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    
    // Draw vertex markers
    ctx.fillStyle = '#2ecc71';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    screenVertices.forEach(([sx, sy]) => {
      ctx.beginPath();
      ctx.arc(sx, sy, pxRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    
    ctx.restore();
    return;
  }

  // No view transform: draw in world coordinates as before.
  ctx.save();
  
  // Draw polygon outline
  if (resolvedVertices.length > 2) {
    ctx.beginPath();
    resolvedVertices.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = '#2ecc71';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  
  // Draw vertex markers
  ctx.fillStyle = '#2ecc71';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  resolvedVertices.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  
  ctx.restore();
}

// Draw the core boundary polygon outline and vertices (if present).
export function drawCoreVertices(ctx, fp) {
  if (!fp || !fp.coreArea || !Array.isArray(fp.coreArea.vertices)) return;
  
  // Resolve all vertices to coordinate pairs first
  const resolvedVertices = [];
  fp.coreArea.vertices.forEach(v => {
    let x = null, y = null;
    if (typeof v === 'string') {
      const n = getNodeById(fp.wall_graph.nodes, v);
      if (n) { x = n.x; y = n.y; }
    } else if (Array.isArray(v) && v.length >= 2) {
      x = v[0]; y = v[1];
    }
    if (x != null && y != null) {
      resolvedVertices.push([x, y]);
    }
  });
  
  if (resolvedVertices.length === 0) return;

  const useView = fp._view && typeof fp._view.scale === 'number';
  const pxRadius = 5; // slightly smaller radius for core vertices

  if (useView) {
    // Draw in screen space: reset transform and compute screen coords
    ctx.save();
    // temporarily reset transform so we draw in device coordinates
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    const s = fp._view.scale;
    const ox = fp._view.offsetX || 0;
    const oy = fp._view.offsetY || 0;
    
    // Convert world coordinates to screen coordinates
    const screenVertices = resolvedVertices.map(([wx, wy]) => [
      wx * s + ox,
      wy * s + oy
    ]);
    
    // Draw polygon outline (use a different color for core)
    if (screenVertices.length > 2) {
      ctx.beginPath();
      screenVertices.forEach(([sx, sy], i) => {
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
      ctx.strokeStyle = '#e74c3c'; // red color for core
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    
    // Draw vertex markers
    ctx.fillStyle = '#e74c3c';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    screenVertices.forEach(([sx, sy]) => {
      ctx.beginPath();
      ctx.arc(sx, sy, pxRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    
    ctx.restore();
    return;
  }

  // No view transform: draw in world coordinates as before.
  ctx.save();
  
  // Draw polygon outline
  if (resolvedVertices.length > 2) {
    ctx.beginPath();
    resolvedVertices.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = '#e74c3c'; // red color for core
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  
  // Draw vertex markers
  ctx.fillStyle = '#e74c3c';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  resolvedVertices.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  
  ctx.restore();
}

export function drawHoverDimensions(ctx, fp, options) {
  const pt = options.ghost;
  let hovered = null;
  fp.wall_graph.edges.forEach(edge => {
    if (isPointNearEdge(fp, pt, edge, 6)) hovered = edge;
  });

  if (hovered) {
    const len = edgeLength(fp, hovered);
    const mid = edgeMidpoint(fp, hovered);
    ctx.save();
    ctx.fillStyle = "#007acc";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(formatLen(len), mid.x, mid.y);
    ctx.restore();
  }
}

export function drawHoverTooltip(ctx, fp, options) {
  const { ghost } = options;
  const hit = closestEdgeProjection(fp, ghost);
  if (!hit) return;
  if (hit.dist > 8) return;
  const len = edgeLength(fp, hit.edge);
  drawTooltip(ctx, `${formatLen(len)}`, ghost.x, ghost.y, {
    font: "12px sans-serif",
    bg: "rgba(30,30,35,0.95)",
    fg: "#fff",
    offsetX: 14,
    offsetY: 12,
    radius: 6
  });
}

export function drawGhost(ctx, fp, mouse, { constrain = false } = {}) {
  if (!fp || fp.boundaryClosed || fp.wall_graph.nodes.length === 0) return;

  const last = fp.wall_graph.nodes.at(-1);
  const lastX = last.x;
  const lastY = last.y;

  let ghostX = mouse.x;
  let ghostY = mouse.y;

  let constrained = false;
  if (constrain) {
    const dx = ghostX - lastX;
    const dy = ghostY - lastY;
    const r = Math.hypot(dx, dy);
    if (r > 0) {
      const angle = Math.atan2(dy, dx);
      const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      ghostX = lastX + r * Math.cos(snapAngle);
      ghostY = lastY + r * Math.sin(snapAngle);
    }
    constrained = true;
  }

  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(ghostX, ghostY);

  if (constrained) {
    ctx.strokeStyle = "green";
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
  } else {
    ctx.strokeStyle = "blue";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  if (constrained) {
    ctx.fillStyle = "green";
    ctx.beginPath();
    ctx.arc(ghostX, ghostY, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw a small constraint indicator near the ghost point when Shift is held
  if (constrained && mouse) {
    try {
      const ix = ghostX + 10;
      const iy = ghostY + 10;
      const w = 26;
      const h = 16;
      ctx.fillStyle = 'rgba(30,30,30,0.95)';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1;
      const r = 3;
      ctx.beginPath();
      ctx.moveTo(ix + r, iy);
      ctx.arcTo(ix + w, iy, ix + w, iy + h, r);
      ctx.arcTo(ix + w, iy + h, ix, iy + h, r);
      ctx.arcTo(ix, iy + h, ix, iy, r);
      ctx.arcTo(ix, iy, ix + w, iy, r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('\u21E7', ix + w / 2, iy + h / 2);
    } catch (err) {}
  }

  if (isNearFirstNode(fp, mouse)) {
    const first = fp.wall_graph.nodes[0];
    ctx.fillStyle = "orange";
    ctx.beginPath();
    ctx.arc(first.x, first.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawEntranceProjection(ctx, fp, mouse) {
  if (!fp.boundaryClosed) return;
  const closest = findClosestBoundaryPoint(fp, mouse);
  if (!closest) return;

  ctx.fillStyle = "purple";
  ctx.beginPath();
  ctx.arc(closest.x, closest.y, 6, 0, Math.PI * 2);
  ctx.fill();

  const edge = closest.edge || closest.edgeId ? closest.edge : null;
  // attempt to resolve nodes from edge; geometry helpers expect fp + edge
  // if the edge has ids, use getNodeById
  let ax, ay, bx, by;
  if (edge && edge.v1 && edge.v2) {
    const n1 = getNodeById(fp.wall_graph.nodes, edge.v1);
    const n2 = getNodeById(fp.wall_graph.nodes, edge.v2);
    if (!n1 || !n2) return;
    ax = n1.x; ay = n1.y; bx = n2.x; by = n2.y;
  } else if (closest.edge && closest.edge.v1 && Array.isArray(closest.edge.v1)) {
    [ax, ay] = closest.edge.v1;
    [bx, by] = closest.edge.v2;
  } else {
    // fallback: try to read edgeId
    const e = fp.wall_graph.edges.find(e => e.id === closest.edgeId) || fp.wall_graph.edges[closest.index];
    if (!e) return;
    const n1 = getNodeById(fp.wall_graph.nodes, e.v1);
    const n2 = getNodeById(fp.wall_graph.nodes, e.v2);
    if (!n1 || !n2) return;
    ax = n1.x; ay = n1.y; bx = n2.x; by = n2.y;
  }

  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    const nx = -dy / len;
    const ny = dx / len;
    ctx.strokeStyle = "purple";
    ctx.beginPath();
    ctx.moveTo(closest.x, closest.y);
    ctx.lineTo(closest.x + nx * 15, closest.y + ny * 15);
    ctx.stroke();
  }
}

export function drawEntrances(ctx, fp) {
  ctx.strokeStyle = "purple";
  ctx.lineWidth = 3;
  fp.entrances.forEach(ent => {
    const { x, y } = ent.position;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.stroke();
  });
}

export function findClosestBoundaryPoint(fp, mouse) {
  let best = null;
  let bestDist = Infinity;

  fp.wall_graph.edges.forEach(seg => {
    const n1 = getNodeById(fp.wall_graph.nodes, seg.v1);
    const n2 = getNodeById(fp.wall_graph.nodes, seg.v2);
    if (!n1 || !n2) return;

    const x1 = n1.x, y1 = n1.y;
    const x2 = n2.x, y2 = n2.y;

    const vx = x2 - x1, vy = y2 - y1;
    const wx = mouse.x - x1, wy = mouse.y - y1;
    const c1 = vx * wx + vy * wy;
    const c2 = vx * vx + vy * vy;
    const t = c2 === 0 ? 0 : Math.max(0, Math.min(1, c1 / c2));
    const projX = x1 + t * vx;
    const projY = y1 + t * vy;
    const dist = Math.hypot(mouse.x - projX, mouse.y - projY);

    if (dist < bestDist) {
      bestDist = dist;
      best = { edge: seg, x: projX, y: projY };
    }
  });
  return best;
}

export function drawProjectionGuides(ctx, fp, mouse) {
  const proj = findClosestProjection(fp, mouse);
  if (!proj) return;

  ctx.strokeStyle = "rgba(0,0,255,0.3)";
  ctx.setLineDash([2, 2]);

  ctx.beginPath();
  ctx.moveTo(proj.x, 0);
  ctx.lineTo(proj.x, ctx.canvas.height);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, proj.y);
  ctx.lineTo(ctx.canvas.width, proj.y);
  ctx.stroke();

  ctx.setLineDash([]);

  ctx.fillStyle = "blue";
  ctx.beginPath();
  ctx.arc(proj.x, proj.y, 4, 0, Math.PI * 2);
  ctx.fill();
}

// ═══════════════════════════════════════════════════════════
// NEW REFERENCE SCHEMA RENDERING FUNCTIONS
// ═══════════════════════════════════════════════════════════

export function drawCoreAreas(ctx, fp) {
  if (!fp.Core_Boundary || fp.Core_Boundary.length === 0) return;
  
  ctx.save();
  ctx.fillStyle = "rgba(255, 107, 107, 0.15)"; // Light red fill for core areas
  
  fp.Core_Boundary.forEach(core => {
    const points = Object.values(core);
    if (points.length < 3) return;
    
    ctx.beginPath();
    const [startX, startY] = points[0];
    ctx.moveTo(startX, startY);
    
    for (let i = 1; i < points.length; i++) {
      const [x, y] = points[i];
      ctx.lineTo(x, y);
    }
    
    ctx.closePath();
    ctx.fill();
  });
  
  ctx.restore();
}

export function drawCoreBoundaries(ctx, fp) {
  if (!fp.Core_Boundary || fp.Core_Boundary.length === 0) return;
  
  ctx.save();
  ctx.strokeStyle = "#ff6b6b"; // Red color for core boundaries
  ctx.lineWidth = 2;
  
  fp.Core_Boundary.forEach(core => {
    const points = Object.values(core);
    if (points.length < 3) return;
    
    ctx.beginPath();
    const [startX, startY] = points[0];
    ctx.moveTo(startX, startY);
    
    for (let i = 1; i < points.length; i++) {
      const [x, y] = points[i];
      ctx.lineTo(x, y);
    }
    
    ctx.closePath();
    ctx.stroke();
  });
  
  ctx.restore();
}

export function drawCoreGhost(ctx, fp, tempCore, mouse, constrain = false) {
  if (!tempCore || tempCore.length === 0) return;

  ctx.save();
  ctx.strokeStyle = "#ff6b6b";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.fillStyle = "rgba(255, 107, 107, 0.05)";

  // Draw temp core boundary
  ctx.beginPath();
  const [startX, startY] = tempCore[0];
  ctx.moveTo(startX, startY);

  for (let i = 1; i < tempCore.length; i++) {
    const [x, y] = tempCore[i];
    ctx.lineTo(x, y);
  }

  // Check for alignment snap first (takes precedence when not using Shift constraint)
  let alignmentSnap = null;
  if (!constrain && mouse) {
    alignmentSnap = getAlignmentSnap(fp, tempCore, mouse, 15);
  }

  // compute the target point to draw to: if orthogonal locking is
  // active, compute a constrained cursor aligned to the previous point
  let targetX = mouse?.x ?? null;
  let targetY = mouse?.y ?? null;
  let constrainedPoint = null;
  
  if (constrain && mouse && tempCore.length) {
    const last = tempCore[tempCore.length - 1];
    if (last) {
      const lastX = last[0];
      const lastY = last[1];
      const dx = mouse.x - lastX;
      const dy = mouse.y - lastY;
      const r = Math.hypot(dx, dy);
      if (r > 0) {
        const angle = Math.atan2(dy, dx);
        const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        targetX = lastX + r * Math.cos(snapAngle);
        targetY = lastY + r * Math.sin(snapAngle);
      }
      constrainedPoint = [targetX, targetY];
    }
  } else if (alignmentSnap) {
    // Apply alignment snap when not using Shift constraint
    targetX = alignmentSnap.x;
    targetY = alignmentSnap.y;
  }

  // Draw line to target (mouse or constrained)
  if (targetX != null && targetY != null) {
    ctx.lineTo(targetX, targetY);
  }

  // If we have 3+ points, show the closing line
  if (tempCore.length >= 3 && mouse) {
    ctx.lineTo(startX, startY);
    ctx.fill();
  }

  ctx.stroke();

  // Visual feedback for orthogonal lock: draw guide and marker
  if (constrainedPoint) {
    const [cx, cy] = constrainedPoint;
    // Guide line between last point and constrained cursor
    const last = tempCore[tempCore.length - 1];
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,107,107,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(last[0], last[1]);
    ctx.lineTo(cx, cy);
    ctx.stroke();

    // Draw small locked marker (crosshair)
    ctx.fillStyle = 'rgba(255,107,107,0.95)';
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();

    // label the lock state near the cursor
    ctx.font = '12px sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillText('Locked', cx + 8, cy - 8);
  }

  ctx.restore();
}

// Helper function to calculate snapped coordinates based on alignment guides
export function getAlignmentSnap(fp, tempCore, mouse, snapThreshold = 15) {
  if (!tempCore || tempCore.length === 0 || !mouse) return null;

  // Collect all reference vertices: boundary nodes + existing core vertices
  const referenceVertices = [];
  
  // Add boundary vertices (wall_graph nodes)
  if (fp && fp.wall_graph && fp.wall_graph.nodes) {
    fp.wall_graph.nodes.forEach(node => {
      referenceVertices.push({ x: node.x, y: node.y, type: 'boundary' });
    });
  }
  
  // Add existing core vertices
  tempCore.forEach(vertex => {
    const [vx, vy] = vertex;
    referenceVertices.push({ x: vx, y: vy, type: 'core' });
  });

  // Find the closest alignment (horizontal or vertical) to any reference vertex
  let closestDist = Infinity;
  let snapX = null;
  let snapY = null;
  let alignedVertex = null;

  // Check alignment with all reference vertices
  referenceVertices.forEach(vertex => {
    const { x: vx, y: vy } = vertex;
    
    // Check horizontal alignment (same Y)
    const distY = Math.abs(mouse.y - vy);
    if (distY < snapThreshold && distY < closestDist) {
      closestDist = distY;
      snapY = vy;
      snapX = null;
      alignedVertex = vertex;
    }
    
    // Check vertical alignment (same X)
    const distX = Math.abs(mouse.x - vx);
    if (distX < snapThreshold && distX < closestDist) {
      closestDist = distX;
      snapX = vx;
      snapY = null;
      alignedVertex = vertex;
    }
  });

  if (snapX !== null || snapY !== null) {
    return {
      x: snapX !== null ? snapX : mouse.x,
      y: snapY !== null ? snapY : mouse.y,
      alignedVertex,
      isHorizontal: snapY !== null,
      isVertical: snapX !== null
    };
  }

  return null;
}

// Draw projection guides for core drawing mode (horizontal/vertical alignment lines)
export function drawCoreProjectionGuides(ctx, fp, tempCore, mouse) {
  if (!tempCore || tempCore.length === 0 || !mouse) return;
  
  ctx.save();
  ctx.strokeStyle = "rgba(255, 107, 107, 0.3)"; // Light red for guides
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  // Collect all reference vertices: boundary nodes + existing core vertices
  const referenceVertices = [];
  
  // Add boundary vertices (wall_graph nodes)
  if (fp && fp.wall_graph && fp.wall_graph.nodes) {
    fp.wall_graph.nodes.forEach(node => {
      referenceVertices.push({ x: node.x, y: node.y, type: 'boundary' });
    });
  }
  
  // Add existing core vertices
  tempCore.forEach(vertex => {
    const [vx, vy] = vertex;
    referenceVertices.push({ x: vx, y: vy, type: 'core' });
  });

  // Find the closest alignment (horizontal or vertical) to any reference vertex
  let closestDist = Infinity;
  let closestX = null;
  let closestY = null;
  let alignedVertex = null;
  const snapThreshold = 15; // pixels - how close mouse needs to be to show guide

  // Check alignment with all reference vertices
  referenceVertices.forEach(vertex => {
    const { x: vx, y: vy } = vertex;
    
    // Check horizontal alignment (same Y)
    const distY = Math.abs(mouse.y - vy);
    if (distY < snapThreshold && distY < closestDist) {
      closestDist = distY;
      closestY = vy;
      closestX = null; // Clear X when we find closer Y
      alignedVertex = vertex;
    }
    
    // Check vertical alignment (same X)
    const distX = Math.abs(mouse.x - vx);
    if (distX < snapThreshold && distX < closestDist) {
      closestDist = distX;
      closestX = vx;
      closestY = null; // Clear Y when we find closer X
      alignedVertex = vertex;
    }
  });

  // Draw the closest guide line
  if (closestX !== null && alignedVertex) {
    // Draw vertical guide
    ctx.beginPath();
    ctx.moveTo(closestX, 0);
    ctx.lineTo(closestX, ctx.canvas.height);
    ctx.stroke();
    
    // Highlight the aligned vertex with color based on type
    const color = alignedVertex.type === 'boundary' ? "rgba(46, 204, 113, 0.6)" : "rgba(255, 107, 107, 0.5)";
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(alignedVertex.x, alignedVertex.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  
  if (closestY !== null && alignedVertex) {
    // Draw horizontal guide
    ctx.beginPath();
    ctx.moveTo(0, closestY);
    ctx.lineTo(ctx.canvas.width, closestY);
    ctx.stroke();
    
    // Highlight the aligned vertex with color based on type
    const color = alignedVertex.type === 'boundary' ? "rgba(46, 204, 113, 0.6)" : "rgba(255, 107, 107, 0.5)";
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(alignedVertex.x, alignedVertex.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.setLineDash([]);
  ctx.restore();
}

export function drawColumns(ctx, fp) {
  if (!fp.Columns || fp.Columns.length === 0) return;
  
  ctx.save();
  ctx.strokeStyle = "#4a4a4a"; // Dark gray for columns
  ctx.lineWidth = 1;
  ctx.fillStyle = "rgba(74, 74, 74, 0.3)"; // Semi-transparent gray fill
  
  fp.Columns.forEach(column => {
    const points = Object.values(column);
    if (points.length < 3) return;
    
    ctx.beginPath();
    const [startX, startY] = points[0];
    ctx.moveTo(startX, startY);
    
    for (let i = 1; i < points.length; i++) {
      const [x, y] = points[i];
      ctx.lineTo(x, y);
    }
    
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });
  
  ctx.restore();
}

// Draw column polygons and vertices (if present).
export function drawColumnsVertices(ctx, fp) {
  if (!fp || !fp.columnsData || !Array.isArray(fp.columnsData)) return;
  
  const useView = fp._view && typeof fp._view.scale === 'number';
  const pxRadius = 3; // smaller radius for column vertices

  if (useView) {
    // Draw in screen space: reset transform and compute screen coords
    ctx.save();
    // temporarily reset transform so we draw in device coordinates
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    const s = fp._view.scale;
    const ox = fp._view.offsetX || 0;
    const oy = fp._view.offsetY || 0;
    
    fp.columnsData.forEach(column => {
      if (!Array.isArray(column.vertices)) return;
      
      // Convert world coordinates to screen coordinates
      const screenVertices = column.vertices.map(([wx, wy]) => [
        wx * s + ox,
        wy * s + oy
      ]);
      
      if (screenVertices.length === 0) return;
      
      // Draw filled polygon for column
      if (screenVertices.length > 2) {
        ctx.beginPath();
        screenVertices.forEach(([sx, sy], i) => {
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(128, 128, 128, 0.6)'; // gray fill for columns
        ctx.fill();
        ctx.strokeStyle = '#666666'; // darker gray outline
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      
      // Draw vertex markers
      ctx.fillStyle = '#666666';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      screenVertices.forEach(([sx, sy]) => {
        ctx.beginPath();
        ctx.arc(sx, sy, pxRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    });
    
    ctx.restore();
    return;
  }

  // No view transform: draw in world coordinates as before.
  ctx.save();
  
  fp.columnsData.forEach(column => {
    if (!Array.isArray(column.vertices)) return;
    
    // Draw filled polygon for column
    if (column.vertices.length > 2) {
      ctx.beginPath();
      column.vertices.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(128, 128, 128, 0.6)'; // gray fill for columns
      ctx.fill();
      ctx.strokeStyle = '#666666'; // darker gray outline
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    
    // Draw vertex markers
    ctx.fillStyle = '#666666';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    column.vertices.forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  });
  
  ctx.restore();
}

// Draw grid points
export function drawGridPoints(ctx, fp) {
  if (!fp.Points || fp.Points.length === 0) return;
  
  ctx.save();
  ctx.lineWidth = 1;
  
  fp.Points.forEach(point => {
    const isSelected = fp.selectedPoints?.has(point.id) ?? fp.selectedPoint === point.id;
    const isColumn   = point.column !== false; // default true

    if (isColumn) {
      // Filled muted blue dot — column vertex
      ctx.fillStyle   = isSelected ? '#f39c12' : '#6b8caa';
      ctx.strokeStyle = isSelected ? '#fff' : 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(point.x, point.y, isSelected ? 5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      // Hollow muted ring — non-column vertex
      ctx.strokeStyle = isSelected ? '#f39c12' : '#555f73';
      ctx.fillStyle   = 'transparent';
      ctx.beginPath();
      ctx.arc(point.x, point.y, isSelected ? 5 : 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
  
  ctx.restore();
}

// Draw grid edges (connections between points)
export function drawGridEdges(ctx, fp) {
  if (!fp.Edges || fp.Edges.length === 0) return;
  
  ctx.save();
  ctx.strokeStyle = 'rgba(52, 152, 219, 0.3)'; // Semi-transparent blue
  ctx.lineWidth = 1;
  
  fp.Edges.forEach(edge => {
    const p1 = fp.Points.find(p => p.id === edge.v1);
    const p2 = fp.Points.find(p => p.id === edge.v2);
    if (p1 && p2) {
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
  });
  
  ctx.restore();
}

/**
 * When a wall segment is selected in select mode, draw a preview vertex
 * at the point on that segment closest to the mouse.  A second click on
 * the segment will split it there (handled in the click handler).
 */
export function drawSplitPreview(ctx, fp, mouse) {
  if (fp.selectedSegment == null) return;
  const edge = fp.wall_graph.edges[fp.selectedSegment];
  if (!edge) return;
  const n1 = getNodeById(fp.wall_graph.nodes, edge.v1);
  const n2 = getNodeById(fp.wall_graph.nodes, edge.v2);
  if (!n1 || !n2) return;

  const [cx, cy] = closestPointOnSegment(n1.x, n1.y, n2.x, n2.y, mouse.x, mouse.y);

  // Only show when the mouse is actually near the segment
  if (Math.hypot(mouse.x - cx, mouse.y - cy) > 14) return;
  // Hide when the projected point would land too close to an endpoint
  if (Math.hypot(cx - n1.x, cy - n1.y) < 10 || Math.hypot(cx - n2.x, cy - n2.y) < 10) return;

  ctx.save();
  // Outer white ring
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fill();
  // Orange border matching selection colour
  ctx.strokeStyle = '#ff8800';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Small centre dot
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ff8800';
  ctx.fill();
  ctx.restore();
}

// export default object for convenience
export default {
  isNearFirstNode,
  drawEdgeWithDimension,
  drawBoundaryArea,
  drawAreas,
  drawExclusionAreas,
  drawAreaGhost,
  areaColour,
  drawWalls,
  drawVertices,
  drawBoundaryVertices,
  drawCoreVertices,
  drawColumnsVertices,
  drawHoverDimensions,
  drawHoverTooltip,
  drawGhost,
  drawEntranceProjection,
  drawEntrances,
  findClosestBoundaryPoint,
  drawProjectionGuides,
  drawCoreProjectionGuides,
  getAlignmentSnap,
  drawCoreAreas,
  drawCoreBoundaries,
  drawCoreGhost,
  drawColumns,
  drawGridPoints,
  drawGridEdges,
  drawDoorGhost,
  drawBackgroundGrid,
  drawGridOriginGhost,
  drawSplitPreview
};

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
  ctx.fillStyle = "#333";
  ctx.font = "11px monospace";
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

export function drawReferenceImage(ctx, fp) {
  const ref = fp?.referenceImage;
  if (!ref || ref.visible === false) return;

  const img = ref.image;
  if (!img || !img.width || !img.height) return;

  const pxPerUnit = fp.units?.pxPerUnit ?? 1;
  const x = (Number.isFinite(ref.x) ? ref.x : 0) * pxPerUnit;
  const y = (Number.isFinite(ref.y) ? ref.y : 0) * pxPerUnit;
  const widthUnits = Number.isFinite(ref.width) && ref.width > 0
    ? ref.width
    : Math.max(1, (img.width / pxPerUnit) * 0.75);
  const width = widthUnits * pxPerUnit;
  const height = Number.isFinite(ref.height) && ref.height > 0
    ? ref.height * pxPerUnit
    : width * (img.height / img.width);

  ctx.save();
  ctx.globalAlpha = Number.isFinite(ref.opacity) ? Math.max(0, Math.min(1, ref.opacity)) : 0.35;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, x, y, width, height);
  ctx.restore();
}

export function drawAreas(ctx, fp) {
  const unified = [];

  // thermal_zones: take first thermal_region_geometry polygon for compact area rendering.
  // Coordinates are always in mm (from backend) — convert to canvas pixels.
  const _mmPerUnit = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[fp.units?.length] ?? 1000;
  const _pxPerUnit = fp.units?.pxPerUnit ?? 1;
  const _toCanvas = mm => mm * _pxPerUnit / _mmPerUnit;

  (fp.Thermal_Zones || []).forEach(region => {
    const sub = (region.thermal_region_geometry && region.thermal_region_geometry[0]) || [];
    const coords = sub
      .map((v) => {
        if (!v || typeof v.x !== 'number' || typeof v.y !== 'number') return null;
        return [_toCanvas(v.x), _toCanvas(v.y)];
      })
      .filter(Boolean);
    if (coords.length) unified.push({ label: region.name || 'temp', vertices: coords, color: region.color, alpha: region.alpha });
  });

  unified.forEach(area => {
    // normalize vertices to coordinate pairs
    const ptsRaw = area.vertices || [];
    if (ptsRaw.length === 0) return;
    const resolved = ptsRaw.map(v => {
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
    ctx.fillStyle = '#1a1a1a';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(area.label, cx, cy - 8);

    try {
      const areaPx = polygonArea(pts);
      const areaText = formatArea(areaPx);
      ctx.font = '11px monospace';
      ctx.fillStyle = '#333';
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
    ctx.fillStyle = 'rgba(255, 68, 68, 0.1)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 68, 68, 0.7)';
    ctx.setLineDash([7, 4]);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    // Label centroid
    const cx = pts.reduce((s, v) => s + v[0], 0) / pts.length;
    const cy = pts.reduce((s, v) => s + v[1], 0) / pts.length;
    ctx.fillStyle = 'rgba(255, 68, 68, 0.9)';
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
  ctx.strokeStyle = "#00e676";
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
    ctx.fillStyle = "#00e676";
    ctx.fill();
  });

  // Draw preview marker for the next vertex
  if (previewX != null && previewY != null) {
    let fill = '#888';
    if (previewMode === 'node') fill = '#00e676';
    else if (previewMode === 'edge') fill = '#00a152';
    else if (previewMode === 'constrained') fill = '#ffaa00';

    ctx.beginPath();
    ctx.arc(previewX, previewY, 5, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Show length from last point to preview when possible
    if (lastX != null && lastY != null) {
      const dx = previewX - lastX;
      const dy = previewY - lastY;
      const d = Math.hypot(dx, dy);
      const midX = (previewX + lastX) / 2;
      const midY = (previewY + lastY) / 2;
      const text = formatLen(d);
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      // draw subtle background box
      const metrics = ctx.measureText(text);
      const padding = 6;
      const bw = metrics.width + padding;
      const bh = 16;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(midX - bw/2, midY - bh - 6, bw, bh);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1a1a1a';
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
      ctx.font = '12px monospace';
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
    private: { fill: "rgba(255,68,68,0.15)", stroke: "#ff4444" },
    common: { fill: "rgba(0,230,118,0.12)", stroke: "#00e676" },
    circulation: { fill: "rgba(0,180,230,0.15)", stroke: "#00b4e6" }
  };
  // Special casing for the canonical boundary area so it is visually
  // distinct and users understand it's the plan boundary (non-deletable).
  if (label === 'boundary') return { fill: 'rgba(0,230,118,0.06)', stroke: '#00e676', strokeWidth: 2, dashed: false };
  return map[label] || { fill: "rgba(120,120,120,0.15)", stroke: "#888" };
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
    ctx.fillStyle = 'rgba(0,230,118,0.15)';
    ctx.fillRect(-hw, -halfWall, hw * 2, halfWall * 2);
    ctx.strokeStyle = 'rgba(0,230,118,0.85)';
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
export function drawBackgroundGrid(ctx, fp, gridSettings = {}, viewport = null) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;

  // The white fill is painted by the caller before the transform is applied.
  // If no viewport is active (legacy call path), fill here as a fallback.
  if (!viewport) {
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, W, H);
  }

  const pxPerUnit = fp?.units?.pxPerUnit || 1;

  // Use manual spacing override (plan units) if provided, otherwise auto-compute
  let intervalPx;
  const spacing = gridSettings?.spacingOverride;
  if (spacing > 0) {
    intervalPx = spacing * pxPerUnit;
  } else {
    intervalPx = _niceGridIntervalPx(pxPerUnit);
  }

  // Check apparent pixel size to avoid an invisible or too-dense grid
  const apparentPx = viewport ? intervalPx * viewport.scale : intervalPx;
  if (apparentPx < 4) return;

  const opacity = gridSettings?.lineOpacity ?? 0.5;
  ctx.save();
  ctx.strokeStyle = `rgba(160, 160, 160, ${Math.max(0, Math.min(1, opacity))})`;

  // Keep lines visually 1 px wide regardless of zoom level
  ctx.lineWidth = viewport ? 1 / viewport.scale : 1;

  // Compute draw range in the current coordinate space.
  // When a viewport transform is active we're in content coords, so compute
  // the visible content region from the inverse transform.
  let xStart, xEnd, yStart, yEnd;
  if (viewport) {
    const s = viewport.scale, tx = viewport.tx, ty = viewport.ty;
    xStart = Math.floor((-tx / s) / intervalPx) * intervalPx;
    xEnd   = (W - tx) / s + intervalPx;
    yStart = Math.floor((-ty / s) / intervalPx) * intervalPx;
    yEnd   = (H - ty) / s + intervalPx;
  } else {
    xStart = 0; xEnd = W + intervalPx;
    yStart = 0; yEnd = H + intervalPx;
  }

  ctx.beginPath();
  for (let x = xStart; x <= xEnd; x += intervalPx) {
    const px = viewport ? x : Math.round(x) + 0.5;
    ctx.moveTo(px, yStart);
    ctx.lineTo(px, yEnd);
  }
  for (let y = yStart; y <= yEnd; y += intervalPx) {
    const py = viewport ? y : Math.round(y) + 0.5;
    ctx.moveTo(xStart, py);
    ctx.lineTo(xEnd, py);
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
    const isTranslucent  = isBoundaryWall && (wall ? !!wall.translucent : true);

    // When the entire core is selected, highlight all core walls
    if (fp.selectedCore && isCoreWall) isSelected = true;

    // Respect layer visibility: skip core walls if Core_Boundary layer is off,
    // skip boundary walls if Plan_Boundary layer is off.
    if (isCoreWall     && fp.layers?.Core_Boundary  === false) return;
    if (isBoundaryWall && fp.layers?.Plan_Boundary   === false) return;

    ctx.beginPath();
    ctx.moveTo(n1.x, n1.y);
    ctx.lineTo(n2.x, n2.y);

    if (isSelected) {
      ctx.strokeStyle = "#00e676"; // highlight color
      ctx.lineWidth = 4;
      ctx.stroke();
      // draw an inner stroke for the edge itself
      ctx.beginPath();
      ctx.moveTo(n1.x, n1.y);
      ctx.lineTo(n2.x, n2.y);
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      // Locked edges use red instead of black but keep the same line style
      const baseColor = isLocked ? '#ff4444' : '#1a1a1a';

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
        ctx.strokeStyle = isLocked ? '#ff4444' : '#ffaa00';
        ctx.lineWidth = 4;
        ctx.stroke();
      } else if (isBoundaryWall) {
        // Thick solid line (opaque boundary wall)
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 5;
        ctx.stroke();
      } else {
        ctx.strokeStyle = isLocked ? '#ff4444' : '#333';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    if (options.mode === "draw") {
        const len = edgeLength(fp, edge);
        const mid = edgeMidpoint(fp, edge);

        ctx.fillStyle = "#1a1a1a";
        ctx.font = "11px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(formatLen(len), mid.x, mid.y);
    }

    // Draw any door/window openings placed on this wall
    if (wall?.openings?.length && n1 && n2) {
      // o.width is stored in mm; convert to canvas pixels before drawing
      const _pxU  = fp.units?.pxPerUnit || 1;
      const _mmPU = fp.units?.length === 'm' ? 1000 : 1; // mm per plan-unit
      const doorColor = isLocked ? '#ff4444' : '#333';
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
  const color = snapping ? '#ffaa00' : 'rgba(255,170,0,0.4)';
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
  ctx.fillStyle = "rgba(255, 68, 68, 0.3)";
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
      ctx.strokeStyle = '#00e676';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    
    // Draw vertex markers
    ctx.fillStyle = '#00e676';
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
    ctx.strokeStyle = '#00e676';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  
  // Draw vertex markers
  ctx.fillStyle = '#00e676';
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
      ctx.strokeStyle = '#ff4444'; // danger red for core
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    
    // Draw vertex markers
    ctx.fillStyle = '#ff4444';
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
    ctx.strokeStyle = '#ff4444'; // danger red for core
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  
  // Draw vertex markers
  ctx.fillStyle = '#ff4444';
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
    ctx.fillStyle = "#00e676";
    ctx.font = "12px monospace";
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
    font: "12px monospace",
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

  // Draw two parallel thin lines (translucent boundary style)
  const _dx = ghostX - lastX;
  const _dy = ghostY - lastY;
  const _len = Math.hypot(_dx, _dy) || 1;
  const _nx = -_dy / _len;
  const _ny =  _dx / _len;
  const _off = 2;

  const _style = constrained ? '#00e676' : 'rgba(0, 230, 118, 0.6)';
  ctx.strokeStyle = _style;
  ctx.lineWidth = 1;
  if (!constrained) ctx.setLineDash([5, 3]);
  else ctx.setLineDash([]);

  ctx.beginPath();
  ctx.moveTo(lastX + _nx * _off, lastY + _ny * _off);
  ctx.lineTo(ghostX + _nx * _off, ghostY + _ny * _off);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(lastX - _nx * _off, lastY - _ny * _off);
  ctx.lineTo(ghostX - _nx * _off, ghostY - _ny * _off);
  ctx.stroke();

  ctx.setLineDash([]);

  if (constrained) {
    ctx.fillStyle = "#00e676";
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
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('\u21E7', ix + w / 2, iy + h / 2);
    } catch (err) {}
  }

  if (isNearFirstNode(fp, mouse)) {
    const first = fp.wall_graph.nodes[0];
    ctx.fillStyle = "#ffaa00";
    ctx.beginPath();
    ctx.arc(first.x, first.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawEntranceProjection(ctx, fp, mouse) {
  if (!fp.boundaryClosed) return;
  const closest = findClosestBoundaryPoint(fp, mouse);
  if (!closest) return;

  ctx.fillStyle = "#00a152";
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
    ctx.strokeStyle = "#00a152";
    ctx.beginPath();
    ctx.moveTo(closest.x, closest.y);
    ctx.lineTo(closest.x + nx * 15, closest.y + ny * 15);
    ctx.stroke();
  }
}

export function drawEntrances(ctx, fp) {
  ctx.strokeStyle = "#00a152";
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

  ctx.strokeStyle = "rgba(0,230,118,0.3)";
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

  ctx.fillStyle = "#00e676";
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
  ctx.fillStyle = "rgba(255, 68, 68, 0.12)"; // danger-tinted fill for core areas
  
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
  ctx.strokeStyle = "#ff4444"; // danger red for core boundaries
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
  ctx.strokeStyle = "#ff4444";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.fillStyle = "rgba(255, 68, 68, 0.05)";

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
    ctx.strokeStyle = 'rgba(255,68,68,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(last[0], last[1]);
    ctx.lineTo(cx, cy);
    ctx.stroke();

    // Draw small locked marker (crosshair)
    ctx.fillStyle = 'rgba(255,68,68,0.95)';
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();

    // label the lock state near the cursor
    ctx.font = '12px monospace';
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
  ctx.strokeStyle = "rgba(255, 68, 68, 0.3)"; // danger-tinted guides
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
    const color = alignedVertex.type === 'boundary' ? "rgba(0, 230, 118, 0.6)" : "rgba(255, 68, 68, 0.5)";
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
    const color = alignedVertex.type === 'boundary' ? "rgba(0, 230, 118, 0.6)" : "rgba(255, 68, 68, 0.5)";
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

  // Columns are square footprints; `width` (mm) is both edges. Fall back to
  // the old fixed marker size for columns saved before this field existed.
  // Drawn at 2x true scale — true-scale columns are too thin to read on
  // screen at typical plan zoom levels.
  const DISPLAY_SCALE = 2;
  const mmPerUnit = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[fp.units?.length] ?? 1000;
  const pxPerUnit = fp.units?.pxPerUnit ?? 1;
  const toPx = mm => mm * pxPerUnit / mmPerUnit;
  const fallbackHalf = Math.max(4, pxPerUnit * 0.25);

  ctx.save();
  ctx.fillStyle   = 'rgba(50, 50, 70, 0.85)';
  ctx.strokeStyle = '#222';
  ctx.lineWidth   = 1;

  fp.Columns.forEach(col => {
    const { x, y, width } = col;
    if (x === undefined || y === undefined) return;
    const half = Number.isFinite(width) && width > 0 ? Math.max(1, toPx(width) * DISPLAY_SCALE / 2) : fallbackHalf;
    ctx.beginPath();
    ctx.rect(x - half, y - half, half * 2, half * 2);
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
        ctx.fillStyle = 'rgba(100, 100, 100, 0.5)'; // gray fill for columns
        ctx.fill();
        ctx.strokeStyle = '#555'; // darker gray outline
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      
      // Draw vertex markers
      ctx.fillStyle = '#555';
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
      ctx.fillStyle = 'rgba(100, 100, 100, 0.5)'; // gray fill for columns
      ctx.fill();
      ctx.strokeStyle = '#555'; // darker gray outline
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    
    // Draw vertex markers
    ctx.fillStyle = '#555';
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
  
  fp.Points.forEach(point => {
    const isSelected  = fp.selectedPoints?.has(point.id) ?? fp.selectedPoint === point.id;
    const isColumn    = point.column !== false; // default true
    const isMechanical = point.mechanical !== false; // default true
    const isEntry     = point.entryPoint === true;

    if (isColumn) {
      // Filled muted blue dot — column vertex
      ctx.fillStyle   = isSelected ? '#ffaa00' : (isMechanical ? '#6b8caa' : '#c7ccd4');
      ctx.strokeStyle = isSelected ? '#fff' : (isMechanical ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.85)');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(point.x, point.y, isSelected ? 5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      // Hollow muted ring — non-column vertex
      ctx.strokeStyle = isSelected ? '#ffaa00' : (isMechanical ? '#555f73' : '#c3c9d1');
      ctx.fillStyle   = 'transparent';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(point.x, point.y, isSelected ? 5 : 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }

  });

  ctx.restore();
}

// Helper: compute centroid (in canvas px) of a polygon.
function _subZoneCentroid(subZone, toCanvas) {
  let sumX = 0, sumY = 0, count = 0;
  (subZone || []).forEach(pt => {
    if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
      sumX += toCanvas(pt.x); sumY += toCanvas(pt.y); count++;
    }
  });
  return count > 0 ? { cx: sumX / count, cy: sumY / count } : { cx: null, cy: null };
}

// Draw dashed lines from each entry point to the centroid of its assigned sub-region.
// Separate layer so it can be toggled independently of entry point markers.
export function drawEntryConnections(ctx, fp) {
  if (!fp.Points || fp.Points.length === 0) return;
  const zones = fp.Thermal_Zones || [];
  if (zones.length === 0) return;

  const mmPerUnit = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[fp.units?.length] ?? 1000;
  const pxPerUnit = fp.units?.pxPerUnit ?? 1;
  const toCanvas  = mm => mm * pxPerUnit / mmPerUnit;

  const zoneColors = zones.map((zone, zi) => {
    const isInternal = zone.type === 'internal' || zone.orientation === null || zone.orientation === undefined;
    return _zoneColour(zi, isInternal).stroke;
  });

  ctx.save();
  fp.Points.forEach(point => {
    if (point.entryPoint !== true) return;

    // Build the list of {zoneIndex, vavZoneIndex} pairs to draw lines to.
    // Use thermalRegions (new format) when present; fall back to legacy fields.
    let regionList = [];
    if (Array.isArray(point.thermalRegions) && point.thermalRegions.length > 0) {
      regionList = point.thermalRegions;
    } else {
      regionList = (point.thermalZoneIndices || [])
        .filter(zi => zi >= 0 && zi < zones.length)
        .map(zi => ({ zoneIndex: zi, vavZoneIndex: null }));
    }

    regionList.forEach(({ zoneIndex: zi, vavZoneIndex: vzi }) => {
      const zone = zones[zi];
      if (!zone) return;
      const vavZones = Array.isArray(zone.vav_control_zones) ? zone.vav_control_zones : [];

      let targetPoly = null;
      if (typeof vzi === 'number' && vzi >= 0 && vzi < vavZones.length) {
        const cz = vavZones[vzi];
        if (Array.isArray(cz?.polygon) && cz.polygon.length >= 3) targetPoly = cz.polygon;
      }

      let cx, cy;
      if (targetPoly) {
        ({ cx, cy } = _subZoneCentroid(targetPoly, toCanvas));
      } else {
        // Fallback: centroid of all vav_control_zones in the zone.
        const allPolygons = vavZones.map(cz => cz?.polygon).filter(p => Array.isArray(p));
        const fallbackPolygons = allPolygons.length
          ? allPolygons
          : (zone.thermal_region_geometry || []);
        let sumX = 0, sumY = 0, count = 0;
        fallbackPolygons.forEach(sub => {
          (sub || []).forEach(pt => {
            if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
              sumX += toCanvas(pt.x); sumY += toCanvas(pt.y); count++;
            }
          });
        });
        cx = count > 0 ? sumX / count : null;
        cy = count > 0 ? sumY / count : null;
      }
      if (cx == null) return;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(cx, cy);
      ctx.strokeStyle = zoneColors[zi];
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.restore();
    });
  });
  ctx.restore();
}

// Draw entry point markers — rings colored per assigned zone.
// Rendered as a separate layer so it's visible even when the Grid Points layer is hidden.
export function drawEntryPoints(ctx, fp) {
  if (!fp.Points || fp.Points.length === 0) return;
  const zones = fp.Thermal_Zones || [];

  // Pre-compute each zone's stroke color.
  const zoneColors = zones.map((zone, zi) => {
    const isInternal = zone.type === 'internal' || zone.orientation === null || zone.orientation === undefined;
    return _zoneColour(zi, isInternal).stroke;
  });

  ctx.save();

  fp.Points.forEach(point => {
    if (point.entryPoint !== true) return;
    const isSelected = fp.selectedPoints?.has(point.id) ?? fp.selectedPoint === point.id;
    const assigned = (Array.isArray(point.thermalZoneIndices) ? point.thermalZoneIndices : [])
      .filter(i => i >= 0 && i < zones.length);

    // ── Concentric rings — one per assigned zone (innermost first) ──────────
    if (assigned.length === 0) {
      // Unassigned: neutral green ring
      ctx.beginPath();
      ctx.arc(point.x, point.y, isSelected ? 9 : 7, 0, Math.PI * 2);
      ctx.strokeStyle = isSelected ? '#a5d6a7' : '#4caf50';
      ctx.lineWidth = isSelected ? 2 : 1.5;
      ctx.stroke();
    } else {
      assigned.forEach((zi, idx) => {
        const r = (isSelected ? 9 : 7) + idx * 4;
        ctx.beginPath();
        ctx.arc(point.x, point.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = zoneColors[zi];
        ctx.lineWidth = isSelected ? 2 : 1.5;
        ctx.stroke();
      });
    }

    // ── Zone labels beside the outermost ring ───────────────────────────────
    if (assigned.length > 0) {
      const outerR = (isSelected ? 9 : 7) + (assigned.length - 1) * 4 + 3;
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      assigned.forEach((zi, idx) => {
        ctx.fillStyle = zoneColors[zi];
        ctx.fillText(`Z${zi + 1}`, point.x + outerR, point.y + idx * 10 - (assigned.length - 1) * 5);
      });
    }
  });

  ctx.restore();
}

// Draw grid edges (connections between points)
export function drawGridEdges(ctx, fp) {
  if (!fp.Edges || fp.Edges.length === 0) return;
  
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 230, 118, 0.2)'; // accent-tinted grid edges
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

export function drawSelectionBox(ctx, start, end) {
  if (!start || !end) return;

  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);

  ctx.save();
  ctx.fillStyle = 'rgba(255, 170, 0, 0.14)';
  ctx.strokeStyle = 'rgba(255, 170, 0, 0.95)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
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
  // Accent border matching selection colour
  ctx.strokeStyle = '#00e676';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Small centre dot
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = '#00e676';
  ctx.fill();
  ctx.restore();
}

// ── Thermal zone renderer (BuildWeave segmentation + zone phases) ─────────────
// Draws fp.Thermal_Zones: [{type, orientation, subZones:[[{x,y},...],...],...}]
// Coordinates are in backend/world units, mapped to canvas by fp.units when needed.

// Distinct HSL hues spread across the spectrum, one per zone index.
// Internal zones get a grey tone regardless of index.
const _ZONE_HUES = [200, 145, 25, 280, 170, 50, 320, 90, 0, 245, 340, 120, 60, 190, 300];

function _zoneColour(zoneIndex, isInternal) {
  if (isInternal) {
    return { fill: 'rgba(120,120,120,0.15)', stroke: 'rgba(90,90,90,0.55)' };
  }
  const hue = _ZONE_HUES[zoneIndex % _ZONE_HUES.length];
  return {
    fill:   `hsla(${hue},65%,55%,0.22)`,
    stroke: `hsla(${hue},60%,38%,0.85)`,
  };
}

function _orientationName(azimuth) {
  if (azimuth === null || azimuth === undefined) return 'internal';
  // BuildWeave uses y-up (mathematical) coords; canvas y-axis is flipped (y-down),
  // so north (azimuth 0) maps to the visual bottom and south (180) to the visual top.
  // Swap north ↔ south so labels match the visual orientation on screen.
  const map = [[0, 'south'], [90, 'east'], [180, 'north'], [270, 'west']];
  let best = 'internal', minD = Infinity;
  for (const [deg, name] of map) {
    const d = Math.abs(((azimuth - deg + 540) % 360) - 180);
    if (d < minD) { minD = d; best = name; }
  }
  return best;
}

export function drawThermalZones(ctx, fp) {
  const regions = fp.Thermal_Zones;
  if (!regions || regions.length === 0) return;

  const mmPerUnit = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[fp.units?.length] ?? 1000;
  const pxPerUnit = fp.units?.pxPerUnit ?? 1;
  const toCanvas = mm => mm * pxPerUnit / mmPerUnit;
  // Debug toggle ("Thermal Regions" layer, off by default): force the full
  // region polygon to draw even once VAV control zones exist, so the raw
  // region geometry (e.g. a core-hole slit) can be inspected directly instead
  // of being hidden behind the decluttered VAV-zone rendering.
  const showFullRegions = fp.layers?.Thermal_Regions === true;

  ctx.save();

  regions.forEach((region, ri) => {
    const thermalGeom = region.thermal_region_geometry || [];
    const isInternal = region.type === 'internal' || region.orientation === null || region.orientation === undefined;
    const palette = _zoneColour(ri, isInternal);
    const label = _orientationName(region.orientation);
    const selRegions = fp._thermalSelectionRegions || [];
    const hasVavZones = Array.isArray(region.vav_control_zones) && region.vav_control_zones.length > 0;
    const isRegionSelected = selRegions.some(r => r.zoneIndex === ri);
    const validRings = [];

    (thermalGeom || []).forEach((subZone) => {
      const coords = (subZone || [])
        .map((pt) => {
          if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number') return null;
          return [pt.x, pt.y];
        })
        .filter(Boolean);
      if (!coords || coords.length < 3) return;
      validRings.push(coords);
    });

    if (!validRings.length) return;

    if (hasVavZones && !showFullRegions) {
      // drawThermalControlZones() is the real visual once VAV control zones
      // exist — the region itself only needs a thin outline when part of a
      // multi-region selection (e.g. batch entry-point assignment), no fill
      // or labels, so it doesn't double up with the control-zone rendering.
      // (Overridden by the "Thermal Regions" debug toggle above.)
      if (!isRegionSelected) return;
      validRings.forEach((coords) => {
        ctx.beginPath();
        coords.forEach((pt, i) => {
          const cx = toCanvas(pt[0]);
          const cy = toCanvas(pt[1]);
          if (i === 0) ctx.moveTo(cx, cy);
          else ctx.lineTo(cx, cy);
        });
        ctx.closePath();
        ctx.strokeStyle = '#7cb8ff';
        ctx.lineWidth = 2.0;
        ctx.stroke();
      });
      return;
    }

    // No VAV control zones yet (pre-partition review) — show the region
    // itself as the only available feedback.
    ctx.beginPath();
    validRings.forEach((coords) => {
      coords.forEach((pt, i) => {
        const cx = toCanvas(pt[0]);
        const cy = toCanvas(pt[1]);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.closePath();
    });

    ctx.fillStyle = palette.fill;
    ctx.fill();

    validRings.forEach((coords, subIdx) => {
      ctx.beginPath();
      coords.forEach((pt, i) => {
        const cx = toCanvas(pt[0]);
        const cy = toCanvas(pt[1]);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.closePath();

      ctx.strokeStyle = isRegionSelected ? '#7cb8ff' : palette.stroke;
      ctx.lineWidth = isRegionSelected ? 2.0 : 1.2;
      ctx.stroke();

      const rcx = coords.reduce((s, p) => s + toCanvas(p[0]), 0) / coords.length;
      const rcy = coords.reduce((s, p) => s + toCanvas(p[1]), 0) / coords.length;
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#1a1a1a';
      ctx.fillText(`Zone ${ri + 1}.${subIdx + 1}`, rcx, rcy + 11);
    });

    const first = validRings[0];
    const xs = first.map(p => toCanvas(p[0]));
    const ys = first.map(p => toCanvas(p[1]));
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = palette.stroke;
    ctx.fillText(`Zone ${ri + 1}`, cx, cy - 8);
    ctx.font = '10px monospace';
    ctx.fillText(label, cx, cy + 7);
  });

  ctx.restore();
}

// ── Thermal control zone renderer ───────────────────────────────────────────
// Draws the vav_control_zones sub-divisions that live inside each thermal zone.
// Each control zone is a list of grid-point indices (into fp.Points).
// Strategy: cell-expansion + rectilinear boundary tracing.
//   • Fill  – fillRect(x-h, y-h, step, step) per point; adjacent cells merge.
//   • Outline – for each cell, emit boundary segments on sides facing empty
//               neighbours; draw all segments in one path pass.

/** Infer the grid step in canvas pixels from fp._ductEdges or fp.Points. */
function _gridStepPx(fp) {
  if (fp._ductEdges && fp._ductEdges.length > 0) {
    const [a, b] = fp._ductEdges[0];
    const pa = fp.Points?.[a], pb = fp.Points?.[b];
    if (pa && pb) {
      const d = Math.max(Math.abs(pb.x - pa.x), Math.abs(pb.y - pa.y));
      if (d > 0) return d;
    }
  }
  // Fallback: minimum non-zero difference between sorted unique x-coords
  if (fp.Points && fp.Points.length > 1) {
    const xs = [...new Set(fp.Points.map(p => p.x))].sort((a, b) => a - b);
    const diffs = xs.slice(1).map((x, i) => x - xs[i]).filter(d => d > 1);
    if (diffs.length) return Math.min(...diffs);
  }
  return 1;
}

export function drawThermalControlZones(ctx, fp) {
  const regions = fp.Thermal_Zones;
  if (!regions || regions.length === 0) return;
  const mmPerUnit = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[fp.units?.length] ?? 1000;
  const pxPerUnit = fp.units?.pxPerUnit ?? 1;
  const toCanvas = mm => mm * pxPerUnit / mmPerUnit;

  ctx.save();

  regions.forEach((region, ri) => {
    const isInternal = region.type === 'internal' ||
                       region.orientation === null ||
                       region.orientation === undefined;
    const hue = isInternal ? 0 : _ZONE_HUES[ri % _ZONE_HUES.length];
    const sat = isInternal ? '0%' : '70%';

    const controlZones = region.vav_control_zones ?? [];
    if (!controlZones.length) return;
    const isSelectedZone = fp.selectedThermalZoneIndex === ri;
    const selectedVavZone = fp.selectedVavZoneIndex;
    const selRegions = fp._thermalSelectionRegions || [];

    controlZones.forEach((cz, ci) => {
      const subAir = Array.isArray(region.vavAirRequirements)
        ? region.vavAirRequirements[ci]
        : null;
      const polygon = cz.polygon;
      if (Array.isArray(polygon) && polygon.length >= 3) {
        const coords = polygon
          .map((pt) => {
            if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number') return null;
            return [toCanvas(pt.x), toCanvas(pt.y)];
          })
          .filter(Boolean);
        if (coords.length >= 3) {
          const lightness = 55 + (ci % 3) * 8;
          const fillAlpha = 0.20;
          const strokeAlpha = 0.90;
          ctx.beginPath();
          coords.forEach(([x, y], i) => {
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
          ctx.fillStyle = isInternal
            ? `rgba(140,140,140,${fillAlpha})`
            : `hsla(${hue},${sat},${lightness}%,${fillAlpha})`;
          ctx.fill();
          const isSelectedControl = isSelectedZone
            && Number.isInteger(selectedVavZone) && selectedVavZone === ci;
          const isRegionSelected = selRegions.some(r => r.zoneIndex === ri && r.vavZoneIndex === ci);
          ctx.strokeStyle = isSelectedControl
            ? '#ffe082'
            : isRegionSelected
              ? '#7cb8ff'
              : (isInternal
                ? `rgba(90,90,90,${strokeAlpha})`
                : `hsla(${hue},${sat},${Math.max(30, lightness - 20)}%,${strokeAlpha})`);
          ctx.lineWidth = isSelectedControl ? 2.4 : isRegionSelected ? 2.0 : 1.2;
          ctx.setLineDash([4, 2]);
          ctx.stroke();
          ctx.setLineDash([]);

          const cx = coords.reduce((s, p) => s + p[0], 0) / coords.length;
          const cy = coords.reduce((s, p) => s + p[1], 0) / coords.length;
          const loadStr = cz.load != null ? `${Math.round(cz.load)} l/s` : `cz${ci}`;
          ctx.font = '10px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = isInternal
            ? `rgba(90,90,90,0.9)`
            : `hsla(${hue},${sat},${Math.max(25, lightness - 25)}%,0.9)`;
          ctx.fillText(`Zone ${ri + 1}.${ci + 1}`, cx, cy - 6);
          ctx.font = '9px monospace';
          ctx.fillText(loadStr, cx, cy + 7);
          if (Number.isFinite(subAir)) {
            ctx.font = '8px monospace';
            ctx.fillText(`${Math.round(subAir)} L/s·m²`, cx, cy + 18);
          }
          return;
        }
      }

      const ptIndices = cz.points;
      if (!ptIndices || ptIndices.length === 0) return;
      if (!fp.Points || fp.Points.length === 0) return;

      const step = _gridStepPx(fp);
      if (step <= 0) return;
      const h = step / 4; // quarter-step margin — cells share edges visually

      // Build set of occupied cell keys (using rounded grid index as key)
      // key = "gx,gy" where gx = round(x / step), gy = round(y / step)
      const occupied = new Set();
      const gridCoords = [];
      for (const idx of ptIndices) {
        const pt = getNodeById(fp.Points, idx);
        if (!pt) continue;
        const gx = Math.round(pt.x / step);
        const gy = Math.round(pt.y / step);
        occupied.add(`${gx},${gy}`);
        gridCoords.push({ gx, gy, x: pt.x, y: pt.y });
      }
      if (!gridCoords.length) return;

      // Lightness cycles slightly per control zone within the same thermal zone
      const lightness = 55 + (ci % 3) * 8;
      const fillAlpha  = 0.20;
      const strokeAlpha = 0.90;

      // ── Fill: one rect per cell ───────────────────────────────────────────
      ctx.fillStyle = isInternal
        ? `rgba(140,140,140,${fillAlpha})`
        : `hsla(${hue},${sat},${lightness}%,${fillAlpha})`;
      ctx.beginPath();
      for (const { x, y } of gridCoords) {
        ctx.rect(x - h, y - h, step, step);
      }
      ctx.fill();

      // ── Outline: boundary segments of rectilinear cell union ──────────────
      ctx.strokeStyle = isInternal
        ? `rgba(90,90,90,${strokeAlpha})`
        : `hsla(${hue},${sat},${Math.max(30, lightness - 20)}%,${strokeAlpha})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 2]);

      ctx.beginPath();
      for (const { gx, gy, x, y } of gridCoords) {
        // top edge    (gy-1 empty)
        if (!occupied.has(`${gx},${gy - 1}`)) {
          ctx.moveTo(x - h, y - h);
          ctx.lineTo(x + h, y - h);
        }
        // bottom edge (gy+1 empty)
        if (!occupied.has(`${gx},${gy + 1}`)) {
          ctx.moveTo(x + h, y + h);
          ctx.lineTo(x - h, y + h);
        }
        // left edge   (gx-1 empty)
        if (!occupied.has(`${gx - 1},${gy}`)) {
          ctx.moveTo(x - h, y + h);
          ctx.lineTo(x - h, y - h);
        }
        // right edge  (gx+1 empty)
        if (!occupied.has(`${gx + 1},${gy}`)) {
          ctx.moveTo(x + h, y - h);
          ctx.lineTo(x + h, y + h);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // ── Load label at centroid ────────────────────────────────────────────
      const cx = gridCoords.reduce((s, p) => s + p.x, 0) / gridCoords.length;
      const cy = gridCoords.reduce((s, p) => s + p.y, 0) / gridCoords.length;
      const loadStr = cz.load != null ? `${Math.round(cz.load)} L/s·m²` : `cz${ci}`;
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isInternal
        ? `rgba(90,90,90,0.9)`
        : `hsla(${hue},${sat},${Math.max(25, lightness - 25)}%,0.9)`;
      ctx.fillText(`Zone ${ri + 1}.${ci + 1}`, cx, cy - 6);
      ctx.font = '9px monospace';
      ctx.fillText(loadStr, cx, cy + 7);
      if (Number.isFinite(subAir)) {
        ctx.font = '8px monospace';
        ctx.fillText(`${Math.round(subAir)} L/s·m²`, cx, cy + 18);
      }
    });
  });

  ctx.restore();
}

// ── Structural solver renderers ───────────────────────────────────────────────

/**
 * Draw solver-placed beams as lines reading fp.Beams: [{start:{x,y}, end:{x,y}}]
 * Coordinates are in canvas pixels.
 */
export function drawBeams(ctx, fp) {
  if (!fp.Beams || fp.Beams.length === 0) return;

  // Stroking a straight line at the beam's real plan-view width (mm) draws
  // an accurately-scaled band regardless of orientation. Falls back to the
  // old fixed stroke for beams saved before `width` existed.
  const mmPerUnit = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[fp.units?.length] ?? 1000;
  const pxPerUnit = fp.units?.pxPerUnit ?? 1;
  const toPx = mm => mm * pxPerUnit / mmPerUnit;
  const fallbackWidth = Math.max(1, pxPerUnit * 0.06);

  ctx.save();
  ctx.strokeStyle = 'rgba(50, 50, 70, 0.55)';
  ctx.lineCap     = 'round';

  fp.Beams.forEach(beam => {
    const { start, end, width } = beam;
    if (!start || !end) return;
    ctx.lineWidth = Number.isFinite(width) && width > 0 ? Math.max(1, toPx(width)) : fallbackWidth;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  });

  ctx.restore();
}

// ── Duct plan renderer (BuildWeave duct phase) ────────────────────────────────
// Draws fp.Duct_Plan: [{entryPoint, ducts:[[edgeIdx,ductSizeIdx,flow],...], vav:[[ptIdx,load],...]}]
// Requires fp._ductEdges: [[ptA, ptB, step], ...] (indices into fp.Points)
// fp.Points contains canvas-pixel coordinates.

export function drawDuctPlan(ctx, fp) {
  const plan = fp.Duct_Plan;
  if (!plan || plan.length === 0) return;
  if (!fp.Points || fp.Points.length === 0) return;

  // Create a map of point IDs to point objects for O(1) lookup
  const pointMap = new Map();
  fp.Points.forEach(p => {
    if (p.id) pointMap.set(p.id, p);
  });

  // Duct width/height are stored in metres; convert to content px for
  // to-scale drawing.
  const mmPerUnit = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[fp.units?.length] ?? 1000;
  const pxPerUnit = fp.units?.pxPerUnit ?? 1;
  const toPx = mm => mm * pxPerUnit / mmPerUnit;

  ctx.save();

  // Colour palette per riser/plant index
  const RISER_COLOURS = [
    '#00bcd4', '#ff9800', '#8bc34a', '#e91e63', '#9c27b0',
    '#03a9f4', '#ff5722', '#4caf50', '#f44336', '#3f51b5',
  ];

  plan.forEach((riser, ri) => {
    // Colour derived from the thermal zone this riser serves
    // Note: A riser (riser.vav[0]) corresponds to a control zone.
    // We search the Thermal_Zones to find the region and control zone that matches.
    let colour = '#888'; // Default grey
    if (riser.vav && riser.vav.length > 0) {
      const firstVavId = typeof riser.vav[0][0] === 'string' ? riser.vav[0][0] : fp.Points[riser.vav[0][0]]?.id;
      if (firstVavId) {
        // Find which thermal zone contains this point
        const region = (fp.Thermal_Zones || []).find(r => 
          (r.vav_control_zones || []).some(cz => cz.points.includes(firstVavId))
        );
        if (region) {
          // Use explicit color if present, else fallback to zoneColor logic
          if (region.color && /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(region.color)) {
            colour = region.color;
          } else {
            const ri = fp.Thermal_Zones.indexOf(region);
            const isInternal = region.type === 'internal' || region.orientation === null;
            const zoneColor = _zoneColour(ri, isInternal);
            colour = zoneColor.stroke;
          }
        }
      }
    }

    // Draw duct edges
    (riser.ducts || []).forEach((duct) => {
      let pA, pB, width, height, flow;
      if (duct.length === 5) {
        const [ptA_id, ptB_id, w, h, f] = duct;
        pA = pointMap.get(ptA_id);
        pB = pointMap.get(ptB_id);
        width = w;
        height = h;
        flow = f;
      }

      if (!pA || !pB) return;

      const isSelected = fp.selectedDuct &&
                         fp.selectedDuct.pA === duct[0] &&
                         fp.selectedDuct.pB === duct[1] &&
                         fp.selectedDuct.flow === duct[4];

      // Pinch-point detection: velocity = flow (l/s → m³/s) / cross-section (m²)
      const pinchThreshold = fp._pinchVelocityThreshold ?? 8; // m/s
      const showPinch = fp._showPinchPoints !== false;
      const crossSection = (width || 0.3) * (height || 0.3); // m²
      const velocity = crossSection > 0 ? (flow * 0.001) / crossSection : 0; // m/s
      const isPinch = showPinch && velocity > pinchThreshold;

      let drawColour;
      if (isSelected) {
        drawColour = '#00e676';
      } else if (isPinch) {
        const severity = Math.min(1, (velocity - pinchThreshold) / pinchThreshold);
        drawColour = severity > 0.5 ? '#f44336' : '#ff9800';
      } else {
        drawColour = colour;
      }

      ctx.strokeStyle = drawColour;
      // Duct width is stored in metres — draw the band at its real plan-view
      // width (e.g. 700mm) rather than a flow-derived line thickness.
      ctx.lineWidth = Math.max(1, toPx((width || 0.3) * 1000));
      if (isPinch && !isSelected) ctx.lineWidth = Math.max(ctx.lineWidth, 1.5);
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.lineTo(pB.x, pB.y);
      ctx.stroke();

      // Draw pinch indicator at duct midpoint
      if (isPinch && !isSelected) {
        const mx = (pA.x + pB.x) / 2;
        const my = (pA.y + pB.y) / 2;
        ctx.save();
        ctx.fillStyle = drawColour;
        ctx.beginPath();
        ctx.arc(mx, my, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });

    // Draw VAV terminal boxes (smaller markers)
    (riser.vav || []).forEach((vav) => {
      let pt;
      if (typeof vav[0] === 'string') {
        pt = pointMap.get(vav[0]);
      } else {
        pt = fp.Points[vav[0]];
      }
      if (!pt) return;
      
      const isSelected = fp.selectedVav && 
                         fp.selectedVav.ptId === vav[0] && 
                         fp.selectedVav.load === vav[1];

      const vavSize = isSelected ? 8 : 5;
      ctx.fillStyle = isSelected ? '#00e676' : colour;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 0.5;
      ctx.fillRect(pt.x - vavSize / 2, pt.y - vavSize / 2, vavSize, vavSize);
      ctx.strokeRect(pt.x - vavSize / 2, pt.y - vavSize / 2, vavSize, vavSize);
    });

    // Draw entry point (riser root)
    if (riser.entryPoint !== null && riser.entryPoint !== undefined) {
      let pt;
      if (typeof riser.entryPoint === 'string') {
        pt = pointMap.get(riser.entryPoint);
      } else {
        pt = fp.Points[riser.entryPoint];
      }
      if (pt) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2); // Smaller (5px)
        ctx.fillStyle = colour;
        ctx.globalAlpha = 0.3;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Diamond marker (smaller)
        ctx.beginPath();
        ctx.moveTo(pt.x,     pt.y - 4);
        ctx.lineTo(pt.x + 3, pt.y);
        ctx.lineTo(pt.x,     pt.y + 4);
        ctx.lineTo(pt.x - 3, pt.y);
        ctx.closePath();
        ctx.fillStyle = colour;
        ctx.fill();
      }
    }

    // Draw return point if applicable
    if (riser.returnPoint !== null && riser.returnPoint !== undefined) {
      let pt = typeof riser.returnPoint === 'string' ? pointMap.get(riser.returnPoint) : fp.Points[riser.returnPoint];
      if (pt) {
        ctx.save();
        const _rw = 10, _rh = 7;
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.strokeRect(pt.x - _rw / 2, pt.y - _rh / 2, _rw, _rh);
        ctx.setLineDash([]);
        ctx.font = 'bold 6px sans-serif';
        ctx.fillStyle = colour;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('R', pt.x, pt.y);
        ctx.restore();
      }
    }
  });

  // ── Bend point detection ──────────────────────────────────────────────────────
  // Build adjacency across all risers: pointId → [{w, h, otherPt}]
  const adjacency = new Map();
  plan.forEach(riser => {
    (riser.ducts || []).forEach(duct => {
      if (duct.length !== 5) return;
      const [idA, idB, w, h] = duct;
      const pA = pointMap.get(idA);
      const pB = pointMap.get(idB);
      if (!pA || !pB) return;
      if (!adjacency.has(idA)) adjacency.set(idA, []);
      if (!adjacency.has(idB)) adjacency.set(idB, []);
      adjacency.get(idA).push({ w, h, otherPt: pB });
      adjacency.get(idB).push({ w, h, otherPt: pA });
    });
  });

  const elbowPoints = [];
  const transitionPoints = [];
  const teePoints = [];

  adjacency.forEach((ducts, ptId) => {
    const pt = pointMap.get(ptId);
    if (!pt) return;

    if (ducts.length >= 3) { teePoints.push(pt); return; }

    if (ducts.length === 2) {
      const [d1, d2] = ducts;

      if (d1.w !== d2.w || d1.h !== d2.h) { transitionPoints.push(pt); return; }

      const dx1 = d1.otherPt.x - pt.x, dy1 = d1.otherPt.y - pt.y;
      const dx2 = d2.otherPt.x - pt.x, dy2 = d2.otherPt.y - pt.y;
      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      if (len1 > 0 && len2 > 0) {
        const dot = (dx1 / len1) * (dx2 / len2) + (dy1 / len1) * (dy2 / len2);
        if (Math.abs(dot) < 0.3) elbowPoints.push(pt);
      }
    }
  });

  const drawFittingDots = (points, fillColor) => {
    if (points.length === 0) return;
    ctx.save();
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 0.75;
    points.forEach(pt => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  };

  drawFittingDots(elbowPoints,      '#ffeb3b'); // yellow
  drawFittingDots(transitionPoints, '#ce93d8'); // purple
  drawFittingDots(teePoints,        '#ff9800'); // orange

  // Highlight selected fitting node
  if (fp.selectedFitting) {
    const selPt = pointMap.get(fp.selectedFitting.ptId);
    if (selPt) {
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(selPt.x, selPt.y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.restore();
}

/**
 * Draw buildup warning markers from fp._buildupPoints.
 * Orange = approaching threshold (≥80%), Red = exceeds threshold.
 */
export function drawBuildupWarnings(ctx, fp) {
  const points = fp._buildupPoints;
  if (!points || points.length === 0) return;

  ctx.save();
  points.forEach(bp => {
    const { pt, buildupMm, thresholdMm } = bp;
    const ratio = buildupMm / thresholdMm;
    if (ratio < 0.8) return;

    const critical = ratio >= 1;
    const isSelected = fp.selectedBuildup &&
      Math.hypot(fp.selectedBuildup.pt.x - pt.x, fp.selectedBuildup.pt.y - pt.y) < 2;

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, isSelected ? 8 : 6, 0, Math.PI * 2);
    ctx.fillStyle   = critical ? 'rgba(229,57,53,0.85)' : 'rgba(255,152,0,0.75)';
    ctx.strokeStyle = critical ? '#b71c1c' : '#e65100';
    ctx.lineWidth   = isSelected ? 2 : 1;
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}

// ── North symbol + scale bar ───────────────────────────────────────────────
// Fixed HUD elements drawn in screen space (called outside the pan/zoom
// transform), so they never move or resize with the plan itself.

function _niceScaleNumber(raw) {
  if (!raw || !isFinite(raw) || raw <= 0) return 1;
  const exponent = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exponent);
  const fraction = raw / base;
  let niceFraction;
  if (fraction < 1.5) niceFraction = 1;
  else if (fraction < 3.5) niceFraction = 2;
  else if (fraction < 7.5) niceFraction = 5;
  else niceFraction = 10;
  return niceFraction * base;
}

// vpScale: current zoom factor of the canvas viewport (1 = no zoom).
export function drawScaleBar(ctx, fp, vpScale = 1) {
  const pxPerUnit = fp.units?.pxPerUnit;
  if (!pxPerUnit || !isFinite(pxPerUnit) || pxPerUnit <= 0) return;
  const unitLabel = fp.units?.length || 'm';

  const screenPxPerUnit = pxPerUnit * (vpScale || 1);
  const targetPx = 100;
  const niceUnits = _niceScaleNumber(targetPx / screenPxPerUnit);
  const barPx = niceUnits * screenPxPerUnit;

  const H = ctx.canvas.height;
  const marginX = 20, marginY = 24;
  const x0 = marginX, y0 = H - marginY, x1 = x0 + barPx;

  ctx.save();
  ctx.strokeStyle = '#222';
  ctx.fillStyle = '#222';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0); ctx.lineTo(x1, y0);
  ctx.moveTo(x0, y0 - 5); ctx.lineTo(x0, y0 + 5);
  ctx.moveTo(x1, y0 - 5); ctx.lineTo(x1, y0 + 5);
  ctx.stroke();

  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${niceUnits} ${unitLabel}`, (x0 + x1) / 2, y0 - 8);
  ctx.restore();
}

// Standard compass-rose arrowhead, pointing up, "N" above the tip.
// Bottom-left corner, stacked directly above the scale bar.
export function drawNorthSymbol(ctx) {
  const marginX = 20;
  const H = ctx.canvas.height;
  const cx = marginX + 14;
  const tipY = H - 96;
  const notchY = H - 72;
  const baseY = H - 60;
  const halfW = 9;

  ctx.save();
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.moveTo(cx, tipY);
  ctx.lineTo(cx + halfW, baseY);
  ctx.lineTo(cx, notchY);
  ctx.lineTo(cx - halfW, baseY);
  ctx.closePath();
  ctx.fill();

  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('N', cx, tipY - 4);
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
  drawEntryPoints,
  drawGridEdges,
  drawDoorGhost,
  drawBackgroundGrid,
  drawGridOriginGhost,
  drawSplitPreview,
  drawThermalZones,
  drawThermalControlZones,
  drawDuctPlan,
  drawBeams,
  drawBuildupWarnings,
  drawScaleBar,
  drawNorthSymbol
};

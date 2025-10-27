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

export function drawAreas(ctx, fp) {
  fp.areas.forEach(area => {
    // area.vertices may be stored as coordinates [[x,y],...] or as node IDs
    // (strings) when plans are serialized. Normalize to coordinate array.
    let pts = area.vertices;
    if (pts.length === 0) return;
    // detect nodeId style: string entries
    if (typeof pts[0] === 'string') {
      // resolve node ids to coords
      const resolved = pts.map(id => getNodeById(fp.wall_graph.nodes, id)).filter(Boolean).map(n => [n.x, n.y]);
      pts = resolved;
      if (pts.length === 0) return;
    }

    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();

  // Use the areaColour helper so different labels (including the
  // canonical 'boundary') are rendered distinctively.
  const col = areaColour(area.label || '');
  ctx.fillStyle = col.fill || 'rgba(120,120,120,0.15)';
  ctx.fill();

  ctx.strokeStyle = col.stroke || '#666';
  ctx.lineWidth = col.strokeWidth || 1;
  if (col.dashed) ctx.setLineDash([6, 4]);
  ctx.stroke();
  if (col.dashed) ctx.setLineDash([]);

    const cx = pts.reduce((s, v) => s + v[0], 0) / pts.length;
    const cy = pts.reduce((s, v) => s + v[1], 0) / pts.length;
    ctx.fillStyle = "#000";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(area.label, cx, cy - 8);

    // compute polygon area (in px^2) and display formatted area
    try {
      const areaPx = polygonArea(pts);
      const areaText = formatArea(areaPx);
      ctx.font = "11px sans-serif";
      ctx.fillStyle = "#222";
      ctx.fillText(areaText, cx, cy + 10);
    } catch (err) {
      // non-fatal: if polygonArea or formatArea fail, don't break rendering
      console.warn('Area formatting failed', err);
    }
  });
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
      // align node to last
      const dx = Math.abs(nodeSnap.x - lastX);
      const dy = Math.abs(nodeSnap.y - lastY);
      if (dx > dy) { previewX = nodeSnap.x; previewY = lastY; } else { previewX = lastX; previewY = nodeSnap.y; }
      previewMode = 'constrained';
    } else if (edgeSnap && !constrain) {
      previewX = edgeSnap.x; previewY = edgeSnap.y; previewMode = 'edge';
    } else if (edgeSnap && constrain && lastX != null) {
      const dx = Math.abs(edgeSnap.x - lastX);
      const dy = Math.abs(edgeSnap.y - lastY);
      if (dx > dy) { previewX = edgeSnap.x; previewY = lastY; } else { previewX = lastX; previewY = edgeSnap.y; }
      previewMode = 'constrained';
    } else if (constrain && lastX != null) {
      // project mouse onto horizontal/vertical through last vertex
      const proj = projectToVertex({ x: lastX, y: lastY }, { x: mouse.x, y: mouse.y });
      previewX = proj.x; previewY = proj.y; previewMode = 'constrained';
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
  if (label === 'boundary') return { fill: 'rgba(0,0,0,0.06)', stroke: '#333', strokeWidth: 2, dashed: false };
  return map[label] || { fill: "rgba(120,120,120,0.2)", stroke: "#666" };
}

export function drawWalls(ctx, fp, options = {}) {
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 2;
  fp.wall_graph.edges.forEach((edge, i) => {
    const n1 = getNodeById(fp.wall_graph.nodes, edge.v1);
    const n2 = getNodeById(fp.wall_graph.nodes, edge.v2);
    if (!n1 || !n2) return;

    // Visual differentiation: selected segment and locked segments
    const isSelected = fp.selectedSegment === i || options.selectedSegment === i;
    const isLocked = !!edge.locked;

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
    } else if (isLocked) {
      ctx.strokeStyle = "#888";
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = "#222";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (options.mode === "draw") {
        const len = edgeLength(fp, edge);
        const mid = edgeMidpoint(fp, edge);

        ctx.save();
        ctx.fillStyle = "#000";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(formatLen(len), mid.x, mid.y);
        ctx.restore();
    }
  });
}

export function drawVertices(ctx, fp) {
  ctx.fillStyle = "#cc0000";
  fp.wall_graph.nodes.forEach(node => {
    ctx.beginPath();
    ctx.arc(node.x, node.y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
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
    const dx = Math.abs(ghostX - lastX);
    const dy = Math.abs(ghostY - lastY);
    if (dx > dy) {
      ghostY = lastY;
    } else {
      ghostX = lastX;
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

// export default object for convenience
export default {
  isNearFirstNode,
  drawEdgeWithDimension,
  drawAreas,
  drawAreaGhost,
  areaColour,
  drawWalls,
  drawVertices,
  drawHoverDimensions,
  drawHoverTooltip,
  drawGhost,
  drawEntranceProjection,
  drawEntrances,
  findClosestBoundaryPoint,
  drawProjectionGuides
};

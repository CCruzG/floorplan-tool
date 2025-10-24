// renderer/drawing/renderers.js
import { closestPointOnSegment, findClosestProjection, edgeLength, edgeMidpoint, isPointNearEdge, closestEdgeProjection } from './geometry.js';
import { formatLen } from '../../config.js'
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

    ctx.fillStyle = area.label === "private" ? "rgba(200,0,0,0.2)" : "rgba(0,200,0,0.2)";
    ctx.fill();

    ctx.strokeStyle = "#666";
    ctx.lineWidth = 1;
    ctx.stroke();

    const cx = pts.reduce((s, v) => s + v[0], 0) / pts.length;
    const cy = pts.reduce((s, v) => s + v[1], 0) / pts.length;
    ctx.fillStyle = "#000";
    ctx.font = "12px sans-serif";
    ctx.fillText(area.label, cx, cy);
  });
}

export function drawAreaGhost(ctx, points, mouse) {
  if (!points.length) return;
  ctx.save();
  ctx.strokeStyle = "#007acc";
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 2;

  ctx.beginPath();
  points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  if (mouse?.x != null && mouse?.y != null) ctx.lineTo(mouse.x, mouse.y);
  ctx.stroke();

  points.forEach(([px, py]) => {
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#007acc";
    ctx.fill();
  });

  ctx.restore();
}

export function areaColour(label) {
  const map = {
    private: { fill: "rgba(200,0,0,0.2)", stroke: "#a22" },
    common: { fill: "rgba(0,150,0,0.2)", stroke: "#2a2" },
    circulation: { fill: "rgba(0,0,200,0.2)", stroke: "#22a" }
  };
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
      ctx.fillText(len.toFixed(2), mid.x, mid.y);
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
    ctx.fillText(len.toFixed(2), mid.x, mid.y);
    ctx.restore();
  }
}

export function drawHoverTooltip(ctx, fp, options) {
  const { ghost } = options;
  const hit = closestEdgeProjection(fp, ghost);
  if (!hit) return;
  if (hit.dist > 8) return;

  const len = edgeLength(fp, hit.edge).toFixed(2);
  drawTooltip(ctx, `${len}`, ghost.x, ghost.y, {
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

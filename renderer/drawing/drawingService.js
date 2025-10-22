// renderer/drawing/drawingService.js
import { closestPointOnSegment, findClosestProjection, edgeLength, edgeMidpoint, isPointNearEdge, closestEdgeProjection } from './geometry.js';
import { formatLen } from '../../config.js'

import { drawTooltip } from '../ui/labels.js'
const SNAP_DISTANCE = 10;

function isNearFirstNode(fp, mouse) {
  if (!fp || fp.wall_graph.nodes.length === 0) return false;
  const [fx, fy] = fp.wall_graph.nodes[0];
  return Math.hypot(mouse.x - fx, mouse.y - fy) < SNAP_DISTANCE;
}

function drawEdgeWithDimension(ctx, edge) {
  const [x1, y1] = edge.v1;
  const [x2, y2] = edge.v2;

  // wall line
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // live length
  const len = edgeLength(edge);
  const mid = edgeMidpoint(edge);
  ctx.save();
  ctx.fillStyle = "#444";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(formatLen(len), mid.x, mid.y);
  ctx.restore();
}

export const DrawingService = {
  render(ctx, fp, options = {}) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!fp) return;

    // Optional background
    // ctx.fillStyle = "#ffffff";
    // ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Base elements
    this.drawAreas(ctx, fp);
    this.drawWalls(ctx, fp, options);
    this.drawEntrances(ctx, fp);
    if (options.showVertices) this.drawVertices(ctx, fp);

    // Ghost preview (pass both mouse and constrain flag)
    if (options.ghost) {
      this.drawGhost(ctx, fp, options.ghost, { constrain: options.constrain });
    }

    if (options.ghost && fp.boundaryClosed && options.mode === 'entrance') {
      this.drawEntranceProjection(ctx, fp, options.ghost);
    }

    if (options.ghost && !fp.boundaryClosed) {
      this.drawGhost(ctx, fp, options.ghost, { constrain: options.constrain });
      this.drawProjectionGuides(ctx, fp, options.ghost);
    }
    // Hover dimensions (not during boundary drawing)
    if (options.ghost && options.mode !== "draw") {
      // this.drawHoverDimensions(ctx, fp, options);
      this.drawHoverTooltip(ctx, fp, options);
    }

    if (options.mode === "area" && options.tempArea) {
      this.drawAreaGhost(ctx, options.tempArea, options.ghost);
    }


  },

  drawAreas(ctx, fp) {
    fp.areas.forEach(area => {
      ctx.beginPath();
      area.vertices.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();

      // Fill with semi-transparent colour
      ctx.fillStyle = area.label === "private" ? "rgba(200,0,0,0.2)" : "rgba(0,200,0,0.2)";
      ctx.fill();

      ctx.strokeStyle = "#666";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Label in centroid
      const cx = area.vertices.reduce((s, v) => s + v[0], 0) / area.vertices.length;
      const cy = area.vertices.reduce((s, v) => s + v[1], 0) / area.vertices.length;
      ctx.fillStyle = "#000";
      ctx.font = "12px sans-serif";
      ctx.fillText(area.label, cx, cy);
    });
  },

  drawAreaGhost(ctx, points, mouse) {
    if (!points.length) return;

    ctx.save();
    ctx.strokeStyle = "#007acc";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 2;

    // Polyline through clicked points
    ctx.beginPath();
    points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    if (mouse?.x != null && mouse?.y != null) ctx.lineTo(mouse.x, mouse.y);
    ctx.stroke();

    // Vertex markers
    points.forEach(([px, py]) => {
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#007acc";
      ctx.fill();
    });

    ctx.restore();
  },

  areaColour(label) {
    // Basic mapping; expand as needed
    const map = {
      private: { fill: "rgba(200,0,0,0.2)", stroke: "#a22" },
      common: { fill: "rgba(0,150,0,0.2)", stroke: "#2a2" },
      circulation: { fill: "rgba(0,0,200,0.2)", stroke: "#22a" }
    };
    return map[label] || { fill: "rgba(120,120,120,0.2)", stroke: "#666" };
  },

  // Draw walls
  drawWalls(ctx, fp, options = {}) {
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 2;

    // const selectedSegment = options.selectedSegment.index;
    const selectedSegment = options.selectedSegment;
    fp.wall_graph.edges.forEach((edge, i) => {
      // console.log("selected segment: "+JSON.stringify(selectedSegment));
      const [x1, y1] = edge.v1;
      const [x2, y2] = edge.v2;

      // draw the wall line
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      if (i === selectedSegment) {
        ctx.strokeStyle = "#ff0000"; // highlight colour
        ctx.setLineDash([]);
        ctx.lineWidth = 3;
      } else if (edge.locked) {
        ctx.strokeStyle = "#6ac819ff"; // locked style
        ctx.setLineDash([6, 3]);
        ctx.lineWidth = 4;
      } else {
        ctx.strokeStyle = "#222";
        ctx.setLineDash([]);
        ctx.lineWidth = 2;
      }

      ctx.stroke();

      // show dimension while drawing
      if (options.mode === "draw") {
        const len = edgeLength(edge);
        const mid = edgeMidpoint(edge);

        ctx.save();
        ctx.fillStyle = "#000";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(len.toFixed(2), mid.x, mid.y);
        ctx.restore();
      }

      if (options.mode === "draw" && options.ghost && fp.wall_graph.nodes.length > 0) {
        const last = fp.wall_graph.nodes[fp.wall_graph.nodes.length - 1];
        const [x1, y1] = last;
        const { x: x2, y: y2 } = options.ghost;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.setLineDash([4, 2]);
        ctx.strokeStyle = "#888";
        ctx.stroke();
        ctx.setLineDash([]);

        const len = Math.hypot(x2 - x1, y2 - y1);
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        ctx.fillStyle = "#444";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(len.toFixed(2), mx, my);
      }


    });
  },

  drawVertices(ctx, fp) {
    ctx.fillStyle = "#cc0000";
    fp.wall_graph.nodes.forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  },

  drawHoverDimensions(ctx, fp, options) {
    const pt = options.ghost;
    let hovered = null;

    // Find nearest edge that passes threshold
    fp.wall_graph.edges.forEach(edge => {
      if (isPointNearEdge(pt, edge, 6)) {
        hovered = edge;
      }
    });

    if (hovered) {
      const len = edgeLength(hovered);
      const mid = edgeMidpoint(hovered);

      ctx.save();
      ctx.fillStyle = "#007acc";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(len.toFixed(2), mid.x, mid.y);
      ctx.restore();
    }
  },

  drawHoverTooltip(ctx, fp, options) {
    const { ghost } = options;
    const hit = closestEdgeProjection(fp, ghost);
    if (!hit) return;

    // threshold to show tooltip (tune as needed)
    if (hit.dist > 8) return;

    const len = edgeLength(hit.edge).toFixed(2);
    drawTooltip(ctx, `${len}`, ghost.x, ghost.y, {
      font: "12px sans-serif",
      bg: "rgba(30,30,35,0.95)",
      fg: "#fff",
      offsetX: 14,
      offsetY: 12,
      radius: 6
    });
  },

  drawGhost(ctx, fp, mouse, { constrain = false } = {}) {
    if (!fp || fp.boundaryClosed || fp.wall_graph.nodes.length === 0) return;

    const [lastX, lastY] = fp.wall_graph.nodes.at(-1);
    let ghostX = mouse.x;
    let ghostY = mouse.y;

    // Apply orthogonal constraint if requested
    let constrained = false;
    if (constrain) {
      const dx = Math.abs(ghostX - lastX);
      const dy = Math.abs(ghostY - lastY);
      if (dx > dy) {
        ghostY = lastY; // horizontal
      } else {
        ghostX = lastX; // vertical
      }
      constrained = true;
    }

    // Draw the ghost line
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(ghostX, ghostY);

    if (constrained) {
      ctx.strokeStyle = "green";   // visual cue for constraint
      ctx.lineWidth = 2;
      ctx.setLineDash([]);         // solid line when constrained
    } else {
      ctx.strokeStyle = "blue";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);     // dashed line for free preview
    }
    ctx.stroke();
    ctx.setLineDash([]);           // reset

    // Optional: mark the snapped endpoint when constrained
    if (constrained) {
      ctx.fillStyle = "green";
      ctx.beginPath();
      ctx.arc(ghostX, ghostY, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Highlight first vertex if mouse is near (snap-to-close cue)
    if (isNearFirstNode(fp, mouse)) {
      const [fx, fy] = fp.wall_graph.nodes[0];
      ctx.fillStyle = "orange";
      ctx.beginPath();
      ctx.arc(fx, fy, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  drawEntranceProjection(ctx, fp, mouse) {
    if (!fp.boundaryClosed) return;
    const closest = this.findClosestBoundaryPoint(fp, mouse);
    if (!closest) return;

    // Draw a marker at the projected point
    ctx.fillStyle = "purple";
    ctx.beginPath();
    ctx.arc(closest.x, closest.y, 6, 0, Math.PI * 2);
    ctx.fill();

    // Optional: draw a short perpendicular tick to suggest a doorway
    // const [i, j] = closest.edge;
    // const [ax, ay] = fp.wall_graph.nodes[i];
    // const [bx, by] = fp.wall_graph.nodes[j];
    const [ax, ay] = closest.edge.v1;
    const [bx, by] = closest.edge.v2;
    // const [bx, by] = fp.wall_graph.nodes[j];

    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const nx = -dy / len; // unit normal
      const ny = dx / len;
      ctx.strokeStyle = "purple";
      ctx.beginPath();
      ctx.moveTo(closest.x, closest.y);
      ctx.lineTo(closest.x + nx * 15, closest.y + ny * 15);
      ctx.stroke();
    }
  },

  drawEntrances(ctx, fp) {
    ctx.strokeStyle = "purple";
    ctx.lineWidth = 3;
    fp.entrances.forEach(ent => {
      const [x, y] = ent.position;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.stroke();
    });
  },

  findClosestBoundaryPoint(fp, mouse) {
    let best = null;
    let bestDist = Infinity;

    fp.wall_graph.edges.forEach(seg => {
      const [x1, y1] = seg.v1;
      const [x2, y2] = seg.v2;

      // project pt onto segment
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
  },

  drawProjectionGuides(ctx, fp, mouse) {
    const proj = findClosestProjection(fp, mouse);
    if (!proj) return;

    ctx.strokeStyle = "rgba(0,0,255,0.3)";
    ctx.setLineDash([2, 2]);

    // vertical line
    ctx.beginPath();
    ctx.moveTo(proj.x, 0);
    ctx.lineTo(proj.x, ctx.canvas.height);
    ctx.stroke();

    // horizontal line
    ctx.beginPath();
    ctx.moveTo(0, proj.y);
    ctx.lineTo(ctx.canvas.width, proj.y);
    ctx.stroke();

    ctx.setLineDash([]);

    // marker
    ctx.fillStyle = "blue";
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

};



// export { findClosestBoundaryPoint };

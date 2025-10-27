import { getNodeById } from '../models/floorPlanUtils.js';


export function closestEdgeProjection(fp, pt) {
  if (!pt) return null;
  let best = null;
  let minDist = Infinity;

  fp.wall_graph.edges.forEach((edge, i) => {
    // const [x1, y1] = edge.v1;
    // const [x2, y2] = edge.v2;
    const n1 = getNodeById(fp.wall_graph.nodes, edge.v1);
    const n2 = getNodeById(fp.wall_graph.nodes, edge.v2);
    if (!n1 || !n2) return null;

    const x1 = n1.x, y1 = n1.y;
    const x2 = n2.x, y2 = n2.y;


    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1;

    let t = ((pt.x - x1) * dx + (pt.y - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;

    const dist = Math.hypot(pt.x - projX, pt.y - projY);
    if (dist < minDist) {
      minDist = dist;
      best = { edge, index: i, projX, projY, dist };
    }
  });

  return best;
}

export function closestPointOnSegment(ax, ay, bx, by, px, py) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;

  const abLenSq = abx * abx + aby * aby;
  let t = (apx * abx + apy * aby) / abLenSq;
  t = Math.max(0, Math.min(1, t)); // clamp to [0,1]

  return [ax + t * abx, ay + t * aby];
}

export function edgeAngle(fp, edge) {
  // const [x1, y1] = edge.v1;
  // const [x2, y2] = edge.v2;
  const n1 = getNodeById(fp.wall_graph.nodes, edge.v1);
  const n2 = getNodeById(fp.wall_graph.nodes, edge.v2);
  if (!n1 || !n2) return null;

  const x1 = n1.x, y1 = n1.y;
  const x2 = n2.x, y2 = n2.y;
  return Math.atan2(y2 - y1, x2 - x1); // radians
}

export function edgeLength(fp, edge) {
  const n1 = getNodeById(fp.wall_graph.nodes, edge.v1);
  const n2 = getNodeById(fp.wall_graph.nodes, edge.v2);
  if (!n1 || !n2) return null;

  const x1 = n1.x, y1 = n1.y;
  const x2 = n2.x, y2 = n2.y;
  return Math.hypot(x2 - x1, y2 - y1);
}

export function edgeMidpoint(fp, edge) {
  const n1 = getNodeById(fp.wall_graph.nodes, edge.v1);
  const n2 = getNodeById(fp.wall_graph.nodes, edge.v2);
  if (!n1 || !n2) return null;

  const x1 = n1.x, y1 = n1.y;
  const x2 = n2.x, y2 = n2.y;
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
}

export function findClosestEdgeProjection(fp, { x, y }, maxDist) {
  let closest = null;
  let minDist = Infinity;
  fp.wall_graph.edges.forEach((edge, i) => {
    // const [x1, y1] = edge.v1;
    // const [x2, y2] = edge.v2;
    const n1 = getNodeById(fp.wall_graph.nodes, edge.v1);
    const n2 = getNodeById(fp.wall_graph.nodes, edge.v2);
    if (!n1 || !n2) return null;

    const x1 = n1.x, y1 = n1.y;
    const x2 = n2.x, y2 = n2.y;

    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((x - x1) * dx + (y - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    const dist = Math.hypot(x - projX, y - projY);
    if (dist < minDist) {
      minDist = dist;
      closest = { type: "edge", index: i, x: projX, y: projY, dist, t };
    }
  });
  return (closest && closest.dist <= maxDist) ? closest : null;
}

export function findClosestNode(fp, { x, y }, maxDist) {
  let closest = null;
  let minDist = Infinity;
  fp.wall_graph.nodes.forEach((node, i) => {
    const dist = Math.hypot(x - node.x, y - node.y);
    if (dist < minDist) {
      minDist = dist;
      closest = { type: "node", index: i, x: node.x, y: node.y, dist };
    }
  });
  return (closest && closest.dist <= maxDist) ? closest : null;
}

export function findClosestProjection(fp, mouse) {
  let best = null;
  let bestDist = Infinity;

  fp.wall_graph.nodes.forEach(node => {
    const proj = projectToVertex(node, mouse);
    const dist = Math.hypot(mouse.x - proj.x, mouse.y - proj.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = proj;
    }
  });

  return best;
}

export function findClosestSegment(fp, pt, threshold = 8) {
  let best = null;
  let minDist = Infinity;

  fp.wall_graph.edges.forEach((edge, i) => {
    // const [x1, y1] = edge.v1;
    // const [x2, y2] = edge.v2;
    const n1 = getNodeById(fp.wall_graph.nodes, edge.v1);
    const n2 = getNodeById(fp.wall_graph.nodes, edge.v2);
    if (!n1 || !n2) return null;

    const x1 = n1.x, y1 = n1.y;
    const x2 = n2.x, y2 = n2.y;

    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1;

    let t = ((pt.x - x1) * dx + (pt.y - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;

    const dist = Math.hypot(pt.x - projX, pt.y - projY);
    if (dist < minDist && dist <= threshold) {
      minDist = dist;
      best = { index: i, edge };
    }
  });

  return best;
}


export function isPointNearEdge(fp, pt, edge, threshold = 6) {
  if (!pt) return false;
  // resolve nodes from fp
  const n1 = getNodeById(fp.wall_graph.nodes, edge.v1);
  const n2 = getNodeById(fp.wall_graph.nodes, edge.v2);
  if (!n1 || !n2) return false;

  const x1 = n1.x, y1 = n1.y;
  const x2 = n2.x, y2 = n2.y;
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((pt.x - x1) * dx + (pt.y - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  const dist = Math.hypot(pt.x - projX, pt.y - projY);
  return dist <= threshold;
}

export function projectToVertex(vertex, mouse) {
  // const [vx, vy] = vertex;
  const vx = vertex.x, vy = vertex.y;
  const vertical = { x: vx, y: mouse.y };
  const horizontal = { x: mouse.x, y: vy };

  const dVert = Math.abs(mouse.x - vx);
  const dHoriz = Math.abs(mouse.y - vy);

  return dVert < dHoriz ? vertical : horizontal;
}

export function polygonArea(points) {
  // points: array of [x,y]
  if (!points || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += (x1 * y2 - x2 * y1);
  }
  return Math.abs(sum) / 2;
}
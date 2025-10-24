// renderer/models/floorplanUtils.js
export function getNodeById(nodes, id) {
  return nodes.find(n => n.id === id) || null;
}

export function getEdgeById(edges, id) {
  return edges.find(e => e.id === id) || null;
}

export function edgeToCoords(fp, edgeId) {
  const edge = getEdgeById(fp.wall_graph.edges, edgeId);
  if (!edge) return null;
  const n1 = getNodeById(fp.wall_graph.nodes, edge.v1);
  const n2 = getNodeById(fp.wall_graph.nodes, edge.v2);
  if (!n1 || !n2) return null;
  return { x1: n1.x, y1: n1.y, x2: n2.x, y2: n2.y, locked: edge.locked, edgeId };
}

export function areaToCoords(fp, area) {
  const pts = area.vertices
    .map(id => getNodeById(fp.wall_graph.nodes, id))
    .filter(Boolean)
    .map(n => ({ x: n.x, y: n.y }));
  return pts;
}

export function nodeCoords(fp, nodeId) {
  const n = getNodeById(fp.wall_graph.nodes, nodeId);
  return n ? { x: n.x, y: n.y } : null;
}

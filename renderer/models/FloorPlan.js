/**
export class FloorPlan {
  constructor(name = Date.now()) {
    this.name = name;
    this.wall_graph = { nodes: [], edges: [] };
    this.areas = []; // NEW: [{ label: "private", vertices: [[x,y], [x,y], ...] }]
    this.entrances = [];
    this.requirements = {}; // <— new
    this.boundaryClosed = false;
    this.selectedSegment = null;
    this.draggingSegment = null;
  }

  addVertex(x, y, { constrain = false } = {}) {
    if (constrain && this.wall_graph.nodes.length > 0) {
      const [lastX, lastY] = this.wall_graph.nodes.at(-1);
      const dx = Math.abs(x - lastX);
      const dy = Math.abs(y - lastY);

      // Snap to horizontal or vertical
      if (dx > dy) {
        y = lastY; // horizontal
      } else {
        x = lastX; // vertical
      }
    }

    this.wall_graph.nodes.push([x, y]);
    const n = this.wall_graph.nodes.length;
    // if (n > 1) this.wall_graph.edges.push([n - 2, n - 1]);
    if (n > 1) this.wall_graph.edges.push({
      v1: this.wall_graph.nodes[n - 2],
      v2: this.wall_graph.nodes[n - 1],
      locked: false
    });
  }

  // Close boundary
  closeBoundary() {
    if (this.wall_graph.nodes.length >= 3) {
      // this.wall_graph.edges.push([this.wall_graph.nodes.length - 1, 0]);
      this.wall_graph.edges.push({
        v1: this.wall_graph.nodes[this.wall_graph.nodes.length - 1],
        v2: this.wall_graph.nodes[0],
        locked: false
      });
      this.boundaryClosed = true;
      // console.log("Boundary closed");
    }
  }

  addEntrance(edge, x, y, width = 900) {
    this.entrances.push({
      edge,        // [i, j] indices of wall_graph.nodes
      position: [x, y],
      width
    });
    // console.log("addEntrance called. Entrnaces: "+this.entrances);
  }

  addArea(label, vertices) {
    // Ensure polygon is closed
    const closed = [...vertices];
    const [fx, fy] = closed[0];
    const [lx, ly] = closed[closed.length - 1];
    if (fx !== lx || fy !== ly) {
      closed.push([fx, fy]);
    }
    this.areas.push({ label, vertices: closed });
  }

  clone() {
    const fp = new FloorPlan(this.name);
    fp.wall_graph = {
      nodes: this.wall_graph.nodes.map(n => [...n]),
      edges: this.wall_graph.edges.map(seg => ({
        v1: [...seg.v1],
        v2: [...seg.v2],
        locked: seg.locked
      }))
    };
    fp.entrances = this.entrances.map(ent => ({
      // edge: [...ent.edge],
      edge: {
        v1: [...ent.edge.v1],
        v2: [...ent.edge.v2],
        locked: ent.edge.locked
      },
      position: [...ent.position],
      width: ent.width
    }));
    return fp;
  }

  // Utility to set segment selection
  selectSegment(seg) {
    this.selectedSegment = seg.index;
  }

  clearSelection() {
    this.selectedSegment = null;
  }

  toJSON() {
    return {
      name: this.name,
      boundaryClosed: this.boundaryClosed,
      wall_graph: {
        nodes: this.wall_graph.nodes.map(v => [...v]),
        edges: this.wall_graph.edges.map(seg => ({
          v1: [...seg.v1],
          v2: [...seg.v2],
          locked: seg.locked
        }))
      },
      entrances: this.entrances.map(ent => ({
        position: [...ent.position],
        edge: {
          v1: [...ent.edge.v1],
          v2: [...ent.edge.v2],
          locked: ent.edge.locked
        },
        width: ent.width
      })),
      areas: (this.areas || []).map(a => ({
        label: a.label,
        vertices: a.vertices.map(v => [...v])
      })),
      requirements: this.requirements
    };
  }


  static fromJSON(obj) {
  const fp = new FloorPlan(obj.name);
  fp.boundaryClosed = obj.boundaryClosed;

  // Prefer wall_graph, fallback to legacy vertices/edges
  const nodes = obj.wall_graph?.nodes || obj.vertices || [];
  const edges = obj.wall_graph?.edges || obj.edges || [];

  fp.wall_graph = {
    nodes: nodes.map(n => [...n]),
    edges: edges.map(seg => ({
      v1: [...seg.v1],
      v2: [...seg.v2],
      locked: seg.locked
    }))
  };

  fp.entrances = (obj.entrances || []).map(ent => {
    const pos = ent.position || [ent.x, ent.y];
    return {
      position: [...pos],
      edge: {
        v1: [...ent.edge.v1],
        v2: [...ent.edge.v2],
        locked: ent.edge.locked
      },
      width: ent.width || 900
    };
  });

  fp.areas = (obj.areas || []).map(a => ({
    label: a.label,
    vertices: a.vertices.map(v => [...v])
  }));

  fp.requirements = obj.requirements || {};

  return fp;
}

setName(newName) {
  this.name = newName;
}



  setRequirements(req) {
    this.requirements = { ...this.requirements, ...req };
  }


  toggleLockSelected() {
    if (this.selectedSegment) {
      this.selectedSegment.locked = !this.selectedSegment.locked;
    }
  }


}
**/

export class FloorPlan {
  constructor(name = Date.now()) {
    this.schema_version = "1.0.0";
    this.units = { length: "mm" };
    this.name = name;
    this.boundaryClosed = false;

    this.wall_graph = { nodes: [], edges: [] };
    this.areas = [];       // [{ id, label, vertices: [nodeIds...] }]
    this.entrances = [];   // [{ id, position: {x,y}, edgeRef, width }]
    this.requirements = {};

    this.selectedSegment = null;
    this.draggingSegment = null;
    this._idCounter = 0;   // simple ID generator
  }

  _genId(prefix) {
    return `${prefix}_${this._idCounter++}`;
  }

  addNode(x, y) {
    const id = this._genId("n");
    this.wall_graph.nodes.push({ id, x, y });
    return id;
  }

  addEdge(v1Id, v2Id, locked = false) {
    const id = this._genId("e");
    this.wall_graph.edges.push({ id, v1: v1Id, v2: v2Id, locked });
    return id;
  }

  addVertex(x, y, { constrain = false } = {}) {
    // optional snapping logic: when `constrain` is true, snap the new
    // vertex to be horizontal or vertical relative to the previous node
    // (perpendicular mode, triggered by Shift). This preserves the UX
    // where holding Shift while clicking forces horizontal/vertical lines.
    if (constrain && this.wall_graph.nodes.length > 0) {
      const last = this.wall_graph.nodes[this.wall_graph.nodes.length - 1];
      const dx = Math.abs(x - last.x);
      const dy = Math.abs(y - last.y);
      if (dx > dy) {
        y = last.y; // snap horizontally
      } else {
        x = last.x; // snap vertically
      }
    }

    const id = this.addNode(x, y);
    const nodes = this.wall_graph.nodes;
    if (nodes.length > 1) {
      const prevId = nodes[nodes.length - 2].id;
      this.addEdge(prevId, id, false);
    }
    return id;
  }

  closeBoundary() {
    if (this.wall_graph.nodes.length >= 3) {
      const firstId = this.wall_graph.nodes[0].id;
      const lastId = this.wall_graph.nodes.at(-1).id;
      this.addEdge(lastId, firstId, false);
      this.boundaryClosed = true;
      // Ensure the floorplan boundary is also represented as an area so
      // its surface can be measured and treated like other areas.
      this._updateBoundaryArea();
    }
  }

  _updateBoundaryArea() {
    // Build an ordered list of node ids describing the boundary polygon
    if (!this.boundaryClosed) return;
    const nodeIds = this.wall_graph.nodes.map(n => n.id);

    // Ensure there are at least 3 nodes
    if (nodeIds.length < 3) return;

    // Look for an existing boundary area (use label 'boundary' as canonical)
    const existing = this.areas.find(a => a && a.label === 'boundary');
    if (existing) {
      existing.vertices = [...nodeIds];
      return existing.id;
    }

    // Create a new area representing the boundary
    const id = this._genId('a');
    const area = { id, label: 'boundary', vertices: [...nodeIds] };
    this.areas.unshift(area); // keep boundary first
    return id;
  }

  addEntrance(edgeId, x, y, width = 900) {
    const id = this._genId("entr");
    this.entrances.push({
      id,
      position: { x, y },
      edgeRef: edgeId,
      width
    });
    return id;
  }

  addArea(label, nodeIds) {
    const id = this._genId("a");
    this.areas.push({ id, label, vertices: nodeIds });
    return id;
  }

  removeArea(areaId) {
    const idx = this.areas.findIndex(a => a.id === areaId);
    if (idx >= 0) this.areas.splice(idx, 1);
  }

  clearSelection() {
    this.selectedSegment = null;
  }

  clone() {
    const fp = new FloorPlan(this.name);
    fp.schema_version = this.schema_version;
    fp.units = { ...this.units };
    fp.boundaryClosed = this.boundaryClosed;
    fp.wall_graph = {
      nodes: this.wall_graph.nodes.map(n => ({ ...n })),
      edges: this.wall_graph.edges.map(e => ({ ...e }))
    };
    fp.entrances = this.entrances.map(ent => ({ ...ent, position: { ...ent.position } }));
    fp.areas = this.areas.map(a => ({ ...a, vertices: [...a.vertices] }));
    fp.requirements = { ...this.requirements };
    // Preserve the internal id counter so cloned/restored instances continue
    // generating unique ids and avoid collisions after undo/redo.
    fp._idCounter = this._idCounter;
    return fp;
  }

  toJSON() {
    return {
      schema_version: this.schema_version,
      units: this.units,
      name: this.name,
      boundaryClosed: this.boundaryClosed,
      wall_graph: {
        // Serialize node coordinates in the chosen units (not pixels) when
        // a pxPerUnit scale is available on the FloorPlan. This keeps saved
        // plans portable across display densities.
        nodes: this.wall_graph.nodes.map(n => {
          const pxPerUnit = this.units?.pxPerUnit || 1;
          // if pxPerUnit is 1 and unit label is 'px', this is effectively px
          const ux = pxPerUnit ? n.x / pxPerUnit : n.x;
          const uy = pxPerUnit ? n.y / pxPerUnit : n.y;
          return { id: n.id, x: ux, y: uy };
        }),
        edges: this.wall_graph.edges.map(e => ({ ...e }))
      },
      entrances: this.entrances.map(ent => {
        const pxPerUnit = this.units?.pxPerUnit || 1;
        const ux = pxPerUnit ? ent.position.x / pxPerUnit : ent.position.x;
        const uy = pxPerUnit ? ent.position.y / pxPerUnit : ent.position.y;
        return { ...ent, position: { x: ux, y: uy } };
      }),
      // Serialize areas preserving the vertex representation the app
      // uses in-memory. Area vertices may be:
      //  - a node id string ("n_0")
      //  - a coordinate array [x, y]
      //  - a coordinate object { x, y }
      // We preserve coordinates as arrays when present so areas that were
      // defined independently of the wall graph survive a save/open roundtrip.
      areas: (this.areas || []).map(a => ({
        id: a.id,
        label: a.label,
        vertices: (a.vertices || []).map(v => {
          const pxPerUnit = this.units?.pxPerUnit || 1;
          // node id string -> keep as-is
          if (typeof v === 'string') return v;
          // array [x,y] in pixels -> convert to units
          if (Array.isArray(v) && v.length >= 2) return [v[0] / pxPerUnit, v[1] / pxPerUnit];
          // object {x,y} -> convert to array in units
          if (v && typeof v.x === 'number' && typeof v.y === 'number') return [v.x / pxPerUnit, v.y / pxPerUnit];
          // unknown shape -> skip
          return null;
        }).filter(v => v !== null)
      })),
      requirements: this.requirements
    };
  }

  static fromJSON(obj) {
    const fp = new FloorPlan(obj.name);
    fp.schema_version = obj.schema_version || "0.9.0";
    fp.units = obj.units || { length: "mm" };
    fp.boundaryClosed = obj.boundaryClosed || false;

    // Handle legacy vs new schema
    // Determine pxPerUnit from saved units (if present). If a saved plan
    // included a pxPerUnit, the coordinates in the JSON are in that unit and
    // must be converted back to pixels for in-memory representation.
    const savedPxPerUnit = obj.units?.pxPerUnit || null;

    if (obj.wall_graph?.nodes?.length && typeof obj.wall_graph.nodes[0] === "object") {
      // New schema with IDs. Convert coordinates from saved units -> pixels
      fp.wall_graph = {
        nodes: obj.wall_graph.nodes.map(n => ({
          id: n.id,
          x: savedPxPerUnit ? n.x * savedPxPerUnit : n.x,
          y: savedPxPerUnit ? n.y * savedPxPerUnit : n.y
        })),
        edges: obj.wall_graph.edges.map(e => ({ ...e }))
      };
    } else {
      // Legacy schema with coordinate arrays
      const nodes = (obj.wall_graph?.nodes || obj.vertices || []).map(([x, y], i) => ({
        id: `n_${i}`,
        x,
        y
      }));
      const edges = (obj.wall_graph?.edges || obj.edges || []).map((seg, i) => ({
        id: `e_${i}`,
        v1: `n_${nodes.findIndex(n => n.x === seg.v1[0] && n.y === seg.v1[1])}`,
        v2: `n_${nodes.findIndex(n => n.x === seg.v2[0] && n.y === seg.v2[1])}`,
        locked: seg.locked
      }));
      fp.wall_graph = { nodes, edges };
    }

    fp.entrances = (obj.entrances || []).map((ent, i) => {
      const pos = ent.position ? ent.position : (ent.position ? { x: ent.position[0], y: ent.position[1] } : { x: 0, y: 0 });
      const pxPerUnit = savedPxPerUnit || 1;
      return {
        id: ent.id || `entr_${i}`,
        position: { x: (pos.x || 0) * pxPerUnit, y: (pos.y || 0) * pxPerUnit },
        edgeRef: ent.edgeRef || (ent.edge ? `e_${i}` : null),
        width: ent.width || 900
      };
    });

    // Load areas while supporting mixed vertex representations. We preserve
    // coordinate vertices (arrays or {x,y}) so areas independent of the
    // wall graph are not lost. When a vertex is a string and references a
    // node id (or legacy n_<index>) we normalize it to the existing node id.
    fp.areas = (obj.areas || []).map((a, i) => {
      const original = (a.vertices || []).slice();
      const mapped = (a.vertices || []).map(v => {
        // string -> try to resolve to existing node id (or legacy n_<index>)
        if (typeof v === 'string') {
          const exists = fp.wall_graph.nodes.find(n => n.id === v);
          if (exists) return v;
          const m = /^n_(-?\d+)$/.exec(v);
          if (m) {
            const idx = parseInt(m[1], 10);
            const resolvedIndex = idx < 0 ? fp.wall_graph.nodes.length + idx : idx;
            if (resolvedIndex >= 0 && resolvedIndex < fp.wall_graph.nodes.length) {
              return fp.wall_graph.nodes[resolvedIndex].id;
            }
          }
          // unknown string reference -> drop
          return null;
        }


  // array [x,y] -> treat as saved units and convert to pixels
  if (Array.isArray(v) && v.length >= 2) return [v[0] * (savedPxPerUnit || 1), v[1] * (savedPxPerUnit || 1)];

  // object {x,y} -> convert to array in pixels
  if (v && typeof v.x === 'number' && typeof v.y === 'number') return [v.x * (savedPxPerUnit || 1), v.y * (savedPxPerUnit || 1)];

        // otherwise drop
        return null;
      }).filter(v => v !== null);

      if (mapped.length !== original.length) {
        console.warn(`FloorPlan.fromJSON: area ${a.id || `a_${i}`} had ${original.length - mapped.length} invalid vertices; dropping them.`);
      }

      return {
        id: a.id || `a_${i}`,
        label: a.label,
        vertices: mapped
      };
    })
    // Keep areas that have at least 3 vertices (coordinate or ids).
    .filter(a => a.vertices && a.vertices.length >= 3);

    fp.requirements = obj.requirements || {};
    // If the saved plan indicated a closed boundary but did not include
    // an explicit boundary area, create one so the boundary surface is
    // available as an area for measurement and UI listing.
    if (fp.boundaryClosed && !fp.areas.find(a => a.label === 'boundary')) {
      fp._updateBoundaryArea();
    }

    return fp;
  }

  selectSegment(seg) {
    this.selectedSegment = seg.index;
  }

  setName(newName) {
    this.name = newName;
  }

  setRequirements(req) {
    this.requirements = { ...this.requirements, ...req };
  }

  toggleLockSelected() {
    if (this.selectedSegment) {
      this.selectedSegment.locked = !this.selectedSegment.locked;
    }
  }
}

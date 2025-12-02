/**
export class FloorPlan {
  constructor(name = Date.now()) {
    this.name = name;
    
    // Reference schema structure
    this.Plan_Boundary = []; // Array of polygon objects with Pt_0, Pt_1, etc.
    this.Core_Boundary = []; // Array of core polygon objects
    this.Columns = []; // Array of column footprint polygons
    this.Temperature_Regions = []; // Array of thermal zone objects (replacing simple areas)
    this.Beams = []; // Array of beam objects with height constraints
    this.Points = []; // Discretized grid points for routing
    this.Edges = []; // Valid connections between points
    this.Ducts = []; // Available duct specifications
    this.Duct_Plan = []; // Final duct routing solution
    
    // Layer visibility controls
    this.layers = {
      Plan_Boundary: true,
      Boundary_Area: true,
      Core_Boundary: true,
      Columns: true,
      Temperature_Regions: true,
      Beams: false,
      Points: false,
      Edges: false,
      Ducts: false,
      Duct_Plan: false
    };
    
    // Legacy compatibility - keep for gradual migration
    this.wall_graph = { nodes: [], edges: [] };
    this.areas = []; // Will be migrated to Temperature_Regions
    this.entrances = []; // Will be integrated with Points/entry_candidates
    
    // UI state
    this.boundaryClosed = false;
    this.selectedSegment = null;
    this.draggingSegment = null;
    this.mode = 'draw'; // draw | edit | area | core | column | beam
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

  // ═══════════════════════════════════════════════════════════
  // NEW REFERENCE SCHEMA METHODS
  // ═══════════════════════════════════════════════════════════

  // Convert current wall_graph to Plan_Boundary format
  updatePlanBoundaryFromWallGraph() {
    if (this.wall_graph.nodes.length >= 3 && this.boundaryClosed) {
      const boundaryPoints = {};
      this.wall_graph.nodes.forEach((node, index) => {
        boundaryPoints[`Pt_${index}`] = [node[0], node[1], 0]; // Add z=0 for 3D compatibility
      });
      
      // Close the polygon by repeating first point
      if (this.wall_graph.nodes.length > 0) {
        const firstNode = this.wall_graph.nodes[0];
        boundaryPoints[`Pt_${this.wall_graph.nodes.length}`] = [firstNode[0], firstNode[1], 0];
      }
      
      this.Plan_Boundary = [boundaryPoints];
    }
  }

  // Add core boundary (similar to area drawing)
  addCoreBoundary(vertices) {
    const boundaryPoints = {};
    vertices.forEach((vertex, index) => {
      boundaryPoints[`Pt_${index}`] = [vertex[0], vertex[1], 0];
    });
    
    // Ensure polygon is closed
    if (vertices.length > 0) {
      const firstVertex = vertices[0];
      boundaryPoints[`Pt_${vertices.length}`] = [firstVertex[0], firstVertex[1], 0];
    }
    
    this.Core_Boundary.push(boundaryPoints);
  }

  // Add column footprint
  addColumn(vertices) {
    const columnPoints = {};
    vertices.forEach((vertex, index) => {
      columnPoints[`Pt_${index}`] = [vertex[0], vertex[1], 0];
    });
    this.Columns.push(columnPoints);
  }

  // Add beam element
  addBeam(startPoint, endPoint, height = 900) {
    this.Beams.push({
      "Pt_0": [startPoint[0], startPoint[1], height],
      "Pt_1": [endPoint[0], endPoint[1], height]
    });
  }

  // Convert simple area to Temperature_Region
  addTemperatureRegion(name, type, vertices, properties = {}) {
    const subregionPoints = {};
    vertices.forEach((vertex, index) => {
      subregionPoints[`Pt_${index}`] = [vertex[0], vertex[1]];
    });

    const region = {
      id: this._genId('tr'),
      type: type || "internal", // "perimeter" | "internal"
      name: name,
      // UI presentation fields (allow color/alpha editing like legacy areas)
      color: properties.color || null,
      alpha: typeof properties.alpha === 'number' ? properties.alpha : 0.3,
      air_requirement: properties.air_requirement || 7.5,
      subregions: [subregionPoints],
      avg_load_per_point: properties.avg_load_per_point || 0,
      total_load: properties.total_load || 0,
      total_area: properties.total_area || 0,
      VAV_number: properties.VAV_number || 1,
      entry_candidates: properties.entry_candidates || [[]],
      thermal_control_zones: properties.thermal_control_zones || []
    };

    this.Temperature_Regions.push(region);
    return region.id;
  }

  // Toggle layer visibility
  toggleLayer(layerName) {
    if (this.layers.hasOwnProperty(layerName)) {
      this.layers[layerName] = !this.layers[layerName];
    }
  }

  // Set layer visibility
  setLayerVisibility(layerName, visible) {
    if (!this.layers) this.layers = {};
    this.layers[layerName] = visible;
    console.log(`FloorPlan.setLayerVisibility: ${layerName} = ${visible}`, this.layers);
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
    // Update Plan_Boundary from wall_graph before serialization
    this.updatePlanBoundaryFromWallGraph();
    
    return {
      // Reference schema structure (primary)
      name: this.name,
      Plan_Boundary: this.Plan_Boundary,
      Core_Boundary: this.Core_Boundary,
      Columns: this.Columns,
      Temperature_Regions: this.Temperature_Regions,
      Beams: this.Beams,
      Points: this.Points,
      Edges: this.Edges,
      Ducts: this.Ducts,
      Duct_Plan: this.Duct_Plan,
      layers: this.layers,
      
      // Legacy compatibility (for gradual migration)
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
      }))
    };
  }


  static fromJSON(obj, options = {}) {
    const fp = new FloorPlan(obj.name);
    
    // Load reference schema structure (primary)
    fp.Plan_Boundary = obj.Plan_Boundary || [];
    // Load core boundaries (Pt_* keyed objects) and convert units -> pixels
    fp.Core_Boundary = (obj.Core_Boundary || []).map(coreObj => {
      const pxPerUnit = savedPxPerUnit || 1;
      const out = {};
      Object.entries(coreObj).forEach(([k, v]) => {
        out[k] = [ (v[0] || 0) * pxPerUnit, (v[1] || 0) * pxPerUnit ];
      });
      return out;
    });
    fp.Columns = obj.Columns || [];
    fp.Temperature_Regions = obj.Temperature_Regions || [];
    fp.Beams = obj.Beams || [];
    fp.Points = obj.Points || [];
    fp.Edges = obj.Edges || [];
    fp.Ducts = obj.Ducts || [];
    fp.Duct_Plan = obj.Duct_Plan || [];
    fp.layers = obj.layers || {
      Plan_Boundary: true,
      Core_Boundary: true,
      Columns: true,
      Temperature_Regions: true,
      Beams: false,
      Points: false,
      Edges: false,
      Ducts: false,
      Duct_Plan: false
    };
    
    // Legacy compatibility - maintain for gradual migration
    fp.boundaryClosed = obj.boundaryClosed || false;

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

import { getPixelsPerUnit, getUnitLabel } from '../../config.js';

export class FloorPlan {
  constructor(name = Date.now()) {
    this.schema_version = "1.0.0";
    // Initialize units from the global config so new floorplans created
    // after the app starts inherit the current pxPerUnit and unit label.
    const pxPerUnit = getPixelsPerUnit() || 1;
    const unitLabel = getUnitLabel() || 'mm';
    this.units = { length: unitLabel, pxPerUnit };
    this.name = name;
    this.boundaryClosed = false;

    this.wall_graph = { nodes: [], edges: [] };
    this.areas = [];       // [{ id, label, vertices: [nodeIds...] }]
    this.entrances = [];   // [{ id, position: {x,y}, edgeRef, width }]
  // Core boundaries stored as objects with Pt_0, Pt_1 ... keys
  // e.g. { Pt_0: [x,y], Pt_1: [x,y], ... }
  this.Core_Boundary = [];
    // Reference-schema collections (ensure defined for serialization)
    this.Plan_Boundary = [];
    this.Columns = [];
    this.Points = [];
    this.Edges = [];
    this.Ducts = [];
    this.Duct_Plan = [];
    this.Temperature_Regions = [];
    this.Beams = [];
    // Layer visibility defaults
    this.layers = {
      Plan_Boundary: true,
      Boundary_Area: true,
      Core_Boundary: true,
      Core_Area: true,
      Columns: true,
      Temperature_Regions: true,
      Beams: false,
      Points: false,
      Edges: false,
      Ducts: false,
      Duct_Plan: false
    };
  // Seed default requirements so every new floorplan has a sensible default
  // (at minimum one bathroom). This ensures the evaluator and UI always
  // have a baseline to operate on.
  this.requirements = { bathrooms: 1 };

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
    // Store boundary as a special boundaryArea object rather than a regular
    // area so the user can add/modify areas independently after drawing
    // the plan boundary.
    if (!this.boundaryArea) {
      const id = this._genId('a');
      this.boundaryArea = { id, label: 'boundary', vertices: [...nodeIds] };
      return id;
    }
    this.boundaryArea.vertices = [...nodeIds];
    return this.boundaryArea.id;
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
    // Default new areas to 30% opacity
    this.areas.push({ id, label, vertices: nodeIds, color: undefined, alpha: 0.3 });
    return id;
  }

  // Add a core boundary polygon (vertices are arrays [x,y] in pixels)
  addCoreBoundary(vertices) {
    const boundaryPoints = {};
    (vertices || []).forEach((v, i) => {
      boundaryPoints[`Pt_${i}`] = [v[0], v[1]];
    });
    // close polygon by repeating the first point
    if (vertices && vertices.length > 0) {
      const first = vertices[0];
      boundaryPoints[`Pt_${vertices.length}`] = [first[0], first[1]];
    }
    this.Core_Boundary.push(boundaryPoints);
    return this.Core_Boundary.length - 1;
  }

  removeArea(areaId) {
    const idx = this.areas.findIndex(a => a.id === areaId);
    if (idx >= 0) this.areas.splice(idx, 1);
  }

  clearSelection() {
    this.selectedSegment = null;
  }

  // Layer helpers
  toggleLayer(layerName) {
    if (!this.layers) this.layers = {};
    if (this.layers.hasOwnProperty(layerName)) this.layers[layerName] = !this.layers[layerName];
  }

  setLayerVisibility(layerName, visible) {
    if (!this.layers) this.layers = {};
    this.layers[layerName] = visible;
    console.log(`FloorPlan.setLayerVisibility: ${layerName} = ${visible}`, this.layers);
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
    const pxPerUnit = this.units?.pxPerUnit || 1;

    // Helper to convert an ordered list of [x,y] pixel coords into a Pt_* keyed object
    const coordsToPtObj = (coords) => {
      const out = {};
      coords.forEach((c, i) => {
        out[`Pt_${i}`] = [c[0] / pxPerUnit, c[1] / pxPerUnit, 0];
      });
      // ensure closed polygon by repeating first point if not already
      if (coords.length > 0) {
        const first = coords[0];
        out[`Pt_${coords.length}`] = [first[0] / pxPerUnit, first[1] / pxPerUnit, 0];
      }
      return out;
    };

    // Plan boundary: prefer Plan_Boundary if present, otherwise use boundaryArea/wall_graph
    let planBoundaryOut = this.Plan_Boundary || [];
    if (!planBoundaryOut || planBoundaryOut.length === 0) {
      if (this.boundaryArea && Array.isArray(this.boundaryArea.vertices) && this.boundaryArea.vertices.length) {
        // convert boundaryArea vertices (resolve node ids)
        const mapped = this.boundaryArea.vertices.map(v => {
          if (typeof v === 'string') {
            const n = this.wall_graph.nodes.find(n => n.id === v);
            return n ? [n.x, n.y] : null;
          }
          return Array.isArray(v) ? [v[0], v[1]] : null;
        }).filter(Boolean);
        planBoundaryOut = [coordsToPtObj(mapped)];
      } else if (this.wall_graph.nodes && this.wall_graph.nodes.length) {
        const mapped = this.wall_graph.nodes.map(n => [n.x, n.y]);
        planBoundaryOut = [coordsToPtObj(mapped)];
      }
    }

    // Core boundaries: convert existing Pt_* objects to include z and unit conversion
    const coreOut = (this.Core_Boundary || []).map(core => {
      const out = {};
      Object.entries(core).forEach(([k, v]) => {
        out[k] = [ (v[0] / pxPerUnit), (v[1] / pxPerUnit), 0 ];
      });
      return out;
    });

    // Columns: ensure unit conversion and z coordinate
    const columnsOut = (this.Columns || []).map(col => {
      const out = {};
      Object.entries(col).forEach(([k, v]) => {
        out[k] = [ (v[0] / pxPerUnit), (v[1] / pxPerUnit), (v[2] || 0) ];
      });
      return out;
    });

    // Points & Edges (export a simple point list and edge list derived from wall_graph)
    const pointsOut = (this.wall_graph.nodes || []).map(n => ({ id: n.id, x: n.x / pxPerUnit, y: n.y / pxPerUnit }));
    const edgesOut = (this.wall_graph.edges || []).map(e => ({ id: e.id || null, v1: e.v1, v2: e.v2, locked: !!e.locked }));

    // Build final object that mirrors the duct_plan.json top-level keys while
    // still retaining backward-compatible fields like wall_graph and areas.
    return {
      Plan_Boundary: planBoundaryOut,
      Core_Boundary: coreOut,
      Columns: columnsOut,
      Temperature_Regions: this.Temperature_Regions || [],
      Beams: this.Beams || [],
      Points: pointsOut,
      Edges: edgesOut,
      Ducts: this.Ducts || [],
      Duct_Plan: this.Duct_Plan || [],
      // Preserve legacy/compat fields for the app
      schema_version: this.schema_version,
      units: this.units,
      name: this.name,
      boundaryClosed: this.boundaryClosed,
      wall_graph: {
        nodes: this.wall_graph.nodes.map(n => ({ id: n.id, x: n.x / pxPerUnit, y: n.y / pxPerUnit })),
        edges: this.wall_graph.edges.map(e => ({ ...e }))
      },
      entrances: this.entrances.map(ent => ({ ...ent, position: { x: ent.position.x / pxPerUnit, y: ent.position.y / pxPerUnit } })),
      areas: (this.areas || []).map(a => ({ id: a.id, label: a.label, color: a.color, alpha: a.alpha, vertices: (a.vertices || []).map(v => (typeof v === 'string' ? v : (Array.isArray(v) ? [v[0] / pxPerUnit, v[1] / pxPerUnit] : null))).filter(Boolean) })),
      boundaryArea: this.boundaryArea ? { id: this.boundaryArea.id, label: 'boundary', vertices: (this.boundaryArea.vertices || []).map(v => (typeof v === 'string' ? v : (Array.isArray(v) ? [v[0] / pxPerUnit, v[1] / pxPerUnit] : null))).filter(Boolean) } : null,
      layers: this.layers,
      requirements: this.requirements
    };
  }

  static fromJSON(obj, options = {}) {
    const fp = new FloorPlan(obj.name);
    fp.schema_version = obj.schema_version || "0.9.0";
    fp.units = obj.units || { length: "mm" };
    fp.boundaryClosed = obj.boundaryClosed || false;

    // Restore layer visibility settings
    fp.layers = obj.layers || {
      Plan_Boundary: true,
      Boundary_Area: true,
      Core_Boundary: true,
      Core_Area: true,
      Columns: true,
      Temperature_Regions: true,
      Beams: false,
      Points: false,
      Edges: false,
      Ducts: false,
      Duct_Plan: false
    };

    // Handle legacy vs new schema
    // Determine pxPerUnit from saved units (if present). If a saved plan
    // included a pxPerUnit, the coordinates in the JSON are in that unit and
    // must be converted back to pixels for in-memory representation.
    const savedPxPerUnit = obj.units?.pxPerUnit || null;

    // Reconstruct internal wall_graph. Prefer Points/Edges (duct_plan style),
    // then explicit wall_graph, then legacy coordinate arrays.
    if (obj.Points && obj.Points.length) {
      const pxPerUnit = savedPxPerUnit || 1;
      const nodes = obj.Points.map((p, i) => ({ id: p.id || `n_${i}`, x: (p.x || p[0] || 0) * pxPerUnit, y: (p.y || p[1] || 0) * pxPerUnit }));
      const edges = (obj.Edges || []).map((e, i) => ({ id: e.id || `e_${i}`, v1: e.v1, v2: e.v2, locked: !!e.locked }));
      fp.wall_graph = { nodes, edges };
    } else if (obj.wall_graph?.nodes?.length && typeof obj.wall_graph.nodes[0] === "object") {
      // New schema with wall_graph.nodes objects
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
      const nodes = (obj.wall_graph?.nodes || obj.vertices || []).map(([x, y], i) => ({ id: `n_${i}`, x, y }));
      const edges = (obj.wall_graph?.edges || obj.edges || []).map((seg, i) => ({ id: `e_${i}`, v1: `n_${nodes.findIndex(n => n.x === seg.v1[0] && n.y === seg.v1[1])}`, v2: `n_${nodes.findIndex(n => n.x === seg.v2[0] && n.y === seg.v2[1])}`, locked: seg.locked }));
      fp.wall_graph = { nodes, edges };
    }

    // Deduplicate / canonicalize nodes (merge nearby points). The caller
    // may provide `dedupeEpsilon` in the saved JSON to control the merge
    // tolerance. If epsilon === 0 we require exact equality.
  const DEDUPE_EPS = (typeof options.dedupeEpsilon === 'number') ? options.dedupeEpsilon : (typeof obj.dedupeEpsilon === 'number' ? obj.dedupeEpsilon : 0.0001);
    const epsSq = DEDUPE_EPS * DEDUPE_EPS;
    const oldNodes = fp.wall_graph.nodes || [];
    const canonical = [];
    const oldToNew = {}; // map old id -> canonical id

    const findCanonical = (x, y) => {
      for (let i = 0; i < canonical.length; i++) {
        const p = canonical[i];
        if (DEDUPE_EPS === 0) {
          if (p.x === x && p.y === y) return p;
        } else {
          const dx = p.x - x;
          const dy = p.y - y;
          if ((dx * dx + dy * dy) <= epsSq) return p;
        }
      }
      return null;
    };

    // Seed canonical list by iterating old nodes and merging as needed.
    oldNodes.forEach(n => {
      const x = n.x;
      const y = n.y;
      const found = findCanonical(x, y);
      if (found) {
        oldToNew[n.id] = found.id;
      } else {
        // preserve the original id where possible for readability
        const newId = n.id || fp._genId('n');
        const entry = { id: newId, x, y };
        canonical.push(entry);
        oldToNew[n.id] = newId;
      }
    });

    // Replace fp.Points and normalize wall_graph.nodes to canonical set
    fp.Points = canonical.map(p => ({ id: p.id, x: p.x, y: p.y }));
    fp.wall_graph.nodes = canonical.map(p => ({ id: p.id, x: p.x, y: p.y }));

    // Remap edges to canonical node ids. If an edge referenced coordinates
    // or an unknown id, attempt to resolve by nearest canonical point (or
    // create a new canonical point if necessary).
    const canonicalEdges = [];
    (fp.wall_graph.edges || []).forEach(e => {
      const resolveRef = (v) => {
        // string id
        if (typeof v === 'string') {
          if (oldToNew[v]) return oldToNew[v];
          // maybe it already matches a canonical id
          if (fp.Points.find(p => p.id === v)) return v;
          return null;
        }
        // array coords [x,y]
        if (Array.isArray(v) && v.length >= 2) {
          const [x, y] = v;
          const found = findCanonical(x, y);
          if (found) return found.id;
          // create new canonical point
          const nid = fp._genId('n');
          const entry = { id: nid, x, y };
          canonical.push(entry);
          fp.Points.push({ id: nid, x, y });
          fp.wall_graph.nodes.push({ id: nid, x, y });
          return nid;
        }
        // object with {x,y}
        if (v && typeof v.x === 'number' && typeof v.y === 'number') {
          const found = findCanonical(v.x, v.y);
          if (found) return found.id;
          const nid = fp._genId('n');
          const entry = { id: nid, x: v.x, y: v.y };
          canonical.push(entry);
          fp.Points.push({ id: nid, x: v.x, y: v.y });
          fp.wall_graph.nodes.push({ id: nid, x: v.x, y: v.y });
          return nid;
        }
        return null;
      };

      const v1 = resolveRef(e.v1);
      const v2 = resolveRef(e.v2);
      if (v1 && v2 && v1 !== v2) {
        canonicalEdges.push({ id: e.id || fp._genId('e'), v1, v2, locked: !!e.locked });
      }
    });
    fp.wall_graph.edges = canonicalEdges;

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
      const mapped = original.map(v => {
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
        color: a.color,
        alpha: typeof a.alpha === 'number' ? a.alpha : 0.3,
        vertices: mapped
      };
    })
    // Keep areas that have at least 3 vertices (coordinate or ids).
    .filter(a => a.vertices && a.vertices.length >= 3);

    // Migrate legacy areas into Temperature_Regions when loading older files.
    // If the saved JSON already contains Temperature_Regions prefer those,
    // otherwise convert the legacy `areas` array into the new structure so
    // the UI and renderers can immediately show regions.
    fp.Temperature_Regions = obj.Temperature_Regions || [];
    if ((!fp.Temperature_Regions || fp.Temperature_Regions.length === 0) && fp.areas && fp.areas.length) {
      fp.Temperature_Regions = fp.areas.map(a => {
        const subregion = {};
        (a.vertices || []).forEach((v, i) => {
          let coord = null;
          if (typeof v === 'string') {
            // try resolving node id -> coordinates
            const node = fp.wall_graph.nodes.find(n => n.id === v);
            if (node) coord = [node.x, node.y];
          } else if (Array.isArray(v) && v.length >= 2) {
            coord = [v[0], v[1]];
          } else if (v && typeof v.x === 'number' && typeof v.y === 'number') {
            coord = [v.x, v.y];
          }
          if (coord) subregion[`Pt_${i}`] = coord;
        });

        // ensure closed polygon by repeating the first point
        if ((a.vertices || []).length > 0) {
          const first = a.vertices[0];
          let firstCoord = null;
          if (typeof first === 'string') {
            const node = fp.wall_graph.nodes.find(n => n.id === first);
            if (node) firstCoord = [node.x, node.y];
          } else if (Array.isArray(first) && first.length >= 2) {
            firstCoord = [first[0], first[1]];
          } else if (first && typeof first.x === 'number' && typeof first.y === 'number') {
            firstCoord = [first.x, first.y];
          }
          if (firstCoord) subregion[`Pt_${(a.vertices || []).length}`] = firstCoord;
        }

        return {
          id: a.id || fp._genId('tr'),
          name: a.label || a.id || 'region',
          type: a.type || 'internal',
          color: a.color || null,
          alpha: typeof a.alpha === 'number' ? a.alpha : 0.3,
          air_requirement: a.air_requirement || 7.5,
          subregions: [subregion]
        };
      });
    }

    // Normalize Plan_Boundary polygons and Temperature_Regions subregion
    // coordinates to the canonical points produced above. This removes
    // duplicate coordinates and ensures visual consistency.
    const pxConv = savedPxPerUnit || 1;
    // Normalize Plan_Boundary (Pt_* keyed objects)
    fp.Plan_Boundary = (fp.Plan_Boundary || []).map(polyObj => {
      const keys = Object.keys(polyObj).sort((a, b) => {
        const ai = parseInt(a.split('_')[1] || '0', 10);
        const bi = parseInt(b.split('_')[1] || '0', 10);
        return ai - bi;
      });
      const coords = keys.map(k => polyObj[k]).filter(Boolean).map(v => [ (v[0] || 0) * pxConv, (v[1] || 0) * pxConv ]);
      const out = {};
      coords.forEach((c, i) => {
        const found = findCanonical(c[0], c[1]);
        const use = found ? [found.x, found.y, (c[2] || 0)] : [c[0], c[1], (c[2] || 0)];
        out[`Pt_${i}`] = use;
      });
      // ensure closed: repeat first point once at end
      if (coords.length > 0) {
        const first = coords[0];
        const found = findCanonical(first[0], first[1]);
        const use = found ? [found.x, found.y, (first[2] || 0)] : [first[0], first[1], (first[2] || 0)];
        out[`Pt_${coords.length}`] = use;
      }
      return out;
    });

    // Normalize Temperature_Regions subregions coordinates
    (fp.Temperature_Regions || []).forEach(region => {
      region.subregions = (region.subregions || []).map(sub => {
        // if sub is Pt_* keyed object
        const keys = Object.keys(sub || {}).sort((a, b) => {
          const ai = parseInt(a.split('_')[1] || '0', 10);
          const bi = parseInt(b.split('_')[1] || '0', 10);
          return ai - bi;
        });
        const coords = keys.map(k => sub[k]).filter(Boolean).map(v => [v[0], v[1]]);
        const out = {};
        coords.forEach((c, i) => {
          const found = findCanonical(c[0], c[1]);
          const use = found ? [found.x, found.y] : [c[0], c[1]];
          out[`Pt_${i}`] = use;
        });
        if (coords.length > 0) {
          const first = coords[0];
          const found = findCanonical(first[0], first[1]);
          const use = found ? [found.x, found.y] : [first[0], first[1]];
          out[`Pt_${coords.length}`] = use;
        }
        return out;
      });
    });

    // If no explicit boundaryArea was provided, and we have a Plan_Boundary
    // convert the first Plan_Boundary polygon into a boundaryArea so the
    // existing renderer (which draws boundaryArea) can display it directly.
    if (!fp.boundaryArea && fp.Plan_Boundary && fp.Plan_Boundary.length > 0) {
      const poly = fp.Plan_Boundary[0] || {};
      const keys = Object.keys(poly).sort((a, b) => {
        const ai = parseInt(a.split('_')[1] || '0', 10);
        const bi = parseInt(b.split('_')[1] || '0', 10);
        return ai - bi;
      });
      const verts = keys.map(k => poly[k]).filter(Boolean).map(v => {
        const x = v[0]; const y = v[1];
        const found = findCanonical(x, y);
        return found ? found.id : [x, y];
      }).filter(Boolean);
      if (verts.length) {
        fp.boundaryArea = { id: fp.boundaryArea?.id || 'boundary_0', label: 'boundary', vertices: verts };
      }
    }

      // Canonicalize Columns: convert Pt_* keyed footprint objects into
      // { id, vertices: [pointId,...] } where vertices reference canonical
      // point ids. This reduces duplicate coordinates and enables reuse.
      fp.Columns = (fp.Columns || []).map((col, ci) => {
        // if already in canonical form (has vertices array), keep
        if (Array.isArray(col.vertices) && col.vertices.length) {
          return { id: col.id || `col_${ci}`, vertices: col.vertices };
        }
        // otherwise assume Pt_* keyed object
        const keys = Object.keys(col || {}).sort((a, b) => {
          const ai = parseInt(a.split('_')[1] || '0', 10);
          const bi = parseInt(b.split('_')[1] || '0', 10);
          return ai - bi;
        });
        const verts = keys.map(k => col[k]).filter(Boolean).map(v => [v[0], v[1]]);
        const vertexIds = verts.map(c => {
          const found = findCanonical(c[0], c[1]);
          if (found) return found.id;
          // create new canonical point
          const nid = fp._genId('n');
          const entry = { id: nid, x: c[0], y: c[1] };
          canonical.push(entry);
          fp.Points.push({ id: nid, x: c[0], y: c[1] });
          fp.wall_graph.nodes.push({ id: nid, x: c[0], y: c[1] });
          return nid;
        }).filter(Boolean);
        return { id: col.id || `col_${ci}`, vertices: vertexIds };
      });

      // Canonicalize Beams: convert Pt_0/Pt_1 keyed objects into
      // { id, p0: pointId, p1: pointId, height }
      fp.Beams = (fp.Beams || []).map((b, bi) => {
        if (b.p0 && b.p1) return { id: b.id || `beam_${bi}`, p0: b.p0, p1: b.p1, height: b.height || b.h || 0 };
        const p0 = b.Pt_0 || b.Pt0 || null;
        const p1 = b.Pt_1 || b.Pt1 || null;
        const toId = (pt) => {
          if (!pt) return null;
          const x = pt[0];
          const y = pt[1];
          const found = findCanonical(x, y);
          if (found) return found.id;
          const nid = fp._genId('n');
          const entry = { id: nid, x, y };
          canonical.push(entry);
          fp.Points.push({ id: nid, x, y });
          fp.wall_graph.nodes.push({ id: nid, x, y });
          return nid;
        };
        const id0 = toId(p0);
        const id1 = toId(p1);
        return { id: b.id || `beam_${bi}`, p0: id0, p1: id1, height: b.Pt_0 && b.Pt_0[2] ? b.Pt_0[2] : (b.height || 0) };
      });

    // Load explicit boundaryArea if present (converted from saved units -> pixels)
    if (obj.boundaryArea && Array.isArray(obj.boundaryArea.vertices)) {
      const pxPerUnit = savedPxPerUnit || 1;
      const mapped = (obj.boundaryArea.vertices || []).map(v => {
        if (Array.isArray(v) && v.length >= 2) return [v[0] * pxPerUnit, v[1] * pxPerUnit];
        return null;
      }).filter(v => v !== null);
      // Try to map back to node ids when possible, otherwise keep coords
      const vertices = mapped.map(([x, y]) => {
        const found = fp.wall_graph.nodes.find(n => Math.abs(n.x - x) < 0.0001 && Math.abs(n.y - y) < 0.0001);
        return found ? found.id : [x, y];
      });
      fp.boundaryArea = { id: obj.boundaryArea.id || 'boundary_0', label: 'boundary', vertices };
    }

    fp.requirements = obj.requirements || { bathrooms: 1 };
  // Ensure missing keys fall back to defaults (backwards compatible).
  if (typeof fp.requirements.bathrooms !== 'number') fp.requirements.bathrooms = 1;
    // If the saved plan indicated a closed boundary but did not include
    // an explicit boundary area, create one so the boundary surface is
    // available as an area for measurement and UI listing.
    if (fp.boundaryClosed && !fp.boundaryArea) {
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

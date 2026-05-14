/**
export class FloorPlan {
  constructor(name = Date.now()) {
    this.name = name;
    
    // Reference schema structure
    this.Plan_Boundary = []; // Array of polygon objects with Pt_0, Pt_1, etc.
    this.Core_Boundary = []; // Array of core polygon objects
    this.Columns = []; // Array of column footprint polygons
    this.Thermal_Zones = []; // Canonical thermal zone collection
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
      Thermal_Zones: true,
      Beams: false,
      Points: false,
      Edges: false,
      Ducts: false,
      Duct_Plan: false
    };
    
    // Legacy compatibility - keep for gradual migration
    this.wall_graph = { nodes: [], edges: [] };
    this.areas = [];
    this.entrances = []; // Will be integrated with Points/entry_candidates
    
    // UI state
    this.boundaryClosed = false;
    this.selectedSegment = null;
    this.selectedPoints = new Set();  // Set of point ids
    this.selectedCore = false;
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

  // Close boundary - NOTE: This is a legacy method. The newer implementation is further down.
  // Keeping for backwards compatibility but calling the newer _updateBoundaryArea method.
  closeBoundary() {
    if (this.wall_graph.nodes.length >= 3) {
      // this.wall_graph.edges.push([this.wall_graph.nodes.length - 1, 0]);
      this.wall_graph.edges.push({
        v1: this.wall_graph.nodes[this.wall_graph.nodes.length - 1],
        v2: this.wall_graph.nodes[0],
        locked: false
      });
      this.boundaryClosed = true;
      // Create boundaryArea so grid generation works
      this._updateBoundaryArea();
      // console.log("Boundary closed");
    }
  }

  _updateBoundaryArea() {
    // Build an ordered list of node coordinates describing the boundary polygon
    if (!this.boundaryClosed) return;
    
    // Handle both legacy array format [x,y] and new object format {id, x, y}
    const vertices = this.wall_graph.nodes.map(n => {
      if (Array.isArray(n)) return [n[0], n[1]];
      if (n.id) return n.id; // Use ID if available
      return [n.x, n.y];
    });

    // Ensure there are at least 3 nodes
    if (vertices.length < 3) return;
    
    // Store boundary as a special boundaryArea object
    if (!this.boundaryArea) {
      const id = this._genId ? this._genId('a') : 'boundary_0';
      this.boundaryArea = { id, label: 'boundary', vertices };
      return id;
    }
    this.boundaryArea.vertices = vertices;
    return this.boundaryArea.id;
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
    this.selectedPoint = null;
    this.selectedPoints = new Set();
    this.selectedCore = false;
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
      // Map frontend property Thermal_Zones back to backend key thermal_zones,
      // and map frontend property subZones back to backend key thermal_region_geometry
      thermal_zones: this.Thermal_Zones.map(tz => ({
        ...tz,
        thermal_region_geometry: tz.subZones || [],
        vav_control_zones: tz.thermalControlZones || []
      })),
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
    // Map backend key thermal_zones to frontend property Thermal_Zones,
    // and rename backend key thermal_region_geometry to frontend property subZones
    fp.Thermal_Zones = (obj.thermal_zones || []).map(({ thermal_region_geometry, vav_control_zones, ...tz }) => ({
      ...tz,
      subZones: thermal_region_geometry || [],
      thermalControlZones: vav_control_zones || []
    }));
    fp.Beams = obj.Beams || [];
    fp.Points = obj.Points || [];
    fp.Edges = obj.Edges || [];
    fp.Ducts = obj.Ducts || [];
    fp.Duct_Plan = obj.Duct_Plan || [];
    fp.layers = obj.layers || {
      Plan_Boundary: true,
      Core_Boundary: true,
      Columns: true,
      Thermal_Zones: true,
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
import {
  makeNode, makeEdge,
  makeWall, makeWallOpening,
  makeCore, makeOpening,
  makeColumn, makeBeam,
  makeThermalZone, makeCeilingZone,
  makeTerminal, makeEquipment,
  makeGridPoint, makeGridEdge, makeDuctSpec, makeDuctSegment
} from './elements.js';

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
    this.entrances = [];   // [{ id, position: {x,y}, edgeRef, width }]  (legacy – prefer openings)
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
    this.Thermal_Zones = [];
    this.Exclusion_Areas = [];  // [{id, vertices:[[x,y],...]}] – column-free zones
    this.Beams = [];
    this.Walls = [];  // makeWall – primary wall primitives (boundary/core/partition)

    // ─── new structured element collections ──────────────────────────────
    // All items are typed plain objects produced by factory functions in
    // elements.js.  Each has a `kind` discriminator field.

    // geometry
    this.openings   = [];  // makeOpening  – entrance | door | window
    this.partitions = { nodes: [], edges: [], closed: false }; // internal walls

    // spaces
    this.ceilingZones = [];  // makeCeilingZone – plenum / suspended-ceiling areas

    // hvac (schema-defined; no drawing tool yet)
    this.terminals  = [];  // makeTerminal  – supply / return / exhaust points
    this.equipment  = [];  // makeEquipment – FCU / AHU / VAV boxes
    // Layer visibility defaults
    this.layers = {
      Plan_Boundary: true,
      Boundary_Area: true,
      Core_Boundary: true,
      Core_Area: true,
      Columns: true,
      Thermal_Zones: true,
      Exclusion_Areas: true,
      Beams: false,
      Walls: true,
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
    this.selectedCore = false;
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
    // vertex to the nearest 45° increment relative to the previous node.
    if (constrain && this.wall_graph.nodes.length > 0) {
      const last = this.wall_graph.nodes[this.wall_graph.nodes.length - 1];
      const dx = x - last.x;
      const dy = y - last.y;
      const r = Math.hypot(dx, dy);
      if (r > 0) {
        const angle = Math.atan2(dy, dx);
        const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        x = last.x + r * Math.cos(snapAngle);
        y = last.y + r * Math.sin(snapAngle);
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
    const opening = makeOpening(id, {
      openingKind: 'entrance',
      edgeId,
      position: { x, y },
      width
    });
    this.openings.push(opening);
    // keep backward-compat entrances array in sync
    this.entrances.push({ id, position: { x, y }, edgeRef: edgeId, width });
    return id;
  }

  /**
   * Add any type of wall opening (entrance / door / window).
   * Stores in the canonical `openings` array only.
   * @param {string} edgeId
   * @param {number} x
   * @param {number} y
   * @param {object} props – any makeOpening props (openingKind, width, height, …)
   */
  addOpening(edgeId, x, y, props = {}) {
    const id = this._genId('op');
    const opening = makeOpening(id, { edgeId, position: { x, y }, ...props });
    this.openings.push(opening);
    if (!props.openingKind || props.openingKind === 'entrance') {
      this.entrances.push({ id, position: { x, y }, edgeRef: edgeId, width: props.width || 900 });
    }
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
    const id = this._genId('core');
    const pts = (vertices || []).map(v =>
      Array.isArray(v) ? { x: v[0], y: v[1] } : { x: v.x, y: v.y }
    );
    const core = makeCore(id, { vertices: pts });
    // Also keep the legacy Pt_* keyed format in Core_Boundary for the renderer
    const boundaryPoints = {};
    pts.forEach((p, i) => { boundaryPoints[`Pt_${i}`] = [p.x, p.y]; });
    if (pts.length > 0) boundaryPoints[`Pt_${pts.length}`] = [pts[0].x, pts[0].y]; // close
    this.Core_Boundary.push(boundaryPoints);
    return this.Core_Boundary.length - 1;
  }

  /** Add a column with a polygon footprint. vertices: [[x,y], …] or [{x,y}, …] */
  addColumn(vertices, props = {}) {
    const id = this._genId('col');
    const pts = (vertices || []).map(v =>
      Array.isArray(v) ? { x: v[0], y: v[1] } : { x: v.x, y: v.y }
    );
    const col = makeColumn(id, { vertices: pts, ...props });
    this.Columns.push(col);
    return id;
  }

  /** Add a beam between two points. start/end: [x,y] or {x,y} */
  addBeam(start, end, props = {}) {
    const id = this._genId('bm');
    const s = Array.isArray(start) ? { x: start[0], y: start[1] } : start;
    const e = Array.isArray(end)   ? { x: end[0],   y: end[1]   } : end;
    const beam = makeBeam(id, { start: s, end: e, ...props });
    this.Beams.push(beam);
    return id;
  }

  /**
   * Add a thermal zone / temperature region.
   * vertices: [[x,y], …] or [{x,y}, …]
   * properties: { color, alpha, airRequirement, numberOfRisers, vavNumber, … }
   */
  addThermalZone(name, type, vertices, properties = {}) {
    const id = this._genId('tr');
    const subZone = (vertices || []).map((v) => {
      if (Array.isArray(v)) return { x: v[0], y: v[1] };
      return { x: v.x, y: v.y };
    });
    const zone = makeThermalZone(id, {
      name: name || '',
      zoneType: type || 'internal',
      subZones: [subZone],
      airRequirement:   properties.air_requirement   ?? properties.airRequirement   ?? 7.5,
      numberOfRisers:   properties.number_of_risers  ?? properties.numberOfRisers   ?? 1,
      vavNumber:        properties.VAV_number         ?? properties.vavNumber         ?? 1,
      avgLoadPerPoint:  properties.avg_load_per_point ?? properties.avgLoadPerPoint  ?? 0,
      totalLoad:        properties.total_load         ?? properties.totalLoad         ?? 0,
      totalArea:        properties.total_area         ?? properties.totalArea         ?? 0,
      entryCandidates:  properties.entry_candidates   ?? properties.entryCandidates  ?? [[]],
      thermalControlZones: properties.vav_control_zones ?? properties.thermalControlZones ?? [],
      color: properties.color ?? null,
      alpha: typeof properties.alpha === 'number' ? properties.alpha : 0.3
    });
    this.Thermal_Zones.push(zone);
    return id;
  }

  // ─── partition (internal wall) drawing ───────────────────────────────────

  /**
   * Add a vertex to the in-progress partition wall graph.
   * Works the same as addVertex() but operates on this.partitions.
   */
  addPartitionVertex(x, y, { constrain = false } = {}) {
    if (constrain && this.partitions.nodes.length > 0) {
      const last = this.partitions.nodes.at(-1);
      const dx = x - last.x, dy = y - last.y;
      const r = Math.hypot(dx, dy);
      if (r > 0) {
        const angle    = Math.atan2(dy, dx);
        const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        x = last.x + r * Math.cos(snapAngle);
        y = last.y + r * Math.sin(snapAngle);
      }
    }
    const id = this._genId('pn');
    this.partitions.nodes.push(makeNode(id, x, y));
    const nodes = this.partitions.nodes;
    if (nodes.length > 1) {
      const prevId = nodes[nodes.length - 2].id;
      const eid = this._genId('pe');
      this.partitions.edges.push(makeEdge(eid, prevId, id, false));
    }
    return id;
  }

  /** Close the current partition polygon (optional – partitions can be open lines). */
  closePartition() {
    const nodes = this.partitions.nodes;
    if (nodes.length >= 3) {
      const eid = this._genId('pe');
      this.partitions.edges.push(makeEdge(eid, nodes.at(-1).id, nodes[0].id, false));
      this.partitions.closed = true;
    }
  }

  // ─── new space and hvac elements ─────────────────────────────────────────

  /** Add a ceiling zone polygon. vertices: [[x,y],…] or [{x,y},…] */
  addCeilingZone(vertices, props = {}) {
    const id = this._genId('cz');
    const pts = (vertices || []).map(v =>
      Array.isArray(v) ? { x: v[0], y: v[1] } : { x: v.x, y: v.y }
    );
    const zone = makeCeilingZone(id, { vertices: pts, ...props });
    this.ceilingZones.push(zone);
    return id;
  }

  /** Place an air terminal (diffuser / grille / exhaust) at a canvas position. */
  addTerminal(x, y, props = {}) {
    const id = this._genId('tm');
    const terminal = makeTerminal(id, { position: { x, y }, ...props });
    this.terminals.push(terminal);
    return id;
  }

  /** Place a mechanical equipment item (FCU / AHU / VAV …) at a canvas position. */
  addEquipment(x, y, props = {}) {
    const id = this._genId('eq');
    const equip = makeEquipment(id, { position: { x, y }, ...props });
    this.equipment.push(equip);
    return id;
  }

  // ─── Wall CRUD ─────────────────────────────────────────────────────────

  /**
   * Create a wall segment and add it to this.Walls.
   * Also adds a matching edge to wall_graph for renderer back-compat.
   *
   * @param {{x:number,y:number}|[number,number]} start  – canvas pixels
   * @param {{x:number,y:number}|[number,number]} end    – canvas pixels
   * @param {Object} [props]
   * @param {'boundary'|'core'|'partition'} [props.wallType]
   * @param {boolean} [props.translucent]
   * @param {boolean} [props.locked]
   * @returns {string} wall id
   */
  addWall(start, end, props = {}) {
    const s = Array.isArray(start) ? { x: start[0], y: start[1] } : { ...start };
    const e = Array.isArray(end)   ? { x: end[0],   y: end[1]   } : { ...end };
    const id = this._genId('w');
    const wall = makeWall(id, { start: s, end: e, ...props });
    this.Walls.push(wall);
    return id;
  }

  /**
   * Remove a wall by id, also removing any openings that belong to it.
   * @param {string} wallId
   */
  removeWall(wallId) {
    const idx = this.Walls.findIndex(w => w.id === wallId);
    if (idx >= 0) this.Walls.splice(idx, 1);
  }

  /**
   * Add an opening (door / window / entrance) to a wall.
   * The opening is inserted into wall.openings[] sorted by ascending t.
   *
   * @param {string} wallId           – target wall id
   * @param {number} t                – parametric position along wall (0–1)
   * @param {Object} [props]          – any makeWallOpening props
   * @param {'entrance'|'door'|'window'} [props.openingKind]
   * @param {number}  [props.width]
   * @param {number}  [props.height]
   * @param {number}  [props.sillHeight]
   * @returns {string|null} opening id, or null if wall not found
   */
  addOpeningToWall(wallId, t, props = {}) {
    const wall = this.Walls.find(w => w.id === wallId);
    if (!wall) return null;
    const id = this._genId('wo');
    const opening = makeWallOpening(id, { t: Math.max(0, Math.min(1, t)), ...props });
    wall.openings.push(opening);
    wall.openings.sort((a, b) => a.t - b.t);
    return id;
  }

  /**
   * Remove an opening from a wall.
   * @param {string} wallId
   * @param {string} openingId
   */
  removeOpeningFromWall(wallId, openingId) {
    const wall = this.Walls.find(w => w.id === wallId);
    if (!wall) return;
    const idx = wall.openings.findIndex(o => o.id === openingId);
    if (idx >= 0) wall.openings.splice(idx, 1);
  }

  removeArea(areaId) {
    const idx = this.areas.findIndex(a => a.id === areaId);
    if (idx >= 0) this.areas.splice(idx, 1);
  }

  // Generate a regular grid of points inside the boundary
  // spacing and buffer are provided in millimeters
  generateGrid(spacing, origin) {
    console.log('=== generateGrid called ===');

    // Convert spacing from mm to pixels based on current units
    const unitLabel = this.units?.length || 'mm';
    const pxPerUnit = this.units?.pxPerUnit || 1;
    const mmToUnit = (mm) => {
      switch (unitLabel) {
        case 'mm': return mm;
        case 'cm': return mm / 10;
        case 'm':  return mm / 1000;
        case 'in': return mm / 25.4;
        case 'ft': return mm / 304.8;
        default:   return mm;
      }
    };
    const spacingPx = mmToUnit(spacing) * pxPerUnit;

    // Ensure boundary is closed
    if (!this.boundaryClosed && this.wall_graph.nodes.length >= 3) {
      const firstId = this.wall_graph.nodes[0]?.id;
      const lastId  = this.wall_graph.nodes.at(-1)?.id;
      if (firstId && lastId) {
        const hasClosingEdge = (this.wall_graph.edges || []).some(e =>
          (e.v1 === lastId && e.v2 === firstId) || (e.v1 === firstId && e.v2 === lastId)
        );
        if (hasClosingEdge) {
          this.boundaryClosed = true;
          this._updateBoundaryArea();
        }
      }
    }

    if (!this.boundaryClosed || !this.boundaryArea?.vertices) {
      console.error('Grid generation failed — boundary not closed');
      return;
    }

    // Resolve boundary polygon as [[x,y], …]
    const boundaryPoly = this.boundaryArea.vertices.map(v => {
      if (typeof v === 'string') {
        const n = this.wall_graph.nodes.find(nd => nd.id === v);
        return n ? [n.x, n.y] : null;
      }
      if (Array.isArray(v)) return [v[0], v[1]];
      return null;
    }).filter(Boolean);

    if (boundaryPoly.length < 3) {
      console.warn('Boundary has insufficient vertices');
      return;
    }

    // Resolve core exclusion polygons
    const corePolys = (this.Core_Boundary || []).map(core => {
      const pts = Object.values(core);
      // Drop the auto-repeated closing point (same as first)
      const unique = pts.filter((p, i) => i === 0 || p[0] !== pts[0][0] || p[1] !== pts[0][1]);
      return unique.map(p => [p[0], p[1]]);
    }).filter(poly => poly.length >= 3);

    // Bounding box of boundary
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    boundaryPoly.forEach(([x, y]) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });

    // Start grid from origin, extend to cover entire bounding box
    const ox = origin.x, oy = origin.y;
    // Walk left/up from origin to find first grid line before minX/minY
    const startX = ox - Math.ceil((ox - minX) / spacingPx) * spacingPx;
    const startY = oy - Math.ceil((oy - minY) / spacingPx) * spacingPx;

    // 3 m proximity threshold — points within this distance of any core edge get column:false
    const coreProximityPx = mmToUnit(3000) * pxPerUnit;

    const gridPoints = [];
    for (let x = startX; x <= maxX + spacingPx * 0.5; x += spacingPx) {
      for (let y = startY; y <= maxY + spacingPx * 0.5; y += spacingPx) {
        // Must be inside (or on) boundary
        if (!this._isPointInPolygon(x, y, boundaryPoly) &&
            !this._isPointOnPolygonEdge(x, y, boundaryPoly)) continue;
        // Must not be strictly inside any core (edge points are allowed)
        const inCore = corePolys.some(poly =>
          this._isPointInPolygon(x, y, poly) && !this._isPointOnPolygonEdge(x, y, poly));
        if (inCore) continue;
        // column:false if within 3m (in px) of any core polygon edge
        const nearCore = corePolys.length > 0 &&
          corePolys.some(poly => this._distToPolygon(x, y, poly) < coreProximityPx);
        // column:false if inside any exclusion area
        const inExclusion = (this.Exclusion_Areas || []).some(ea =>
          this._isPointInPolygon(x, y, ea.vertices));
        const id = this._genId('gp');
        gridPoints.push({ id, x, y, column: !nearCore && !inExclusion, mechanical: true, entryPoint: false });
      }
    }

    this.Points = gridPoints;
    console.log(`Generated ${gridPoints.length} grid points from origin (${ox.toFixed(1)}, ${oy.toFixed(1)})`);
    return gridPoints;
  }

  // Minimum distance from point (px,py) to the nearest edge of a closed polygon
  _distToPolygon(px, py, polygon) {
    let minDist = Infinity;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [ax, ay] = polygon[j];
      const [bx, by] = polygon[i];
      const dx = bx - ax, dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx, cy = ay + t * dy;
      const d = Math.hypot(px - cx, py - cy);
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  // Returns true when (x,y) lies on any edge of the closed polygon (within 1px tolerance)
  _isPointOnPolygonEdge(x, y, polygon, tol = 1) {
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [x1, y1] = polygon[j];
      const [x2, y2] = polygon[i];
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
      const dist = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
      if (dist <= tol) return true;
    }
    return false;
  }

  // Point-in-polygon test using ray casting algorithm
  _isPointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];
      
      const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  clearGrid() {
    this.Points = [];
    console.log('Grid cleared');
  }

  /**
   * Split the edge at segmentIndex by inserting a new vertex at the point
   * on the edge closest to (x, y).  The original edge A→B is replaced by
   * two edges A→C and C→B.  Returns the new node id, or null if the split
   * was rejected (e.g. click too close to an existing endpoint).
   */
  splitEdge(segmentIndex, x, y) {
    const edge = this.wall_graph.edges[segmentIndex];
    if (!edge) return null;

    const n1 = this.wall_graph.nodes.find(n => n.id === edge.v1);
    const n2 = this.wall_graph.nodes.find(n => n.id === edge.v2);
    if (!n1 || !n2) return null;

    // Project (x,y) onto the segment ─ reuse the projection formula inline
    const dx = n2.x - n1.x, dy = n2.y - n1.y;
    const lenSq = dx * dx + dy * dy || 1;
    let t = ((x - n1.x) * dx + (y - n1.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = n1.x + t * dx, cy = n1.y + t * dy;

    // Reject if the projected point is too close to an existing endpoint
    const MIN_DIST = 8;
    if (Math.hypot(cx - n1.x, cy - n1.y) < MIN_DIST) return null;
    if (Math.hypot(cx - n2.x, cy - n2.y) < MIN_DIST) return null;

    // Create the new node C
    const cId = this.addNode(cx, cy);
    const cNode = this.wall_graph.nodes.find(n => n.id === cId);

    // Find the matching Wall object to copy its type/style
    const EPS = 1;
    const oldWall = (this.Walls || []).find(w =>
      Math.abs(w.start.x - n1.x) < EPS && Math.abs(w.start.y - n1.y) < EPS &&
      Math.abs(w.end.x   - n2.x) < EPS && Math.abs(w.end.y   - n2.y) < EPS);
    const wallProps = oldWall
      ? { wallType: oldWall.wallType, translucent: oldWall.translucent, locked: oldWall.locked }
      : {};

    // Remove the original edge and replace with two new ones
    this.wall_graph.edges.splice(segmentIndex, 1);
    const locked = edge.locked || false;
    const eid1 = this.addEdge(edge.v1, cId, locked);
    const eid2 = this.addEdge(cId,     edge.v2, locked);

    // Propagate wallType stored directly on the edge object
    if (edge.wallType) {
      const e1 = this.wall_graph.edges.find(e => e.id === eid1);
      const e2 = this.wall_graph.edges.find(e => e.id === eid2);
      if (e1) e1.wallType = edge.wallType;
      if (e2) e2.wallType = edge.wallType;
    }

    // Replace the Wall entry with two new ones inheriting the same properties
    if (oldWall) {
      const oi = this.Walls.indexOf(oldWall);
      this.Walls.splice(oi, 1);
      this.addWall(n1, cNode, wallProps);
      this.addWall(cNode, n2, wallProps);
    }

    this.clearSelection();
    return cId;
  }

  deleteCore() {
    // Remove all core-type edges from the wall graph
    const coreEdgeIds = new Set(
      (this.wall_graph.edges || [])
        .filter(e => e.wallType === 'core')
        .map(e => e.id)
    );
    this.wall_graph.edges = (this.wall_graph.edges || []).filter(e => !coreEdgeIds.has(e.id));

    // Remove nodes no longer referenced by any remaining edge
    const usedNodeIds = new Set(
      (this.wall_graph.edges || []).flatMap(e => [e.v1, e.v2])
    );
    this.wall_graph.nodes = (this.wall_graph.nodes || []).filter(n => usedNodeIds.has(n.id));

    // Remove core Wall objects and clear legacy Core_Boundary
    this.Walls = (this.Walls || []).filter(w => w.wallType !== 'core');
    this.Core_Boundary = [];

    this.clearSelection();
  }

  clearSelection() {
    this.selectedSegment = null;
    this.selectedPoint = null;
    this.selectedPoints = new Set();
    this.selectedCore = false;
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
    
    // Copy boundaryArea if it exists
    if (this.boundaryArea) {
      fp.boundaryArea = {
        id: this.boundaryArea.id,
        label: this.boundaryArea.label,
        vertices: [...this.boundaryArea.vertices]
      };
    }
    
    // Copy reference schema arrays
    fp.Plan_Boundary = this.Plan_Boundary ? [...this.Plan_Boundary] : [];
    fp.Core_Boundary = this.Core_Boundary ? [...this.Core_Boundary] : [];
    fp.Columns = this.Columns ? this.Columns.map(c => ({ ...c, vertices: c.vertices ? [...c.vertices] : [] })) : [];
    fp.Points = this.Points ? this.Points.map(p => ({ ...p })) : [];
    fp.Edges = this.Edges ? [...this.Edges] : [];
    fp.Ducts = this.Ducts ? [...this.Ducts] : [];
    fp.Duct_Plan = this.Duct_Plan ? [...this.Duct_Plan] : [];
    fp.Thermal_Zones = this.Thermal_Zones ? this.Thermal_Zones.map(tr => ({
      ...tr,
      subZones: tr.subZones ? tr.subZones.map(sz => (sz || []).map(p => ({ ...p }))) : [],
      entry_candidates: tr.entry_candidates ? tr.entry_candidates.map(ec => [...ec]) : [[]],
      vav_control_zones: tr.thermalControlZones ? [...tr.thermalControlZones] : [],
      // Map frontend property subZones back to backend key thermal_region_geometry for JSON output
      thermal_region_geometry: tr.subZones || []
    })) : [];
    fp.Exclusion_Areas = (this.Exclusion_Areas || []).map(ea => ({ ...ea, vertices: ea.vertices.map(v => [...v]) }));
    fp.Beams = (this.Beams || []).map(b => ({ ...b, start: b.start ? { ...b.start } : { x: 0, y: 0 }, end: b.end ? { ...b.end } : { x: 0, y: 0 } }));
    fp.Walls = (this.Walls || []).map(w => ({
      ...w,
      start:    { ...w.start },
      end:      { ...w.end },
      openings: (w.openings || []).map(o => ({ ...o }))
    }));

    // Copy new structured element collections
    fp.openings    = (this.openings    || []).map(o => ({ ...o, position: { ...o.position } }));
    fp.partitions  = {
      nodes:  (this.partitions?.nodes  || []).map(n => ({ ...n })),
      edges:  (this.partitions?.edges  || []).map(e => ({ ...e })),
      closed: this.partitions?.closed || false
    };
    fp.ceilingZones = (this.ceilingZones || []).map(z => ({ ...z, vertices: (z.vertices || []).map(v => ({ ...v })) }));
    fp.terminals    = (this.terminals    || []).map(t => ({ ...t, position: { ...t.position } }));
    fp.equipment    = (this.equipment    || []).map(e => ({ ...e, position: { ...e.position } }));
    
    // Copy layer visibility settings
    if (this.layers) {
      fp.layers = { ...this.layers };
    }
    
    // Preserve the internal id counter so cloned/restored instances continue
    // generating unique ids and avoid collisions after undo/redo.
    fp._idCounter = this._idCounter;
    return fp;
  }

  toJSON() {
    const pxPerUnit = this.units?.pxPerUnit || 1;
    const snap = v => { const r = Math.round(v); return Math.abs(v - r) < 0.001 ? r : v; };
    const u = v => snap(v / pxPerUnit);

    // ── boundary edges ────────────────────────────────────────────────────
    const nodeMap = Object.fromEntries((this.wall_graph.nodes || []).map(n => [n.id, n]));
    // Build a coord-keyed lookup into Walls for translucent + openings
    const wallByCoords = new Map();
    for (const w of (this.Walls || [])) {
      const key = `${w.start.x.toFixed(4)},${w.start.y.toFixed(4)},${w.end.x.toFixed(4)},${w.end.y.toFixed(4)}`;
      wallByCoords.set(key, w);
    }

    const serializeOpenings = (openings) => (openings || []).map(o => ({
      id: o.id,
      type: o.openingKind || o.type || 'door',
      placement: o.t ?? o.placement ?? 0.5,
      width: o.width,
      ...(o.height !== undefined && { height: o.height }),
      ...(o.sillHeight !== undefined && o.sillHeight !== 0 && { sill_height: o.sillHeight })
    }));

    const boundaryEdges = (this.wall_graph.edges || [])
      .filter(e => !e.wallType || e.wallType === 'boundary')
      .map(e => {
        const n1 = nodeMap[e.v1], n2 = nodeMap[e.v2];
        if (!n1 || !n2) return null;
        const key = `${n1.x.toFixed(4)},${n1.y.toFixed(4)},${n2.x.toFixed(4)},${n2.y.toFixed(4)}`;
        const wall = wallByCoords.get(key);
        return {
          id: e.id,
          start: { x: u(n1.x), y: u(n1.y) },
          end:   { x: u(n2.x), y: u(n2.y) },
          type: 'boundary',
          translucent: wall?.translucent ?? false,
          locked: !!e.locked,
          openings: serializeOpenings(wall?.openings)
        };
      }).filter(Boolean);

    // ── core edges ────────────────────────────────────────────────────────
    // From Walls with wallType === 'core'; skip degenerate zero-length walls
    const coreEdges = (this.Walls || [])
      .filter(w => w.wallType === 'core' && (w.start.x !== w.end.x || w.start.y !== w.end.y))
      .map(w => ({
        id: w.id,
        start: { x: u(w.start.x), y: u(w.start.y) },
        end:   { x: u(w.end.x),   y: u(w.end.y) },
        type: 'core',
        translucent: w.translucent ?? false,
        locked: !!w.locked,
        openings: serializeOpenings(w.openings)
      }));

    // ── grid points ───────────────────────────────────────────────────────
    const gridPoints = (this.Points || []).map(p => ({
      id: p.id, x: u(p.x), y: u(p.y), column: p.column ?? true, mechanical: p.mechanical ?? true, entryPoint: p.entryPoint ?? false
    }));

    // ── exclusion areas ───────────────────────────────────────────────────
    const exclusionAreas = (this.Exclusion_Areas || []).map(ea => ({
      id: ea.id,
      vertices: (ea.vertices || []).map(([x, y]) => [u(x), u(y)])
    }));

    // ── columns ───────────────────────────────────────────────────────────
    const columns = (this.Columns || []).map(col => {
      let x = col.x, y = col.y;
      if ((x === undefined || y === undefined) && col.vertices?.length) {
        const n = typeof col.vertices[0] === 'string'
          ? (this.wall_graph.nodes || []).find(nd => nd.id === col.vertices[0])
          : null;
        if (n) { x = n.x; y = n.y; }
      }
      if (x === undefined || y === undefined) return null;
      return {
        id: col.id,
        x: u(x), y: u(y),
        section_type: col.section_type,
        material: col.material,
        width: col.width,
        depth: col.depth,
        height: col.height
      };
    }).filter(Boolean);

    // ── layers (v1 internal keys → v2 output keys) ────────────────────────
    const layers = {
      Boundary:              this.layers?.Plan_Boundary       ?? true,
      Core:                  this.layers?.Core_Boundary       ?? true,
      Grid_Points:           this.layers?.Points              ?? true,
      Exclusion_Areas:       this.layers?.Exclusion_Areas     ?? true,
      Thermal_Zones:         this.layers?.Thermal_Zones ?? true,
      Structural_Components: this.layers?.Columns             ?? true,
      Mechanical_Components: this.layers?.Ducts               ?? false
    };

    return {
      schema_version: "2.0.0",
      name: this.name,
      units: this.units,

      boundary: { closed: this.boundaryClosed, edges: boundaryEdges },

      core: {
        closed: (this.Core_Boundary?.length > 0 || coreEdges.length > 0),
        edges: coreEdges
      },

      grid_points: gridPoints,

      exclusion_areas: exclusionAreas,

      thermal_zones: this.Thermal_Zones || [],

      structural_components: {
        units: { length: this.units?.length || 'm' },
        columns,
        beams: (this.Beams || []).map(b => ({
          ...b,
          start: b.start ? { x: u(b.start.x), y: u(b.start.y) } : { x: 0, y: 0 },
          end:   b.end   ? { x: u(b.end.x),   y: u(b.end.y)   } : { x: 0, y: 0 },
        })),
      },

      mechanical_components: {
        ducts: this.Ducts || [],
        duct_plan: this.Duct_Plan || [],
        terminals: (this.terminals || []).map(t => ({ ...t, position: { x: u(t.position.x), y: u(t.position.y) } })),
        equipment: (this.equipment || []).map(e => ({ ...e, position: { x: u(e.position.x), y: u(e.position.y) } }))
      },

      layers
    };
  }

  static fromJSON(obj, options = {}) {
    // ── v2 schema detection ───────────────────────────────────────────────
    if (obj.schema_version === "2.0.0" || obj.boundary?.edges) {
      return FloorPlan._fromJSONv2(obj, options);
    }

    const fp = new FloorPlan(obj.name);
    fp.schema_version = obj.schema_version || "0.9.0";
    fp.units = obj.units || { length: "m" };
    fp.boundaryClosed = obj.boundaryClosed || false;

    // Restore layer visibility settings
    fp.layers = obj.layers || {
      Plan_Boundary: true,
      Boundary_Area: true,
      Core_Boundary: true,
      Core_Area: true,
      Columns: true,
      Thermal_Zones: true,
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

    // Use canonical Thermal_Zones only (no legacy migration fallback).
    // Map backend key thermal_region_geometry to frontend property subZones
    fp.Thermal_Zones = (obj.thermal_zones || []).map(({ thermal_region_geometry, vav_control_zones, ...tz }) => ({
      ...tz,
      subZones: thermal_region_geometry || [],
      thermalControlZones: vav_control_zones || []
    }));
    fp.Exclusion_Areas = (obj.Exclusion_Areas || []).map(ea => ({
      id: ea.id,
      vertices: (ea.vertices || []).map(([x, y]) => [x * (savedPxPerUnit || 1), y * (savedPxPerUnit || 1)])
    }));

    // Normalize Plan_Boundary polygons and thermal_zones sub-zone
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

    // Normalize Thermal_Zones subZones coordinates
    (fp.Thermal_Zones || []).forEach(region => {
      region.subZones = (region.subZones || []).map(sub => {
        return (sub || []).map((pt) => {
          const found = findCanonical(pt.x, pt.y);
          return found ? { x: found.x, y: found.y } : { x: pt.x, y: pt.y };
        });
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

    // ─── restore new structured element collections ───────────────────────
    const pxConvNew = savedPxPerUnit || 1;
    fp.Walls = (obj.Walls || []).map(w => makeWall(w.id, {
      start:       { x: (w.start?.x || 0) * pxConvNew, y: (w.start?.y || 0) * pxConvNew },
      end:         { x: (w.end?.x   || 0) * pxConvNew, y: (w.end?.y   || 0) * pxConvNew },
      wallType:    w.wallType    || 'boundary',
      translucent: w.translucent || false,
      locked:      w.locked      || false,
      openings:    (w.openings || []).map(o => makeWallOpening(o.id, { ...o }))
    }));
    fp.openings = (obj.openings || []).map(o => ({
      ...o,
      position: { x: (o.position?.x || 0) * pxConvNew, y: (o.position?.y || 0) * pxConvNew }
    }));
    fp.partitions = {
      nodes:  (obj.partitions?.nodes  || []).map(n => makeNode(n.id, (n.x || 0) * pxConvNew, (n.y || 0) * pxConvNew)),
      edges:  (obj.partitions?.edges  || []).map(e => makeEdge(e.id, e.v1, e.v2, !!e.locked)),
      closed: obj.partitions?.closed || false
    };
    fp.ceilingZones = (obj.ceilingZones || []).map(z => ({
      ...z,
      vertices: (z.vertices || []).map(v => ({ x: (v.x || 0) * pxConvNew, y: (v.y || 0) * pxConvNew }))
    }));
    fp.terminals = (obj.terminals || []).map(t => ({
      ...t,
      position: { x: (t.position?.x || 0) * pxConvNew, y: (t.position?.y || 0) * pxConvNew }
    }));
    fp.equipment = (obj.equipment || []).map(e => ({
      ...e,
      position: { x: (e.position?.x || 0) * pxConvNew, y: (e.position?.y || 0) * pxConvNew }
    }));
    // If the saved plan indicated a closed boundary but did not include
    // an explicit boundary area, create one so the boundary surface is
    // available as an area for measurement and UI listing.
    if (fp.boundaryClosed && !fp.boundaryArea) {
      fp._updateBoundaryArea();
    }

    return fp;
  }

  // ── v2 schema loader ──────────────────────────────────────────────────────
  static _fromJSONv2(obj, options = {}) {
    const fp = new FloorPlan(obj.name);
    fp.schema_version = "2.0.0";
    fp.units = obj.units || { length: "m" };
    const ppu = obj.units?.pxPerUnit || 1;
    const px = v => v * ppu;

    // ── shared helpers ─────────────────────────────────────────────────────
    const deserializeOpenings = (openings) => (openings || []).map(o =>
      makeWallOpening(o.id || fp._genId('wo'), {
        openingKind: o.type || o.openingKind || 'door',
        t:           o.placement ?? o.t ?? 0.5,
        width:       o.width  ?? 900,
        height:      o.height ?? 2100,
        sillHeight:  o.sill_height ?? o.sillHeight ?? 0
      })
    );

    // ── boundary ──────────────────────────────────────────────────────────
    fp.boundaryClosed = obj.boundary?.closed ?? false;
    const bEdgesIn = obj.boundary?.edges || [];

    // Build deduplicated node list and edges from boundary edge pairs
    const nodeByKey = new Map(); // "x,y" → {id, x, y}
    const orCreate = (xu, yu) => {
      const xp = px(xu), yp = px(yu);
      const key = `${xp.toFixed(4)},${yp.toFixed(4)}`;
      if (!nodeByKey.has(key)) nodeByKey.set(key, { id: fp._genId('n'), x: xp, y: yp });
      return nodeByKey.get(key);
    };

    const wEdges = [];
    const orderedBoundaryNodes = [];
    // Keep edge data alongside the graph entry so we can populate fp.Walls below
    const bEdgeData = []; // { e, n1, n2 } for edges that were added to wEdges
    for (const e of bEdgesIn) {
      const n1 = orCreate(e.start.x, e.start.y);
      const n2 = orCreate(e.end.x, e.end.y);
      orderedBoundaryNodes.push(n1);
      if (n1.id !== n2.id) {
        wEdges.push({ id: e.id || fp._genId('e'), v1: n1.id, v2: n2.id, locked: !!e.locked, translucent: e.translucent ?? false });
        bEdgeData.push({ e, n1, n2 });
      }
    }
    fp.wall_graph = { nodes: [...nodeByKey.values()], edges: wEdges };

    // Populate fp.Walls for boundary edges so the inspector and renderer can
    // read wallType, translucent, locked, and openings per-edge.
    for (const { e, n1, n2 } of bEdgeData) {
      fp.Walls.push(makeWall(e.id || fp._genId('w'), {
        start: { x: n1.x, y: n1.y }, end: { x: n2.x, y: n2.y },
        wallType: 'boundary', translucent: e.translucent ?? false,
        locked: !!e.locked, openings: deserializeOpenings(e.openings)
      }));
    }

    if (fp.boundaryClosed && orderedBoundaryNodes.length >= 3) {
      fp.boundaryArea = {
        id: fp._genId('a'),
        label: 'boundary',
        vertices: orderedBoundaryNodes.map(n => n.id)
      };
    }

    // ── core ──────────────────────────────────────────────────────────────
    const cEdgesIn = obj.core?.edges || [];
    const corePtObj = {};
    for (let i = 0; i < cEdgesIn.length; i++) {
      const e = cEdgesIn[i];
      const sx = px(e.start.x), sy = px(e.start.y);
      const ex = px(e.end.x),   ey = px(e.end.y);
      const wallId = e.id || fp._genId('w');
      fp.Walls.push(makeWall(wallId, {
        start: { x: sx, y: sy }, end: { x: ex, y: ey },
        wallType: 'core', translucent: e.translucent ?? false,
        locked: !!e.locked, openings: deserializeOpenings(e.openings)
      }));
      // Add core edges to wall_graph so findClosestSegment can hit-test them.
      // orCreate deduplicates nodes by coordinate, shared with boundary nodes.
      const cn1 = orCreate(e.start.x, e.start.y);
      const cn2 = orCreate(e.end.x, e.end.y);
      if (cn1.id !== cn2.id) {
        fp.wall_graph.edges.push({ id: wallId, v1: cn1.id, v2: cn2.id,
          locked: !!e.locked, translucent: e.translucent ?? false, wallType: 'core' });
      }
      corePtObj[`Pt_${i}`] = [sx, sy, 0];
    }
    // wall_graph.nodes may have grown — keep it in sync
    fp.wall_graph.nodes = [...nodeByKey.values()];
    if (cEdgesIn.length > 0) {
      corePtObj[`Pt_${cEdgesIn.length}`] = [px(cEdgesIn[0].start.x), px(cEdgesIn[0].start.y), 0];
      fp.Core_Boundary = [corePtObj];
    }

    // ── grid points ───────────────────────────────────────────────────────
    fp.Points = (obj.grid_points || []).map(p => ({
      id: p.id, x: px(p.x), y: px(p.y), column: p.column ?? true, mechanical: p.mechanical ?? true, entryPoint: p.entryPoint ?? false
    }));

    // ── exclusion areas ───────────────────────────────────────────────────
    fp.Exclusion_Areas = (obj.exclusion_areas || []).map(ea => ({
      id: ea.id,
      vertices: (ea.vertices || []).map(([x, y]) => [px(x), px(y)])
    }));

    // ── thermal zones ─────────────────────────────────────────────────────
    // Map backend key thermal_region_geometry to frontend property subZones
    fp.Thermal_Zones = (obj.thermal_zones || []).map(({ thermal_region_geometry, vav_control_zones, ...tz }) => ({
      ...tz,
      subZones: thermal_region_geometry || [],
      thermalControlZones: vav_control_zones || []
    }));

    // ── structural ────────────────────────────────────────────────────────
    const mmMap = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
    const srcUnit = obj.structural_components?.units?.length || obj.units?.length || 'm';
    const mmPerSrc = mmMap[srcUnit] ?? 1000;
    const mmPerCanvas = mmMap[fp.units?.length || 'm'] ?? 1000;
    const sPx = v => v * ppu * mmPerSrc / mmPerCanvas;

    fp.Columns = (obj.structural_components?.columns || []).map((col, i) => {
      if (Array.isArray(col)) {
        const pts = col.filter(p => p && typeof p.x === 'number' && typeof p.y === 'number');
        if (!pts.length) return null;
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        return { id: `Column_${i}`, x: sPx(cx), y: sPx(cy) };
      }
      return {
        ...col,
        x: col?.x !== undefined ? sPx(col.x) : undefined,
        y: col?.y !== undefined ? sPx(col.y) : undefined
      };
    }).filter(Boolean);

    fp.Beams = (obj.structural_components?.beams || []).map(b => {
      const sx = b?.start?.x;
      const sy = b?.start?.y;
      const ex = b?.end?.x;
      const ey = b?.end?.y;
      return {
        ...b,
        start: (sx !== undefined && sy !== undefined) ? { x: sPx(sx), y: sPx(sy) } : { x: 0, y: 0 },
        end:   (ex !== undefined && ey !== undefined) ? { x: sPx(ex), y: sPx(ey) } : { x: 0, y: 0 },
      };
    });

    // ── mechanical ────────────────────────────────────────────────────────
    fp.Ducts = obj.mechanical_components?.ducts || [];
    fp.Duct_Plan = obj.mechanical_components?.duct_plan || [];
    fp.terminals = (obj.mechanical_components?.terminals || []).map(t => ({
      ...t, position: { x: px(t.position?.x || 0), y: px(t.position?.y || 0) }
    }));
    fp.equipment = (obj.mechanical_components?.equipment || []).map(e => ({
      ...e, position: { x: px(e.position?.x || 0), y: px(e.position?.y || 0) }
    }));

    // ── openings ──────────────────────────────────────────────────────────
    fp.openings = (obj.openings || []).map(o => ({
      ...o, position: { x: px(o.position?.x || 0), y: px(o.position?.y || 0) }
    }));

    // ── layers (v2 output keys → internal v1 keys) ────────────────────────
    fp.layers = {
      Plan_Boundary:       obj.layers?.Boundary              ?? true,
      Boundary_Area:       obj.layers?.Boundary              ?? true,
      Core_Boundary:       obj.layers?.Core                  ?? true,
      Core_Area:           obj.layers?.Core                  ?? true,
      Columns:             obj.layers?.Structural_Components ?? true,
      Thermal_Zones:     obj.layers?.Thermal_Zones           ?? true,
      Exclusion_Areas:     obj.layers?.Exclusion_Areas       ?? true,
      Beams:               false,
      Walls:               obj.layers?.Boundary              ?? true,
      Points:              obj.layers?.Grid_Points           ?? true,
      Edges:               false,
      Ducts:               obj.layers?.Mechanical_Components ?? false,
      Duct_Plan:           obj.layers?.Mechanical_Components ?? false
    };

    fp.requirements = obj.requirements || { bathrooms: 1 };
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

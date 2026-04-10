/**
 * elements.js
 * -----------
 * Factory functions for every first-class element type used in a FloorPlan.
 *
 * All factories accept an `id` argument (supplied by FloorPlan._genId) and
 * an optional `props` bag for overrides.  Each function returns a plain
 * object with a mandatory `kind` discriminator so consumers can switch on
 * type without instanceof checks.
 *
 * Element taxonomy
 * ────────────────
 *  geometry
 *    Wall           – a single wall segment (start+end points)
 *                     wallType: 'boundary' | 'core' | 'partition'
 *                     translucent: bool
 *                     openings: WallOpening[]
 *    WallOpening    – gap inside a wall (door / window / entrance)
 *                     positioned by parametric t ∈ [0,1] along the wall
 *    Core           – service-core polygon       (lift shafts, stairs …)
 *    Opening        – standalone opening (legacy; prefer WallOpening)
 *
 *  structure
 *    Column         – vertical point support     (polygon footprint)
 *    Beam           – horizontal linear support  (line + height)
 *
 *  spaces
 *    ThermalZone    – temperature / air-flow region
 *    CeilingZone    – plenum / suspended-ceiling area (optional)
 *
 *  hvac  (schema-defined; no drawing tool yet)
 *    Terminal       – diffuser / grille / return air point
 *    Equipment      – FCU / AHU / VAV box / coil etc.
 *    GridPoint      – discretised routing node
 *    GridEdge       – valid duct path between two GridPoints
 *    DuctSpec       – available duct product specification
 *    DuctSegment    – committed duct run in the final layout
 */

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Shallow-merge defaults with caller-supplied props, stripping undefined. */
function merge(defaults, props = {}) {
  const out = { ...defaults };
  for (const [k, v] of Object.entries(props)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// ─── geometry ─────────────────────────────────────────────────────────────────

/**
 * A single node in a wall / partition graph.
 * @param {string} id
 * @param {number} x  – canvas pixels
 * @param {number} y  – canvas pixels
 */
export function makeNode(id, x, y) {
  return { kind: 'node', id, x, y };
}

/**
 * A single edge in a wall / partition graph (low-level; prefer makeWall).
 * @param {string}  id
 * @param {string}  v1   – node id
 * @param {string}  v2   – node id
 * @param {boolean} locked
 */
export function makeEdge(id, v1, v2, locked = false) {
  return { kind: 'edge', id, v1, v2, locked };
}

// ─── Wall & WallOpening ───────────────────────────────────────────────────────

/**
 * An opening embedded in a specific wall.
 * Position is expressed as a parametric value `t` ∈ [0, 1] along the wall
 * (0 = wall start, 1 = wall end), so it remains valid if wall endpoints move.
 *
 * @param {string} id
 * @param {Object} [props]
 * @param {'entrance'|'door'|'window'} [props.openingKind]
 * @param {number}  [props.t]           – parametric position along parent wall (0–1)
 * @param {number}  [props.width]       – opening width in model units
 * @param {number}  [props.height]      – opening height in model units
 * @param {number}  [props.sillHeight]  – sill height in model units (0 for doors)
 */
export function makeWallOpening(id, props = {}) {
  return merge({
    kind: 'wallOpening',
    id,
    openingKind: 'door',  // 'entrance' | 'door' | 'window'
    t: 0.5,               // parametric position: 0 = wall start, 1 = wall end
    width: 900,           // model units
    height: 2100,         // model units
    sillHeight: 0         // model units (0 for doors/entrances; >0 for windows)
  }, props);
}

/**
 * A single wall segment – the primary wall primitive.
 *
 * A wall has two endpoints in canvas-pixel space, a classification type,
 * a material flag (opaque vs translucent), and an ordered list of openings
 * (doors / windows / entrances) that sit along its length.
 *
 * Openings are owned by the wall so they move/delete with it.
 * Use `makeWallOpening` to build opening entries.
 *
 * @param {string} id
 * @param {Object} [props]
 * @param {{x:number,y:number}} [props.start]       – canvas pixels
 * @param {{x:number,y:number}} [props.end]         – canvas pixels
 * @param {'boundary'|'core'|'partition'} [props.wallType]
 * @param {boolean} [props.translucent]             – false = opaque, true = glazed
 * @param {boolean} [props.locked]                  – prevent accidental edits
 * @param {Array<ReturnType<makeWallOpening>>} [props.openings]
 */
export function makeWall(id, props = {}) {
  return merge({
    kind: 'wall',
    id,
    start: { x: 0, y: 0 },  // canvas pixels
    end:   { x: 0, y: 0 },  // canvas pixels
    wallType: 'boundary',    // 'boundary' | 'core' | 'partition'
    translucent: false,      // false = opaque; true = glazed / translucent
    locked: false,
    openings: []             // WallOpening[], sorted by ascending t
  }, props);
}

/**
 * Service-core polygon (stairwell, lift shaft, riser room …).
 * Vertices are stored as an ordered array of {x, y} pixel coordinates.
 * @param {string} id
 * @param {Object} [props]
 * @param {string} [props.label]
 * @param {Array<{x:number,y:number}>} [props.vertices]
 * @param {string} [props.coreType]  – 'stair' | 'lift' | 'riser' | 'other'
 */
export function makeCore(id, props = {}) {
  return merge({
    kind: 'core',
    id,
    label: '',
    coreType: 'other',   // 'stair' | 'lift' | 'riser' | 'other'
    vertices: [],        // [{x, y}, …]  canvas pixels, no duplicate closing vertex
    color: null,
    alpha: 0.25
  }, props);
}

/**
 * Opening in a wall – LEGACY standalone form (kept for backward compat).
 * For new code prefer makeWall + makeWallOpening.
 * @param {string} id
 * @param {Object} [props]
 * @param {'entrance'|'door'|'window'} [props.openingKind]
 * @param {string}  [props.edgeId]  – wall edge the opening sits on
 * @param {{x:number,y:number}} [props.position]  – midpoint in canvas pixels
 * @param {number}  [props.width]   – in model units (mm/cm/m)
 * @param {number}  [props.height]  – in model units
 * @param {number}  [props.sillHeight] – window sill height in model units
 */
export function makeOpening(id, props = {}) {
  return merge({
    kind: 'opening',
    id,
    openingKind: 'entrance',   // 'entrance' | 'door' | 'window'
    edgeId: null,
    position: { x: 0, y: 0 }, // canvas pixels
    width: 900,                // model units
    height: 2100,              // model units
    sillHeight: 0              // model units (0 for doors/entrances)
  }, props);
}

// ─── structure ────────────────────────────────────────────────────────────────

/**
 * Column footprint (closed polygon, typically rectangular or circular).
 * @param {string} id
 * @param {Object} [props]
 * @param {Array<{x:number,y:number}>} [props.vertices]
 * @param {number} [props.height]  – column height in model units
 */
export function makeColumn(id, props = {}) {
  return merge({
    kind: 'column',
    id,
    label: '',
    vertices: [],   // [{x, y}, …]
    height: 3000,   // model units
    color: null
  }, props);
}

/**
 * Beam element (a line segment with a bottom-of-beam height constraint).
 * @param {string} id
 * @param {Object} [props]
 * @param {{x:number,y:number}} [props.start]
 * @param {{x:number,y:number}} [props.end]
 * @param {number} [props.soffit]   – soffit height in model units
 * @param {number} [props.depth]    – beam structural depth in model units
 */
export function makeBeam(id, props = {}) {
  return merge({
    kind: 'beam',
    id,
    label: '',
    start: { x: 0, y: 0 },  // canvas pixels
    end: { x: 0, y: 0 },    // canvas pixels
    soffit: 2700,            // model units (height to underside of beam)
    depth: 300               // model units
  }, props);
}

// ─── spaces ───────────────────────────────────────────────────────────────────

/**
 * Thermal zone / temperature region.
 * Each zone can have multiple sub-region polygons (e.g. broken-up area).
 * @param {string} id
 * @param {Object} [props]
 * @param {string}  [props.name]
 * @param {'perimeter'|'internal'} [props.zoneType]
 * @param {Array<Array<{x:number,y:number}>>} [props.subregions]
 * @param {number}  [props.airRequirement]   – l/s per person or l/s·m²
 * @param {number}  [props.numberOfRisers]
 * @param {number}  [props.vavNumber]
 * @param {string}  [props.color]
 * @param {number}  [props.alpha]
 */
export function makeThermalZone(id, props = {}) {
  return merge({
    kind: 'thermalZone',
    id,
    name: '',
    zoneType: 'internal',    // 'perimeter' | 'internal'
    subregions: [],          // [[ {x,y}, … ], …]  one polygon per sub-region
    airRequirement: 7.5,     // model units (l/s)
    numberOfRisers: 1,
    vavNumber: 1,
    avgLoadPerPoint: 0,
    totalLoad: 0,
    totalArea: 0,
    entryCandidates: [[]],
    thermalControlZones: [],
    color: null,
    alpha: 0.3
  }, props);
}

/**
 * Ceiling zone – defines a horizontal boundary with a specific plenum depth.
 * Useful when duct routing must respect variable ceiling heights.
 * @param {string} id
 * @param {Object} [props]
 * @param {Array<{x:number,y:number}>} [props.vertices]
 * @param {number}  [props.floorToCeiling]  – finished ceiling height (model units)
 * @param {number}  [props.plenumDepth]     – void above ceiling (model units)
 */
export function makeCeilingZone(id, props = {}) {
  return merge({
    kind: 'ceilingZone',
    id,
    label: '',
    vertices: [],
    floorToCeiling: 2700,   // model units
    plenumDepth: 400        // model units
  }, props);
}

// ─── hvac ─────────────────────────────────────────────────────────────────────

/**
 * Air terminal – supply diffuser, return grille, exhaust point, etc.
 * @param {string} id
 * @param {Object} [props]
 * @param {'supply'|'return'|'exhaust'|'transfer'} [props.terminalKind]
 * @param {{x:number,y:number}} [props.position]
 * @param {string}  [props.zoneId]    – parent ThermalZone id
 * @param {number}  [props.flowRate]  – l/s
 */
export function makeTerminal(id, props = {}) {
  return merge({
    kind: 'terminal',
    id,
    terminalKind: 'supply',   // 'supply' | 'return' | 'exhaust' | 'transfer'
    position: { x: 0, y: 0 },
    zoneId: null,
    flowRate: 0               // l/s
  }, props);
}

/**
 * Mechanical equipment – FCU, AHU, VAV box, coil, etc.
 * @param {string} id
 * @param {Object} [props]
 * @param {'fcu'|'ahu'|'vav'|'coil'|'fan'|'other'} [props.equipmentKind]
 * @param {{x:number,y:number}} [props.position]
 * @param {number}  [props.rotation]   – degrees
 * @param {string}  [props.zoneId]     – parent ThermalZone id, if applicable
 * @param {number}  [props.capacity]   – kW or l/s depending on type
 * @param {string}  [props.tag]        – engineer's tag reference
 */
export function makeEquipment(id, props = {}) {
  return merge({
    kind: 'equipment',
    id,
    equipmentKind: 'fcu',    // 'fcu' | 'ahu' | 'vav' | 'coil' | 'fan' | 'other'
    position: { x: 0, y: 0 },
    rotation: 0,
    zoneId: null,
    capacity: 0,
    tag: ''
  }, props);
}

/**
 * Discretised routing node (used by grid generation).
 * @param {string} id
 * @param {Object} [props]
 */
export function makeGridPoint(id, props = {}) {
  return merge({
    kind: 'gridPoint',
    id,
    x: 0,
    y: 0,
    outsideBoundary: false,
    insideCore: false
  }, props);
}

/**
 * Valid duct path between two GridPoints.
 * @param {string} id
 * @param {string} p1  – GridPoint id
 * @param {string} p2  – GridPoint id
 * @param {Object} [props]
 */
export function makeGridEdge(id, p1, p2, props = {}) {
  return merge({
    kind: 'gridEdge',
    id,
    p1,
    p2,
    weight: 1               // routing cost multiplier
  }, props);
}

/**
 * Available duct product specification.
 * @param {string} id
 * @param {Object} [props]
 */
export function makeDuctSpec(id, props = {}) {
  return merge({
    kind: 'ductSpec',
    id,
    label: '',
    shape: 'rectangular',   // 'rectangular' | 'circular' | 'oval'
    width: 200,             // mm
    height: 100,            // mm (or diameter for circular)
    maxVelocity: 6,         // m/s
    pressureDrop: 1         // Pa/m
  }, props);
}

/**
 * Committed duct segment in the final routing solution.
 * @param {string} id
 * @param {string} p1  – GridPoint id (or terminal)
 * @param {string} p2  – GridPoint id (or terminal)
 * @param {Object} [props]
 */
export function makeDuctSegment(id, p1, p2, props = {}) {
  return merge({
    kind: 'ductSegment',
    id,
    p1,
    p2,
    ductSpecId: null,        // reference to a DuctSpec
    flowRate: 0              // l/s
  }, props);
}

// ─── kind → factory map (useful for generic restore from JSON) ────────────────

export const ELEMENT_FACTORIES = {
  node:        (id, p) => makeNode(id, p.x, p.y),
  edge:        (id, p) => makeEdge(id, p.v1, p.v2, p.locked),
  wall:        makeWall,
  wallOpening: makeWallOpening,
  core:        makeCore,
  opening:     makeOpening,
  column:      makeColumn,
  beam:        makeBeam,
  thermalZone: makeThermalZone,
  ceilingZone: makeCeilingZone,
  terminal:    makeTerminal,
  equipment:   makeEquipment,
  gridPoint:   (id, p) => makeGridPoint(id, p),
  gridEdge:    (id, p) => makeGridEdge(id, p.p1, p.p2, p),
  ductSpec:    makeDuctSpec,
  ductSegment: (id, p) => makeDuctSegment(id, p.p1, p.p2, p)
};

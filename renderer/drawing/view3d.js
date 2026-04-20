// renderer/drawing/view3d.js
// 3D visualisation of the active FloorPlan using Three.js + OrbitControls.
//
// Renders: extruded boundary walls, core boundaries, columns, exclusion areas
// and a flat floor plane. Camera is fully orbitable with mouse.

import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { getNodeById } from '../models/floorPlanUtils.js';

const WALL_THICKNESS_RATIO  = 0.008; // fraction of plan footprint size
const WALL_HEIGHT_RATIO     = 0.15;  // fraction of plan footprint size

export class View3D {
  constructor(container) {
    this._container  = container;
    this._renderer   = null;
    this._scene      = null;
    this._camera     = null;
    this._controls   = null;
    this._rafId      = null;
    this._active     = false;
    this._resizeObserver = null;
    this._fp         = null;                   // last FloorPlan shown
    this._heightPx    = null;                  // null = auto (ratio fallback)
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Render the given FloorPlan in 3D and start the animation loop.
   * @param {object} fp        Active FloorPlan
   * @param {number} [heightCm]  Optional initial wall height in centimetres
   */
  show(fp, heightCm = null) {
    if (!this._renderer) this._initRenderer();
    this._renderer.domElement.style.display = '';
    this._active = true;
    this._fp = fp;
    if (heightCm !== null) this._heightPx = this._cmToPx(heightCm);
    this._buildScene(fp);
    this._startLoop();
  }

  /**
   * Update the wall height in centimetres and rebuild the scene.
   * @param {number} cm  Wall height in cm (clamped 270–600)
   */
  setHeightCm(cm) {
    this._heightPx = this._cmToPx(Math.max(270, Math.min(600, cm)));
    if (this._fp && this._active) this._buildScene(this._fp);
  }

  /**
   * Convert a centimetre value to canvas pixels using the FloorPlan's unit scale.
   * Falls back to treating 1 px = 1 unit when no scale is configured.
   */
  _cmToPx(cm) {
    const pxPerUnit = this._fp?.units?.pxPerUnit || 1;
    const unit      = this._fp?.units?.length    || 'mm';
    // How many plan-units fit in 1 cm
    const unitsPerCm = { mm: 10, cm: 1, m: 0.01, in: 0.3937, ft: 0.032808 }[unit] ?? 10;
    return cm * unitsPerCm * pxPerUnit;
  }

  /** Pause the 3D view (hides the WebGL canvas, stops RAF). */
  hide() {
    this._active = false;
    this._stopLoop();
    if (this._renderer) {
      this._renderer.domElement.style.display = 'none';
    }
  }

  /** Fully dispose renderer and remove element from DOM. */
  dispose() {
    this._active = false;
    this._stopLoop();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._controls) {
      this._controls.dispose();
      this._controls = null;
    }
    if (this._renderer) {
      this._renderer.dispose();
      const el = this._renderer.domElement;
      if (el.parentNode) el.parentNode.removeChild(el);
      this._renderer = null;
    }
    this._scene  = null;
    this._camera = null;
  }

  // ── Initialisation ──────────────────────────────────────────────────────

  _initRenderer() {
    const w = this._container.clientWidth  || 512;
    const h = this._container.clientHeight || 512;

    this._renderer = new THREE.WebGLRenderer({ antialias: true });
    this._renderer.setPixelRatio(window.devicePixelRatio);
    this._renderer.setSize(w, h);
    this._renderer.setClearColor(0x1a1a2e);
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas3d = this._renderer.domElement;
    canvas3d.style.position = 'absolute';
    canvas3d.style.top      = '0';
    canvas3d.style.left     = '0';
    canvas3d.style.width    = '100%';
    canvas3d.style.height   = '100%';
    canvas3d.style.display  = 'none'; // hidden until show() is called
    this._container.appendChild(canvas3d);

    this._camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1e7);

    this._controls = new OrbitControls(this._camera, canvas3d);
    this._controls.enableDamping  = true;
    this._controls.dampingFactor  = 0.06;
    this._controls.screenSpacePanning = false;
    this._controls.minDistance = 10;

    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(this._container);
  }

  _onResize() {
    if (!this._renderer || !this._camera) return;
    const w = this._container.clientWidth;
    const h = this._container.clientHeight;
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(w, h);
  }

  // ── Scene construction ──────────────────────────────────────────────────

  _buildScene(fp) {
    this._scene = new THREE.Scene();
    const scene = this._scene;

    // ── Bounding box of the plan ───────────────────────────────────────────
    const nodes = fp.wall_graph?.nodes || [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      const x = n.x ?? n[0];
      const y = n.y ?? n[1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    });
    if (!isFinite(minX)) { minX = 0; maxX = 512; minY = 0; maxY = 512; }

    const planW    = maxX - minX;
    const planD    = maxY - minY;
    const planSize = Math.max(planW, planD, 1);
    const cx       = (minX + maxX) / 2;
    const cy       = (minY + maxY) / 2;

    const WALL_H = this._heightPx !== null ? this._heightPx : planSize * WALL_HEIGHT_RATIO;
    const WALL_T = Math.max(planSize * WALL_THICKNESS_RATIO, 2);

    // Canvas pixel → Three.js world coordinate helpers.
    //   canvas.x → world X  (unchanged)
    //   canvas.y → world Z  (negated: canvas Y grows down, Three.js Z grows toward viewer)
    //
    // For THREE.Shape coordinates (extruded along local Z, then rotated by
    // rotation.x = -π/2 so local Z becomes world Y):
    //   shape.x  = toX(canvas.x)
    //   shape.y  = toSY(canvas.y)   NOTE: world Z = -(shape.y) after rotation
    const toX  = x => x - cx;
    const toZ  = y => -(y - cy);
    const toSY = y =>  (y - cy);  // shape Y before rotation.x = -PI/2

    // ── Lighting ───────────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    const sun = new THREE.DirectionalLight(0xfff4d6, 1.0);
    sun.position.set(planSize * 0.8, planSize, planSize * 0.6);
    sun.castShadow = true;
    sun.shadow.camera.near   = 1;
    sun.shadow.camera.far    = planSize * 4;
    sun.shadow.camera.left   = -planSize;
    sun.shadow.camera.right  =  planSize;
    sun.shadow.camera.top    =  planSize;
    sun.shadow.camera.bottom = -planSize;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0xc8d8ff, 0.35);
    fill.position.set(-planSize, planSize * 0.4, -planSize * 0.5);
    scene.add(fill);

    // ── Materials ──────────────────────────────────────────────────────────
    const wallMat  = new THREE.MeshLambertMaterial({ color: 0xd4d0c8 });
    const coreMat  = new THREE.MeshLambertMaterial({ color: 0xe06060 });
    const colMat   = new THREE.MeshLambertMaterial({ color: 0x787878 });
    const floorMat = new THREE.MeshLambertMaterial({ color: 0xf2ede0, side: THREE.DoubleSide });
    const exclMat  = new THREE.MeshLambertMaterial({
      color: 0xcc3333, transparent: true, opacity: 0.28, side: THREE.DoubleSide,
    });

    // ── Floor slab ─────────────────────────────────────────────────────────
    // Build the boundary polygon in correct edge-traversal order.
    // Using wall_graph.nodes array order is NOT reliable — when a segment is
    // split, the new node is appended to the end of the array rather than
    // inserted at the correct polygon position. Traversing via edge
    // adjacency always gives the right winding regardless of array order.
    const boundaryPoly = this._buildOrderedFloorPoly(fp);
    if (boundaryPoly.length >= 3) {
      const shape = new THREE.Shape();
      boundaryPoly.forEach(({ x, y }, i) => {
        if (i === 0) shape.moveTo(toX(x), toSY(y));
        else         shape.lineTo(toX(x), toSY(y));
      });
      shape.closePath();

      const floorMesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), floorMat);
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.receiveShadow = true;
      scene.add(floorMesh);
    }

    // ── Boundary walls ─────────────────────────────────────────────────────
    (fp.wall_graph?.edges || []).forEach(edge => {
      const n1 = getNodeById(nodes, edge.v1);
      const n2 = getNodeById(nodes, edge.v2);
      if (!n1 || !n2) return;
      const seg = this._wallSegment(
        toX(n1.x), toZ(n1.y),
        toX(n2.x), toZ(n2.y),
        WALL_H, WALL_T, wallMat,
      );
      scene.add(seg);
    });

    // ── Core boundary walls ────────────────────────────────────────────────
    // Core_Boundary items are {Pt_0:[x,y,0], Pt_1:[x,y,0], ...} — the last
    // stored point is always a duplicate of Pt_0 (the explicit closing point
    // added by addCoreBoundary).  Drop it so we don't add a zero-length wall.
    (fp.Core_Boundary || []).forEach(core => {
      let pts = Object.values(core);
      if (pts.length < 3) return;
      // Remove the closing duplicate if present
      const last = pts[pts.length - 1];
      const first = pts[0];
      if (last[0] === first[0] && last[1] === first[1]) pts = pts.slice(0, -1);
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        scene.add(this._wallSegment(toX(x1), toZ(y1), toX(x2), toZ(y2), WALL_H, WALL_T, coreMat));
      }
    });

    // ── Columns (extruded polygons) ────────────────────────────────────────
    (fp.Columns || []).forEach(col => {
      const pts = Object.values(col);
      if (pts.length < 3) return;
      const shape = new THREE.Shape();
      pts.forEach(([x, y], i) => {
        if (i === 0) shape.moveTo(toX(x), toSY(y));
        else         shape.lineTo(toX(x), toSY(y));
      });
      shape.closePath();
      const geo  = new THREE.ExtrudeGeometry(shape, { depth: WALL_H, bevelEnabled: false });
      const mesh = new THREE.Mesh(geo, colMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.castShadow    = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    });

    // ── Exclusion / temperature areas (floor markers) ──────────────────────
    const exclAreas = [
      ...(fp.Exclusion_Areas || []),
      ...(fp.areas || []).filter(a => a.label && a.label !== 'boundary'),
    ];
    exclAreas.forEach(area => {
      const pts = area.vertices;
      if (!pts || pts.length < 3) return;
      const shape = new THREE.Shape();
      pts.forEach(([x, y], i) => {
        if (i === 0) shape.moveTo(toX(x), toSY(y));
        else         shape.lineTo(toX(x), toSY(y));
      });
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), exclMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 2; // float slightly above floor to avoid z-fighting
      scene.add(mesh);
    });

    // ── Ground reference grid ──────────────────────────────────────────────
    const grid = new THREE.GridHelper(planSize * 2.5, 20, 0x3a4a5a, 0x2a3445);
    grid.position.y = -3;
    scene.add(grid);

    // ── Position camera ────────────────────────────────────────────────────
    const target = new THREE.Vector3(0, WALL_H * 0.3, 0);
    this._controls.target.copy(target);
    this._camera.position.set(planSize * 0.55, planSize * 0.45, planSize * 0.75);
    this._camera.lookAt(target);
    this._controls.update();
  }

  // ── Geometry helpers ────────────────────────────────────────────────────

  /**
   * Traverse wall_graph edges to produce boundary polygon vertices in
   * correct polygon order.
   *
   * Why not just iterate wall_graph.nodes?
   * Splitting a segment appends the new node at the END of the nodes
   * array instead of inserting it between the two halves.  The nodes
   * array order therefore diverges from polygon-traversal order the
   * moment any segment has been split, which earcut triangulates as a
   * self-intersecting polygon and produces missing triangles.
   *
   * Supports both formats:
   *   - Newer: node = {id, x, y},  edge.v1 / edge.v2 = string ID
   *   - Legacy: node = [x, y],     edge.v1 / edge.v2 = [x, y] array
   */
  _buildOrderedFloorPoly(fp) {
    const nodes = fp.wall_graph?.nodes || [];
    const edges = fp.wall_graph?.edges || [];
    if (nodes.length < 3 || edges.length < 3) return [];

    // ── Build a stable key for each node ────────────────────────────────
    const nodeKey = n => {
      if (n?.id)                         return n.id;
      if (Array.isArray(n))              return `${n[0]},${n[1]}`;
      if (n?.x !== undefined)            return `${n.x},${n.y}`;
      return null;
    };
    const edgeKey = ref => {
      if (typeof ref === 'string')       return ref;          // modern: ID string
      if (ref?.id)                       return ref.id;
      if (Array.isArray(ref))            return `${ref[0]},${ref[1]}`;
      if (ref?.x !== undefined)          return `${ref.x},${ref.y}`;
      return null;
    };

    // ── key → {x, y} coordinate lookup ──────────────────────────────────
    const coordOf = new Map();
    nodes.forEach(n => {
      const k = nodeKey(n);
      if (k) coordOf.set(k, { x: n.x ?? n[0], y: n.y ?? n[1] });
    });

    // ── Undirected adjacency list ────────────────────────────────────────
    const adj = new Map();
    edges.forEach(e => {
      const u = edgeKey(e.v1), v = edgeKey(e.v2);
      if (!u || !v) return;
      if (!adj.has(u)) adj.set(u, []);
      if (!adj.has(v)) adj.set(v, []);
      adj.get(u).push(v);
      adj.get(v).push(u);
    });

    // ── Walk the polygon starting from node[0] ───────────────────────────
    const startKey = nodeKey(nodes[0]);
    if (!startKey || !adj.has(startKey)) {
      // Fallback: node array order
      return nodes.map(n => ({ x: n.x ?? n[0], y: n.y ?? n[1] }));
    }

    const visited = new Set([startKey]);
    const poly    = [coordOf.get(startKey)];
    let   cur     = startKey;

    while (poly.length < nodes.length) {
      const next = (adj.get(cur) || []).find(k => !visited.has(k));
      if (!next || !coordOf.has(next)) break;
      visited.add(next);
      poly.push(coordOf.get(next));
      cur = next;
    }

    // If traversal found fewer than 3 vertices, fall back to array order
    return poly.length >= 3
      ? poly
      : nodes.map(n => ({ x: n.x ?? n[0], y: n.y ?? n[1] }));
  }

  /**
   * Create a wall panel (BoxGeometry) spanning (x1, z1) → (x2, z2)
   * at the given height and thickness.
   */
  _wallSegment(x1, z1, x2, z2, height, thickness, material) {
    const length = Math.hypot(x2 - x1, z2 - z1);
    if (length < 0.5) return new THREE.Object3D();

    const geo  = new THREE.BoxGeometry(length, height, thickness);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set((x1 + x2) / 2, height / 2, (z1 + z2) / 2);
    mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  // ── Render loop ─────────────────────────────────────────────────────────

  _startLoop() {
    const loop = () => {
      if (!this._active) return;
      this._rafId = requestAnimationFrame(loop);
      this._controls.update();
      this._renderer.render(this._scene, this._camera);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _stopLoop() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }
}

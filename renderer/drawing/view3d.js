// renderer/drawing/view3d.js
// 3D visualisation of the active FloorPlan using Three.js + OrbitControls.
//
// Components (added incrementally):
//   ✓ Floor slab + boundary walls
//   ○ Core walls
//   ○ Columns
//   ○ Structural beams
//   ○ Duct routing

import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { getNodeById } from '../models/floorPlanUtils.js';

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
    this._fp         = null;
    this._heightPx   = null;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  show(fp, heightCm = null) {
    if (!fp) return;
    if (!this._renderer) this._initRenderer();
    this._renderer.domElement.style.display = '';
    this._active = true;
    this._fp = fp;
    if (heightCm !== null) this._heightPx = this._cmToPx(fp, heightCm);
    this._buildScene(fp);
    this._startLoop();
  }

  setHeightCm(cm) {
    if (!this._fp || !this._active) return;
    this._heightPx = this._cmToPx(this._fp, Math.max(270, Math.min(600, cm)));
    this._buildScene(this._fp, { preserveView: true });
  }

  hide() {
    this._active = false;
    this._stopLoop();
    if (this._renderer) this._renderer.domElement.style.display = 'none';
  }

  dispose() {
    this._active = false;
    this._stopLoop();
    if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
    if (this._controls)       { this._controls.dispose(); this._controls = null; }
    if (this._renderer) {
      this._renderer.dispose();
      const el = this._renderer.domElement;
      if (el.parentNode) el.parentNode.removeChild(el);
      this._renderer = null;
    }
    this._scene = this._camera = null;
  }

  // ── Renderer init ─────────────────────────────────────────────────────────

  _initRenderer() {
    const w = this._container.clientWidth  || 800;
    const h = this._container.clientHeight || 600;

    this._renderer = new THREE.WebGLRenderer({ antialias: true });
    this._renderer.setPixelRatio(window.devicePixelRatio);
    this._renderer.setSize(w, h);
    this._renderer.setClearColor(0x1e1e2e);

    const el = this._renderer.domElement;
    el.style.position = 'absolute';
    el.style.top      = '0';
    el.style.left     = '0';
    el.style.width    = '100%';
    el.style.height   = '100%';
    el.style.display  = 'none';
    this._container.appendChild(el);

    this._camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1e7);

    this._controls = new OrbitControls(this._camera, el);
    this._controls.enableDamping   = true;
    this._controls.dampingFactor   = 0.06;
    this._controls.screenSpacePanning = false;
    this._controls.minDistance     = 5;

    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(this._container);
  }

  _onResize() {
    if (!this._renderer || !this._camera) return;
    const w = this._container.clientWidth;
    const h = this._container.clientHeight;
    if (!w || !h) return;
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(w, h);
  }

  // ── Coordinate helpers ────────────────────────────────────────────────────

  _cmToPx(fp, cm) {
    const pxPerUnit  = fp.units?.pxPerUnit || 1;
    const unit       = fp.units?.length    || 'm';
    const unitsPerCm = { mm: 10, cm: 1, m: 0.01, in: 0.3937, ft: 0.032808 }[unit] ?? 0.01;
    return cm * unitsPerCm * pxPerUnit;
  }

  // ── Scene ─────────────────────────────────────────────────────────────────

  _buildScene(fp, { preserveView = false } = {}) {
    const prevView = preserveView ? this._captureView() : null;

    this._scene = new THREE.Scene();
    const scene = this._scene;

    // ── Bounding box ────────────────────────────────────────────────────────
    const nodes = fp.wall_graph?.nodes || [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const x = n.x ?? n[0];
      const y = n.y ?? n[1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (!isFinite(minX)) { minX = 0; maxX = 512; minY = 0; maxY = 512; }

    const planW    = maxX - minX;
    const planD    = maxY - minY;
    const planSize = Math.max(planW, planD, 1);
    const cx       = (minX + maxX) / 2;
    const cy       = (minY + maxY) / 2;

    // Canvas pixel → Three.js world:
    //   x axis: unchanged (toX)
    //   y axis: canvas Y grows downward → Three.js Z grows toward viewer (toZ)
    //   For Shape (extruded along local Z, then rotated -π/2 around X → local Z becomes world Y):
    //     shape.x = toX,  shape.y = toSY
    const toX  = x =>  (x - cx);
    const toZ  = y => -(y - cy);
    const toSY = y =>  (y - cy);

    const WALL_H = this._heightPx !== null ? this._heightPx : this._cmToPx(fp, 400);
    const WALL_T = Math.max(planSize * 0.006, 1.5);

    // ── Lighting ────────────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    const sun = new THREE.DirectionalLight(0xfffbe6, 1.2);
    sun.position.set(planSize * 0.6, planSize * 0.9, planSize * 0.5);
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0xc8d8ff, 0.4);
    fill.position.set(-planSize * 0.5, planSize * 0.3, -planSize * 0.4);
    scene.add(fill);

    // ── Materials ────────────────────────────────────────────────────────────
    const wallMat        = new THREE.MeshLambertMaterial({ color: 0xddd8cc });
    const wallMatGlass   = new THREE.MeshLambertMaterial({ color: 0xa8c8e8, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false });
    const floorMat       = new THREE.MeshLambertMaterial({ color: 0xf0ebe2, side: THREE.DoubleSide });
    const coreMat        = new THREE.MeshLambertMaterial({ color: 0xb06060 });

    // ── Floor slab ───────────────────────────────────────────────────────────
    const boundaryPoly = this._buildOrderedPoly(fp);
    if (boundaryPoly.length >= 3) {
      const shape = new THREE.Shape();
      boundaryPoly.forEach(({ x, y }, i) => {
        if (i === 0) shape.moveTo(toX(x), toSY(y));
        else         shape.lineTo(toX(x), toSY(y));
      });
      shape.closePath();
      const floorMesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), floorMat);
      floorMesh.rotation.x = -Math.PI / 2;
      scene.add(floorMesh);
    }

    // ── Boundary walls ───────────────────────────────────────────────────────
    // Opaque walls first so they write to the depth buffer before glass is blended.
    const boundaryEdges = (fp.wall_graph?.edges || []).filter(e => e.wallType !== 'core');
    for (const edge of boundaryEdges) {
      if (edge.translucent) continue;
      const n1 = getNodeById(nodes, edge.v1);
      const n2 = getNodeById(nodes, edge.v2);
      if (!n1 || !n2) continue;
      scene.add(this._wallBox(toX(n1.x), toZ(n1.y), toX(n2.x), toZ(n2.y), WALL_H, WALL_T, wallMat));
    }
    for (const edge of boundaryEdges) {
      if (!edge.translucent) continue;
      const n1 = getNodeById(nodes, edge.v1);
      const n2 = getNodeById(nodes, edge.v2);
      if (!n1 || !n2) continue;
      scene.add(this._wallBox(toX(n1.x), toZ(n1.y), toX(n2.x), toZ(n2.y), WALL_H, WALL_T, wallMatGlass));
    }

    // ── Core walls ────────────────────────────────────────────────────────────
    for (const edge of (fp.wall_graph?.edges || [])) {
      if (edge.wallType !== 'core') continue;
      const n1 = getNodeById(nodes, edge.v1);
      const n2 = getNodeById(nodes, edge.v2);
      if (!n1 || !n2) continue;
      scene.add(this._wallBox(
        toX(n1.x), toZ(n1.y),
        toX(n2.x), toZ(n2.y),
        WALL_H, WALL_T, coreMat,
      ));
    }

    // ── Columns ───────────────────────────────────────────────────────────────
    // col.x/y are canvas pixels; col.width is in mm (section dimension).
    const colMat = new THREE.MeshLambertMaterial({ color: 0x4a4a5a });
    const pxPerUnit = fp.units?.pxPerUnit || 1;
    const unit      = fp.units?.length    || 'm';
    const mmPerUnit = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[unit] ?? 1000;

    const defaultColPx = Math.max(4, (300 / mmPerUnit) * pxPerUnit); // 300mm fallback
    for (const col of (fp.Columns || [])) {
      if (col.x === undefined || col.y === undefined) continue;
      const wPx = col.width !== undefined ? (col.width / mmPerUnit) * pxPerUnit : defaultColPx;
      const dPx = col.depth !== undefined ? (col.depth / mmPerUnit) * pxPerUnit : wPx;
      const geo  = new THREE.BoxGeometry(wPx, WALL_H, dPx);
      const mesh = new THREE.Mesh(geo, colMat);
      mesh.position.set(toX(col.x), WALL_H / 2, toZ(col.y));
      scene.add(mesh);
    }

    // ── Structural beams ─────────────────────────────────────────────────────
    // Beams hang from the ceiling: top at WALL_H, bottom at WALL_H - depthPx.
    // Flange width approximated as depth × 0.5 (no separate width field in data).
    const beams   = (fp.Beams || []).filter(b => b.start && b.end);
    const beamMat = new THREE.MeshLambertMaterial({ color: 0x3a3a52 });
    for (const beam of beams) {
      const depthPx  = beam.depth !== undefined ? (beam.depth / mmPerUnit) * pxPerUnit : WALL_H * 0.15;
      const flangePx = depthPx * 0.5;
      const x1 = toX(beam.start.x), z1 = toZ(beam.start.y);
      const x2 = toX(beam.end.x),   z2 = toZ(beam.end.y);
      const length = Math.hypot(x2 - x1, z2 - z1);
      if (length < 0.5) continue;
      const geo  = new THREE.BoxGeometry(length, depthPx, flangePx);
      const mesh = new THREE.Mesh(geo, beamMat);
      mesh.position.set((x1 + x2) / 2, WALL_H - depthPx / 2, (z1 + z2) / 2);
      mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
      scene.add(mesh);
    }

    // ── Ducts ────────────────────────────────────────────────────────────────
    // duct[idA, idB, widthM, heightM, flow] — widthM/heightM in plan length units.
    // All ducts hang from the ceiling by default; segments crossing a beam are
    // lowered to pass under it (top of duct = bottom of beam).
    const pointMap = new Map();
    (fp.Points || []).forEach(p => { if (p.id) pointMap.set(p.id, p); });

    const beamTolPx    = pxPerUnit * 1.1;
    const PARALLEL_COS = 0.9;

    // Standard 2D signed-area cross product.
    const cross2d = (ox, oy, px, py, qx, qy) => (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
    // True only when both segment pairs strictly straddle each other.
    const segsCross = (ax, ay, bx, by, cx, cy, dx, dy) => {
      const d1 = cross2d(cx, cy, dx, dy, ax, ay), d2 = cross2d(cx, cy, dx, dy, bx, by);
      const d3 = cross2d(ax, ay, bx, by, cx, cy), d4 = cross2d(ax, ay, bx, by, dx, dy);
      return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
             ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
    };
    const ptSegDist = (px, py, ax, ay, bx, by) => {
      const dx = bx - ax, dy = by - ay, lenSq = dx * dx + dy * dy;
      const t  = lenSq < 1e-10 ? 0 : Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / lenSq));
      return Math.hypot(px - (ax + t*dx), py - (ay + t*dy));
    };

    // Returns the deepest beam depth (canvas px) that this duct segment must
    // go under, or 0 when no beam interaction is detected.
    const ductBeamDepthPx = (pAx, pAy, pBx, pBy) => {
      const ddx = pBx - pAx, ddy = pBy - pAy;
      const dlen = Math.hypot(ddx, ddy);
      let maxDepth = 0;
      for (const b of beams) {
        const { x: bsx, y: bsy } = b.start, { x: bex, y: bey } = b.end;
        const bdx = bex - bsx, bdy = bey - bsy;
        const blen = Math.hypot(bdx, bdy);
        if (blen < 1e-6) continue;
        // Exclude parallel duct segments (running alongside a beam, not across it).
        if (dlen > 1e-6 && Math.abs((ddx*bdx + ddy*bdy) / (dlen*blen)) > PARALLEL_COS) continue;
        const crosses = segsCross(pAx, pAy, pBx, pBy, bsx, bsy, bex, bey) ||
                        Math.min(ptSegDist(pAx, pAy, bsx, bsy, bex, bey),
                                 ptSegDist(pBx, pBy, bsx, bsy, bex, bey)) <= beamTolPx;
        if (crosses) maxDepth = Math.max(maxDepth, (b.depth ?? 300) / mmPerUnit * pxPerUnit);
      }
      return maxDepth;
    };

    const RISER_COLS = [0x00bcd4, 0xff9800, 0x8bc34a, 0xe91e63, 0x9c27b0, 0x03a9f4,
                        0xff5722, 0x4caf50, 0xf44336, 0x3f51b5];
    const ductMats = (fp.Duct_Plan || []).map((_, ri) =>
      new THREE.MeshLambertMaterial({ color: RISER_COLS[ri % RISER_COLS.length] })
    );

    (fp.Duct_Plan || []).forEach((riser, ri) => {
      const mat = ductMats[ri];
      for (const d of (riser.ducts || [])) {
        if (d.length !== 5) continue;
        const [idA, idB, widthM, heightM] = d;
        const pA = pointMap.get(idA), pB = pointMap.get(idB);
        if (!pA || !pB) continue;

        const widthPx  = widthM  * pxPerUnit;
        const heightPx = heightM * pxPerUnit;

        // Vertical position: hang from ceiling, drop below any crossed beam.
        const beamDropPx = ductBeamDepthPx(pA.x, pA.y, pB.x, pB.y);
        const centerY    = WALL_H - beamDropPx - heightPx / 2;

        const x1 = toX(pA.x), z1 = toZ(pA.y);
        const x2 = toX(pB.x), z2 = toZ(pB.y);
        const length = Math.hypot(x2 - x1, z2 - z1);
        if (length < 0.5) continue;

        const geo  = new THREE.BoxGeometry(length, heightPx, widthPx);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set((x1 + x2) / 2, centerY, (z1 + z2) / 2);
        mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
        scene.add(mesh);
      }
    });

    // ── Ground grid ──────────────────────────────────────────────────────────
    const grid = new THREE.GridHelper(planSize * 2.5, 20, 0x404055, 0x2a2a3a);
    grid.position.y = -1;
    scene.add(grid);

    // ── Camera ────────────────────────────────────────────────────────────────
    if (prevView) {
      this._restoreView(prevView);
    } else {
      const target = new THREE.Vector3(0, WALL_H * 0.4, 0);
      this._controls.target.copy(target);
      this._camera.position.set(planSize * 0.5, planSize * 0.5, planSize * 0.7);
      this._camera.lookAt(target);
      this._controls.update();
    }
  }

  // ── Geometry helpers ──────────────────────────────────────────────────────

  _buildOrderedPoly(fp) {
    const nodes = fp.wall_graph?.nodes || [];
    const edges = fp.wall_graph?.edges || [];

    // Only include boundary edges (skip core edges)
    const boundaryEdges = edges.filter(e => !e.wallType || e.wallType === 'boundary');
    if (nodes.length < 3 || boundaryEdges.length < 3) {
      return nodes.map(n => ({ x: n.x ?? n[0], y: n.y ?? n[1] }));
    }

    const nodeKey = n => n?.id ?? (Array.isArray(n) ? `${n[0]},${n[1]}` : `${n.x},${n.y}`);
    const edgeKey = r => typeof r === 'string' ? r : (r?.id ?? (Array.isArray(r) ? `${r[0]},${r[1]}` : `${r.x},${r.y}`));

    const coordOf = new Map();
    nodes.forEach(n => {
      const k = nodeKey(n);
      if (k) coordOf.set(k, { x: n.x ?? n[0], y: n.y ?? n[1] });
    });

    const adj = new Map();
    boundaryEdges.forEach(e => {
      const u = edgeKey(e.v1), v = edgeKey(e.v2);
      if (!u || !v) return;
      if (!adj.has(u)) adj.set(u, []);
      if (!adj.has(v)) adj.set(v, []);
      adj.get(u).push(v);
      adj.get(v).push(u);
    });

    const startKey = nodeKey(nodes[0]);
    if (!startKey || !adj.has(startKey)) {
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

    return poly.length >= 3 ? poly : nodes.map(n => ({ x: n.x ?? n[0], y: n.y ?? n[1] }));
  }

  _wallBox(x1, z1, x2, z2, height, thickness, material) {
    const length = Math.hypot(x2 - x1, z2 - z1);
    if (length < 0.5) return new THREE.Object3D();
    const geo  = new THREE.BoxGeometry(length, height, thickness);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set((x1 + x2) / 2, height / 2, (z1 + z2) / 2);
    mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    return mesh;
  }

  _captureView() {
    if (!this._camera || !this._controls) return null;
    return {
      position:   this._camera.position.clone(),
      quaternion: this._camera.quaternion.clone(),
      target:     this._controls.target.clone(),
    };
  }

  _restoreView({ position, quaternion, target }) {
    this._camera.position.copy(position);
    this._camera.quaternion.copy(quaternion);
    this._controls.target.copy(target);
    this._controls.update();
  }

  // ── Render loop ───────────────────────────────────────────────────────────

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

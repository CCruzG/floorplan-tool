// renderer/ui/ui.js


import { DrawingService } from '../drawing/drawingService.js';
import { findClosestProjection, findClosestSegment, findClosestNode, findClosestEdgeProjection } from '../drawing/geometry.js';
import { FloorPlan } from '../models/FloorPlan.js'; // adjust path if needed
import { setScalePixelsPerUnit, getPixelsPerUnit, getUnitLabel } from '../../config.js';
import { validateFloorPlan } from '../models/validation.js';
import { renderPrompt } from '../models/promptRenderer.js';

// import { DrawingService, findClosestBoundaryPoint } from '../drawing/drawingService.js';


export const SNAP_TO_NODE_DIST = 10;   // pixels
export const SNAP_TO_EDGE_DIST = 8;    // pixels


export function bindUI(store, canvas, mouse) {
  const ctx = canvas.getContext('2d');
  // initialize UI layer controls (hook into the active store)
  if (typeof setupLayerControls === 'function') setupLayerControls(store);

  // Redraw on store change
  store.onChange(() => {
    // console.log("store.mode: " + store.mode);
    DrawingService.render(ctx, store.active, {
      mode: store.mode,
      showVertices: true,
      ghost: mouse,
      constrain: mouse.constrain,
      tempArea: store.tempAreaActive ? store.tempArea : null,
      tempCore: store.tempCoreActive ? store.tempCore : null,
      // In area/core mode we should not show or highlight selected segments
      selectedSegment: (store.mode === 'area' || store.mode === 'core') ? null : store.active.selectedSegment
    });

    const indicator = document.getElementById('canvasModeIndicator');
    if (indicator) {
      indicator.textContent = `Mode: ${store.mode}`;
    }

    // Update JSON panel
    const jsonEl = document.getElementById('jsonOutput');
    if (jsonEl && store.active) {
      jsonEl.textContent = JSON.stringify(store.active.toJSON(), null, 2);
    }
  });

  // Mode controls (example buttons)
  const areaBtn = document.getElementById('areaModeBtn');
  if (areaBtn) {
    areaBtn.addEventListener('click', () => {
      store.setMode("area");
      store.tempAreaActive = true;
      store.notify();
    });
  }

  // Add Core mode button
  const coreBtn = document.getElementById('coreModeBtn');
  if (coreBtn) {
    coreBtn.addEventListener('click', () => {
      store.setMode("core");
      store.tempCoreActive = true;
      store.notify();
    });
  }

  // Lock button - toggle lock on selected segment
  const lockBtn = document.getElementById('lockBtn');
  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      if (store.mode === "edit") {
        const seg = store.active.selectedSegment;
        if (seg != null) {
          const edge = store.active.wall_graph.edges[seg];
          edge.locked = !edge.locked;
          store.update(store.active);
          console.log("Segment lock toggled", store.active.wall_graph.edges[seg].locked);
        }
      }
    });
  }

  // Track mouse movement and constraint flag (Shift key)
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
    // We only read modifier state during movement for visual cue
    mouse.constrain = e.shiftKey;
    store.notify(); // trigger a repaint to update ghost
  });

  canvas.addEventListener('mousedown', (e) => {
    if (store.mode === "edit" && store.active.selectedSegment) {
      const rect = canvas.getBoundingClientRect();
      store.dragStart = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
      store.active.draggingSegment = store.active.selectedSegment;
    }
  });

  canvas.addEventListener('mouseup', () => {
    if (store.mode === "edit" && store.active) {
      store.active.draggingSegment = null;
      store.dragStart = null;
      store.update(store.active); // commit final state
    }
  });

  document.getElementById("finishAreaBtn").addEventListener("click", () => {
    if (store.mode === "area") {
      commitArea(store);
    }
  });

  document.getElementById("finishCoreBtn").addEventListener("click", () => {
    if (store.mode === "core") {
      commitCore(store);
    }
  });

  canvas.addEventListener('click', (e) => {
    if (!store.active) return;

    const rect = canvas.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    if (store.mode === "area") {
      const rect = canvas.getBoundingClientRect();
      let x = e.clientX - rect.left;
      let y = e.clientY - rect.top;

      // Prefer node snap, then edge projection
      const nodeSnap = findClosestNode(store.active, { x, y }, SNAP_TO_NODE_DIST);
      const edgeSnap = nodeSnap ? null : findClosestEdgeProjection(store.active, { x, y }, SNAP_TO_EDGE_DIST);

      const constrain = e.shiftKey;
      // Determine previous temp point coordinates (if any) for constrain logic
      let last = store.tempArea.length ? store.tempArea[store.tempArea.length - 1] : null;
      let lastX = null, lastY = null;
      if (last) {
        if (typeof last === 'string') {
          const n = store.active.wall_graph.nodes.find(n => n.id === last);
          if (n) { lastX = n.x; lastY = n.y; }
        } else if (Array.isArray(last)) {
          lastX = last[0]; lastY = last[1];
        }
      }

      if (nodeSnap) {
        // If constrained, store coords aligned to the previous point (cannot
        // be represented as a node id anymore). If not constrained, store
        // the node id so it stays linked to the wall graph.
        const nx = nodeSnap.x, ny = nodeSnap.y;
        // Resolve the actual node id from the index returned by findClosestNode
        const nodeObj = store.active.wall_graph.nodes[nodeSnap.index];
        const nodeId = nodeObj ? nodeObj.id : null;
        store.tempAreaLastSnap = { ...nodeSnap, id: nodeId };
        if (constrain && lastX != null && lastY != null) {
          // Align either horizontally or vertically relative to last
          const dx = Math.abs(nx - lastX);
          const dy = Math.abs(ny - lastY);
          if (dx > dy) {
            // snap horizontally -> keep nx, set y to lastY
            x = nx; y = lastY;
          } else {
            // snap vertically -> keep ny, set x to lastX
            x = lastX; y = ny;
          }
          store.tempArea.push([x, y]);
          console.log("Snapped to node (constrained)", nodeSnap, "->", [x, y]);
        } else {
          x = nx; y = ny;
          console.log("Snapped to node", nodeSnap);
          // push the resolved node id so the area stays linked to the wall graph
          if (nodeId) store.tempArea.push(nodeId);
          else store.tempArea.push([x, y]);
        }
      } else if (edgeSnap) {
        const ex = edgeSnap.x, ey = edgeSnap.y;
        store.tempAreaLastSnap = edgeSnap;
        if (constrain && lastX != null && lastY != null) {
          const dx = Math.abs(ex - lastX);
          const dy = Math.abs(ey - lastY);
          if (dx > dy) { x = ex; y = lastY; } else { x = lastX; y = ey; }
          store.tempArea.push([x, y]);
          console.log("Snapped to edge (constrained)", edgeSnap, "->", [x, y]);
        } else {
          x = ex; y = ey;
          store.tempArea.push([x, y]);
          console.log("Snapped to edge projection", edgeSnap);
        }
      } else {
        store.tempAreaLastSnap = null;
        if (constrain && lastX != null && lastY != null) {
          const dx = Math.abs(x - lastX);
          const dy = Math.abs(y - lastY);
          if (dx > dy) { y = lastY; } else { x = lastX; }
          console.log('Constrained free point ->', [x, y]);
        }
        store.tempArea.push([x, y]);
      }

      store.tempAreaActive = true;

      // If clicking close to the first temp vertex, close the polygon
      // to match the boundary drawing UX (click the first point to close)
      if (store.tempArea.length >= 3) {
        const first = store.tempArea[0];
        let fx, fy;
        if (typeof first === 'string') {
          const n = store.active.wall_graph.nodes.find(n => n.id === first);
          if (n) { fx = n.x; fy = n.y; }
        } else if (Array.isArray(first)) {
          fx = first[0]; fy = first[1];
        }

        if (fx != null && fy != null) {
          const dx = Math.hypot(x - fx, y - fy);
          if (dx < SNAP_TO_NODE_DIST) {
            // Close and commit the area just like the boundary
            commitArea(store);
            refreshAreasList(store);
            store.setMode('edit');
            store.update(store.active);
            return;
          }
        }
      }

      store.notify();
      return;
    }

    // CORE MODE: similar to area drawing but for core boundaries
    if (store.mode === "core") {
      const rect = canvas.getBoundingClientRect();
      let x = e.clientX - rect.left;
      let y = e.clientY - rect.top;
      // Prefer node snap, then edge projection
      const nodeSnap = findClosestNode(store.active, { x, y }, SNAP_TO_NODE_DIST);
      const edgeSnap = nodeSnap ? null : findClosestEdgeProjection(store.active, { x, y }, SNAP_TO_EDGE_DIST);

      // Determine if the user requested constraint (Shift) to force
      // orthogonal (horizontal/vertical) alignment relative to the
      // previous tempCore vertex.
      const constrain = e.shiftKey;

      // Coordinates of the previous temp point (if any)
      const last = store.tempCore.length ? store.tempCore[store.tempCore.length - 1] : null;
      const lastX = last ? last[0] : null;
      const lastY = last ? last[1] : null;

      if (nodeSnap) {
        const nx = nodeSnap.x, ny = nodeSnap.y;
        store.tempCoreLastSnap = nodeSnap;
        if (constrain && lastX != null && lastY != null) {
          const dx = Math.abs(nx - lastX);
          const dy = Math.abs(ny - lastY);
          if (dx > dy) { x = nx; y = lastY; } else { x = lastX; y = ny; }
          console.log("Core: Snapped to node (constrained)", nodeSnap, "->", [x, y]);
        } else {
          x = nx; y = ny;
          console.log("Core: Snapped to node", nodeSnap);
        }
      } else if (edgeSnap) {
        const ex = edgeSnap.x, ey = edgeSnap.y;
        store.tempCoreLastSnap = edgeSnap;
        if (constrain && lastX != null && lastY != null) {
          const dx = Math.abs(ex - lastX);
          const dy = Math.abs(ey - lastY);
          if (dx > dy) { x = ex; y = lastY; } else { x = lastX; y = ey; }
          console.log("Core: Snapped to edge (constrained)", edgeSnap, "->", [x, y]);
        } else {
          x = ex; y = ey;
          console.log("Core: Snapped to edge projection", edgeSnap);
        }
      } else {
        store.tempCoreLastSnap = null;
        if (constrain && lastX != null && lastY != null) {
          const dx = Math.abs(x - lastX);
          const dy = Math.abs(y - lastY);
          if (dx > dy) { y = lastY; } else { x = lastX; }
          console.log('Core: Constrained free point ->', [x, y]);
        }
      }

      store.tempCore.push([x, y]);
      store.tempCoreActive = true;

      // If clicking close to the first temp vertex, close the core boundary
      if (store.tempCore.length >= 3) {
        const first = store.tempCore[0];
        const fx = first[0], fy = first[1];
        const dx = Math.hypot(x - fx, y - fy);
        if (dx < SNAP_TO_NODE_DIST) {
          // Close and commit the core boundary
          commitCore(store);
          store.setMode('edit');
          store.update(store.active);
          return;
        }
      }

      store.notify();
      return;
    }

    // EDIT MODE: select segment and return
    if (store.mode === "edit") {
      const seg = findClosestSegment(store.active, { x, y });
      if (seg) {
        store.active.selectSegment(seg);
        store.update(store.active);
        console.log("Selected segment", seg);
      } else {
        store.active.clearSelection();
        store.update(store.active);
      }
      return;
    }

    // ENTRANCE MODE - Now supports multiple entrances
    if (store.active.boundaryClosed && store.mode === "entrance") {
      const closest = DrawingService.findClosestBoundaryPoint(store.active, { x, y });
      if (closest) {
        store.active.addEntrance(closest.edgeId, closest.x, closest.y);
        store.update(store.active);
        console.log("Entrance added at", closest);
        // Don't auto-switch to edit mode, allow adding more entrances
        console.log(`Total entrances: ${store.active.entrances.length}`);
      }
      return;
    }

    // DRAW MODE: boundary creation
    if (store.active.wall_graph.nodes.length > 0) {
      const first = store.active.wall_graph.nodes[0];
      const fx = first.x;
      const fy = first.y;
      const dist = Math.hypot(x - fx, y - fy);
      if (dist < 10) {
        store.active.addVertex(fx, fy, { constrain: e.shiftKey });
        store.active.closeBoundary();
        store.update(store.active);
        console.log("Boundary closed");
        store.setMode("entrance");
        return;
      }
    }

    // Projection snapping
    const proj = findClosestProjection(store.active, { x, y });
    if (proj && Math.hypot(x - proj.x, y - proj.y) < 10) {
      x = proj.x;
      y = proj.y;
      console.log("Snapped to projection", proj);
    }

    // Add vertex to boundary
    store.active.addVertex(x, y, { constrain: e.shiftKey });
    store.update(store.active);
  });



  // Undo/redo shortcuts as before
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      if (e.shiftKey) store.redo();
      else store.undo();
    }
  });

  // Lock/unlock segment: L key
  window.addEventListener('keydown', (e) => {
    if (store.mode === "edit" && e.key.toLowerCase() === 'l') {
      const seg = store.active.selectedSegment;
      console.log("Testing L key. Segment: ", seg)
      if (seg != null) {
        console.log("Segment: ", seg);
        const edge = store.active.wall_graph.edges[seg];
        edge.locked = !edge.locked;
        store.update(store.active);
        // console.log("Segment lock toggled", seg.locked);
        console.log("Segment lock toggled", store.active.wall_graph.edges[seg].locked);
      }
    }
  });

  // Finish polygon: Enter or double-click
  window.addEventListener('keydown', (e) => {
    if (store.mode === "area" && e.key === "Enter") {
      commitArea(store);
      refreshAreasList(store);
    }
    // Core mode keyboard support
    if (store.mode === "core" && e.key === "Enter") {
      commitCore(store);
    }
    // Optional: Esc to cancel
    if (store.mode === "area" && e.key === "Escape") {
      store.resetTempArea();
    }
    if (store.mode === "core" && e.key === "Escape") {
      store.resetTempCore();
    }
    if (store.mode === "entrance" && e.key === "Escape") {
      store.setMode("edit");
      console.log("Exited entrance mode");
    }
  });

  canvas.addEventListener('dblclick', () => {
    if (store.mode === "area") {
      commitArea(store);
    }
    if (store.mode === "core") {
      commitCore(store);
    }
  });

  // Right-click to exit entrance mode
  canvas.addEventListener('contextmenu', (e) => {
    if (store.mode === "entrance") {
      e.preventDefault(); // Prevent context menu
      store.setMode("edit");
      console.log("Exited entrance mode (right-click)");
    }
  });

  // 👉 Add Clear button listener here
  const clearBtn = document.getElementById('clearBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      store.active = new FloorPlan();   // reset to a new empty plan
      store.setMode("draw");
      store.update(store.active);       // trigger re-render
      console.log("Canvas cleared, new floorplan started");
    });
  }

  // ═══════════════════════════════════════════════════════════
  // LAYER TOGGLE CONTROLS
  // ═══════════════════════════════════════════════════════════
  
  const layerCheckboxes = {
    planBoundaryLayer: 'Plan_Boundary',
    boundaryAreaLayer: 'Boundary_Area',
    coreBoundaryLayer: 'Core_Boundary',
    coreAreaLayer: 'Core_Area',
    columnsLayer: 'Columns',
    temperatureRegionsLayer: 'Temperature_Regions',
    beamsLayer: 'Beams',
    pointsLayer: 'Points',
    edgesLayer: 'Edges',
    ductsLayer: 'Ducts',
    ductPlanLayer: 'Duct_Plan'
  };

  Object.entries(layerCheckboxes).forEach(([checkboxId, layerName]) => {
    const checkbox = document.getElementById(checkboxId);
    if (checkbox) {
      // Set initial state - use default if store.active is null
      checkbox.checked = store.active?.layers?.[layerName] ?? (layerName === 'Plan_Boundary' || layerName === 'Boundary_Area' || layerName === 'Core_Boundary' || layerName === 'Core_Area' || layerName === 'Columns' || layerName === 'Temperature_Regions');
      
      // Add event listener
      checkbox.addEventListener('change', () => {
        if (store.active) {
          console.log(`Before: Layer ${layerName} = ${store.active.layers?.[layerName]}`);
          store.active.setLayerVisibility(layerName, checkbox.checked);
          console.log(`After: Layer ${layerName} = ${store.active.layers?.[layerName]}, checkbox = ${checkbox.checked}`);
          
          // Mark this checkbox as the one that triggered the change
          checkbox._justChanged = true;
          store.notify(); // Trigger re-render
          // Clear the flag after a short delay
          setTimeout(() => { checkbox._justChanged = false; }, 10);
        }
      });
    }
  });

  // Update layer checkboxes when store changes (e.g., after loading a file)
  store.onChange(() => {
    Object.entries(layerCheckboxes).forEach(([checkboxId, layerName]) => {
      const checkbox = document.getElementById(checkboxId);
      // Skip updating if this checkbox just triggered the change
      if (checkbox && !checkbox._justChanged && store.active && store.active.layers && layerName in store.active.layers) {
        checkbox.checked = store.active.layers[layerName];
      }
    });
  });

  // Save floorplan: serialise and send to main via preload API
  const saveFloorplanBtn = document.getElementById("saveFloorplanBtn");
  if (saveFloorplanBtn) {
    saveFloorplanBtn.addEventListener("click", async () => {
      if (!store.active) return;
      const data = store.active.toJSON();

      try {
        const result = await window.electronAPI.saveFloorplan({
          filenameSuggested: `floorplan-${store.active.name}.json`,
          payload: data
        });
        if (result?.success) {
          console.log("Floorplan saved:", result.path);
        } else {
          console.warn("Save cancelled or failed.");
        }
      } catch (err) {
        console.error("Save error:", err);
      }
    });
  }

  const openFloorplanBtn = document.getElementById("openFloorplanBtn");
  if (openFloorplanBtn) {
    openFloorplanBtn.addEventListener("click", async () => {
      try {
        const result = await window.electronAPI.openFloorplan();
        if (result?.success) {
          const fp = FloorPlan.fromJSON(result.data);
          // If the loaded file contains a Plan_Boundary (raw Pt_* keyed objects),
          // create a boundaryArea so the renderer (which draws boundaryArea) will
          // display the plan boundary immediately. This is a forgiving, schema-
          // agnostic approach to visualise legacy duct_plan.json files "as-is".
          try {
            const raw = result.data;
            if (!fp.boundaryArea && raw.Plan_Boundary && Array.isArray(raw.Plan_Boundary) && raw.Plan_Boundary.length) {
              // Normalize Plan_Boundary coordinates (assumed to be in mm) into
              // a 0..50000 coordinate space so large real-world values render
              // sensibly on the canvas. We preserve aspect ratio by scaling
              // uniformly to fit the largest dimension into 50000.
              const poly = raw.Plan_Boundary[0];
              const keys = Object.keys(poly || {}).sort((a, b) => {
                const ai = parseInt(a.split('_')[1] || '0', 10);
                const bi = parseInt(b.split('_')[1] || '0', 10);
                return ai - bi;
              });
              // Read raw coords (units as stored in the file, e.g., mm)
              const rawCoords = keys.map(k => poly[k]).filter(Boolean).map(v => [ Number(v[0] || 0), Number(v[1] || 0) ]).filter(c => !Number.isNaN(c[0]) && !Number.isNaN(c[1]));
              
              // Also extract Core_Boundary if present
              let rawCoreCoords = [];
              if (raw.Core_Boundary && Array.isArray(raw.Core_Boundary) && raw.Core_Boundary.length) {
                const corePoly = raw.Core_Boundary[0];
                const coreKeys = Object.keys(corePoly || {}).sort((a, b) => {
                  const ai = parseInt(a.split('_')[1] || '0', 10);
                  const bi = parseInt(b.split('_')[1] || '0', 10);
                  return ai - bi;
                });
                rawCoreCoords = coreKeys.map(k => corePoly[k]).filter(Boolean).map(v => [ Number(v[0] || 0), Number(v[1] || 0) ]).filter(c => !Number.isNaN(c[0]) && !Number.isNaN(c[1]));
              }

              // Also extract Columns if present
              let rawColumnsData = [];
              if (raw.Columns && Array.isArray(raw.Columns)) {
                rawColumnsData = raw.Columns.map(column => {
                  const keys = Object.keys(column || {}).sort((a, b) => {
                    const ai = parseInt(a.split('_')[1] || '0', 10);
                    const bi = parseInt(b.split('_')[1] || '0', 10);
                    return ai - bi;
                  });
                  return keys.map(k => column[k]).filter(Boolean).map(v => [ Number(v[0] || 0), Number(v[1] || 0) ]).filter(c => !Number.isNaN(c[0]) && !Number.isNaN(c[1]));
                }).filter(columnCoords => columnCoords.length > 0);
              }
              
              if (rawCoords.length) {
                // Compute combined bounding box for plan, core boundaries, and columns
                const allCoords = [...rawCoords, ...rawCoreCoords];
                rawColumnsData.forEach(columnCoords => allCoords.push(...columnCoords));
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                allCoords.forEach(([x, y]) => {
                  if (x < minX) minX = x; if (y < minY) minY = y;
                  if (x > maxX) maxX = x; if (y > maxY) maxY = y;
                });
                const width = Math.max(0, maxX - minX);
                const height = Math.max(0, maxY - minY);
                const maxDim = Math.max(width, height, 1);
                const scale = 50000 / maxDim;
                
                // Normalize plan boundary coords in [0,50000]
                const verts = rawCoords.map(([x, y]) => {
                  const nx = (x - minX) * scale;
                  const ny = (y - minY) * scale;
                  return [nx, ny];
                });
                
                // Normalize core boundary coords in [0,50000]
                const coreVerts = rawCoreCoords.map(([x, y]) => {
                  const nx = (x - minX) * scale;
                  const ny = (y - minY) * scale;
                  return [nx, ny];
                });

                // Normalize columns coords in [0,50000]
                const normalizedColumns = rawColumnsData.map(columnCoords => 
                  columnCoords.map(([x, y]) => {
                    const nx = (x - minX) * scale;
                    const ny = (y - minY) * scale;
                    return [nx, ny];
                  })
                );
                
                if (verts.length) {
                  fp.boundaryArea = { id: fp.boundaryArea?.id || 'boundary_0', label: 'boundary', vertices: verts };
                  
                  // Add normalized core boundary if present
                  if (coreVerts.length) {
                    fp.coreArea = { id: 'core_0', label: 'core', vertices: coreVerts };
                    console.log('Core boundary loaded with', coreVerts.length, 'vertices:', coreVerts);
                  }

                  // Add normalized columns if present
                  if (normalizedColumns.length) {
                    fp.columnsData = normalizedColumns.map((columnVerts, i) => ({
                      id: `column_${i}`,
                      label: `Column ${i + 1}`,
                      vertices: columnVerts
                    }));
                    console.log('Columns loaded:', fp.columnsData.length, 'columns');
                  }

                  // Initialize layer visibility controls
                  fp.layers = {
                    planBoundary: true,
                    coreBoundary: true,
                    columns: true
                  };
                  
                  // Request that the renderer show only the boundary vertices
                  // for this imported plan (minimal visualisation mode).
                  fp._renderOnlyBoundaryVertices = true;

                  // Compute a view transform so the normalized boundaries fit the
                  // canvas. Store in the floorplan so the renderer can apply it.
                  try {
                    const bbMinX = 0; // normalized coords start at 0
                    const bbMinY = 0;
                    // Get the actual max from the normalized coordinates
                    const allNormalizedCoords = [...verts, ...coreVerts];
                    normalizedColumns.forEach(columnVerts => allNormalizedCoords.push(...columnVerts));
                    const bbMaxX = allNormalizedCoords.length > 0 ? Math.max(...allNormalizedCoords.map(v => v[0])) : 0;
                    const bbMaxY = allNormalizedCoords.length > 0 ? Math.max(...allNormalizedCoords.map(v => v[1])) : 0;
                    const bbW = Math.max(1, bbMaxX - bbMinX);
                    const bbH = Math.max(1, bbMaxY - bbMinY);
                    const margin = 0.9; // keep 10% padding
                    const scaleX = canvas.width / bbW;
                    const scaleY = canvas.height / bbH;
                    const viewScale = Math.min(scaleX, scaleY) * margin;
                    const offsetX = (canvas.width - (bbW * viewScale)) / 2 - (bbMinX * viewScale);
                    const offsetY = (canvas.height - (bbH * viewScale)) / 2 - (bbMinY * viewScale);
                    fp._view = { scale: viewScale, offsetX, offsetY };
                    console.log('View transform:', fp._view);
                    console.log('Canvas size:', canvas.width, 'x', canvas.height);
                    console.log('Bounding box:', { bbMinX, bbMinY, bbMaxX, bbMaxY, bbW, bbH });
                  } catch (err) {
                    console.warn('Failed to compute view transform for boundary-only view', err);
                    fp._view = null;
                  }
                }
              }
            }
          } catch (err) {
            console.warn('Failed to create boundaryArea from Plan_Boundary', err);
          }
          store.add(fp);          // set as active + push to history
          store.setActive(fp);    // triggers notify()

          // Restore saved scale (if present) so measurements and GUI reflect
          // the plan's intended physical dimensions.
          if (fp.units && fp.units.pxPerUnit) {
            setScalePixelsPerUnit(fp.units.pxPerUnit, fp.units.length || 'mm');
            // Update canvas controls if present
            const valEl = document.getElementById('canvasWidthValue');
            const unitEl = document.getElementById('canvasUnitSelect');
            if (valEl && unitEl) {
              unitEl.value = fp.units.length || unitEl.value;
              // compute the numeric value in the chosen unit from canvas width
              const numeric = Math.round((document.getElementById('canvas').width / fp.units.pxPerUnit) * 100) / 100;
              valEl.value = numeric;
            }
          }
          store.setMode("edit");

          // Repopulate requirements form (guard each element in case UI panel
          // is not present in a minimal embed or during tests)
          const req = fp.requirements || {};
          const bedroomsEl = document.getElementById("bedroomsInput");
          if (bedroomsEl) bedroomsEl.value = req.bedrooms || 0;
          const bathroomsEl = document.getElementById("bathroomsInput");
          if (bathroomsEl) bathroomsEl.value = req.bathrooms || 0;
          const openKitchenEl = document.getElementById("openKitchenChk");
          if (openKitchenEl) openKitchenEl.checked = !!req.openKitchen;
          const balconyEl = document.getElementById("balconyChk");
          if (balconyEl) balconyEl.checked = !!req.balcony;
          const styleEl = document.getElementById("styleSelect");
          if (styleEl) styleEl.value = req.style || "";
          const notesEl = document.getElementById("notesInput");
          if (notesEl) notesEl.value = req.notes || "";
        }
      } catch (err) {
        console.error("Open error:", err);
      }
    });
  }

  const planNameInput = document.getElementById("planNameInput");
  if (planNameInput) {
    // Initialise field with current active plan name
    if (store.active) planNameInput.value = store.active.name;

    // Update store when user types
    planNameInput.addEventListener("input", () => {
      store.updateName(planNameInput.value.trim());
    });

    // Keep input in sync when store changes (e.g. after opening a file)
    store.onChange(() => {
      if (store.active && planNameInput.value !== store.active.name) {
        planNameInput.value = store.active.name;
      }
    });
  }

  const btnOptimise = document.getElementById('optimiseBtn');
  const aiDebug = document.getElementById('ai-debug');
  const aiError = document.getElementById('ai-error');

  if (btnOptimise) {
    btnOptimise.addEventListener('click', async () => {
      const fp = store.active;
      if (!fp) return;

    // 1) Serialize
    const planJson = fp.toJSON();

    // // 2) Validate
    // const result = validateFloorPlan(planJson);
    // if (!result.ok) {
    //   aiError.style.display = 'block';
    //   aiError.textContent = `Validation failed:\n- ${result.errors.join('\n- ')}`;
    //   aiDebug.style.display = 'none';
    //   return;
    // } else {
    //   aiError.style.display = 'none';
    // }

    // 3) Render prompt
    const prompt = renderPrompt(fp);
    // console.log("Generated prompt:\n", prompt);

    // 5) Send to local AI service (no validation for now)
    try {
      const res = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // model: "gpt-oss",
          model: "mistral-nemo",
          prompt: prompt,   // <-- your dynamic string
          stream: false
        })
      });

      if (!res.ok) {
        console.log("res not ok");
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      
      
      const data = await res.json();
      // const raw = await res.text();
      console.log("Raw service response: ", data.response);

      // Try to validate the returned JSON and perform a best-effort
      // sanitisation if it doesn't comply with the schema (common issues:
      // missing `units`, missing `entrances.edgeRef`).
      let candidate = typeof data.response === 'string' ? JSON.parse(data.response) : data.response;

      // If `units` missing, try to infer the unit used by the AI from the
      // magnitude of the returned coordinates, then set candidate.units and
      // an appropriate pxPerUnit so FloorPlan.fromJSON converts correctly.
      if (!candidate.units) {
        const nodes = (candidate.wall_graph && candidate.wall_graph.nodes) || [];
        let maxVal = 0;
        nodes.forEach(n => {
          if (n && typeof n.x === 'number' && typeof n.y === 'number') {
            maxVal = Math.max(maxVal, Math.abs(n.x), Math.abs(n.y));
          }
        });

        // Heuristic: if coordinates are large (>50) treat as mm, if medium
        // (10-50) treat as cm, otherwise meters.
        let inferredUnit = 'm';
        if (maxVal > 50) inferredUnit = 'mm';
        else if (maxVal > 10) inferredUnit = 'cm';

        const METERS = { mm: 0.001, cm: 0.01, m: 1 };
        const appUnit = getUnitLabel() || 'm';
        const pxPerApp = getPixelsPerUnit() || 1; // pixels per app unit
        // pxPerCandidate = pxPerApp * (metersPerCandidate / metersPerApp)
        const pxPerCandidate = pxPerApp * (METERS[inferredUnit] / METERS[appUnit]);

        candidate.units = { length: inferredUnit, pxPerUnit: pxPerCandidate };
      }

      // Ensure edges include a locked flag (default false) so schema validation
      // and subsequent code expecting the flag do not break.
      if (candidate.wall_graph && Array.isArray(candidate.wall_graph.edges)) {
        candidate.wall_graph.edges = candidate.wall_graph.edges.map(e => ({ ...e, locked: typeof e.locked === 'boolean' ? e.locked : false }));
      }

      // Ensure entrances have an edgeRef (best-effort: match nearest edge by projection)
      if (Array.isArray(candidate.entrances) && candidate.wall_graph && Array.isArray(candidate.wall_graph.edges) && Array.isArray(candidate.wall_graph.nodes)) {
        // helper: project point onto segment and compute distance
        function projPointToSeg(px, py, ax, ay, bx, by) {
          const vx = bx - ax, vy = by - ay;
          const wx = px - ax, wy = py - ay;
          const vv = vx*vx + vy*vy;
          const t = vv === 0 ? 0 : Math.max(0, Math.min(1, (wx*vx + wy*vy) / vv));
          const qx = ax + t*vx, qy = ay + t*vy;
          const dx = px - qx, dy = py - qy;
          return Math.hypot(dx, dy);
        }

        const nodesById = Object.fromEntries(candidate.wall_graph.nodes.map(n => [n.id, n]));
        candidate.entrances = candidate.entrances.map(ent => {
          if (!ent.edgeRef) {
            // find closest edge
            let best = null; let bestDist = Infinity;
            candidate.wall_graph.edges.forEach(edge => {
              const n1 = nodesById[edge.v1];
              const n2 = nodesById[edge.v2];
              if (!n1 || !n2) return;
              const d = projPointToSeg(ent.position.x, ent.position.y, n1.x, n1.y, n2.x, n2.y);
              if (d < bestDist) { bestDist = d; best = edge.id; }
            });
            if (best) ent.edgeRef = best;
          }
          return ent;
        });
      }

      // Validate the candidate plan JSON
      const valid = validateFloorPlan(candidate);
      if (!valid.ok) {
        // If still invalid, show errors and abort applying the plan
        aiError.style.display = 'block';
        aiError.textContent = `AI returned an invalid plan:\n- ${valid.errors.join('\n- ')}`;
        aiDebug.style.display = 'block';
        aiDebug.textContent = JSON.stringify(candidate, null, 2);
        return;
      }

      // Convert into a FloorPlan and apply
      const refined = FloorPlan.fromJSON(candidate);
      store.update(refined);

      aiError.style.display = "none"; // hide any previous error
    } catch (err) {
      aiError.style.display = "block";
      aiError.textContent = `AI service error: ${err.message}`;
    }

  });
  }

  // Wire color picker apply button (inside bindUI so `store` is available)
  const applyBtn = document.getElementById('applyAreaColorBtn');
  const colorPicker = document.getElementById('areaColorPicker');
  if (applyBtn && colorPicker) {
    applyBtn.addEventListener('click', () => {
      if (!store.active) return;
      // Resolve selected area id across boundaryArea, Temperature_Regions, and legacy areas
      const fallbackId = store.active.Temperature_Regions && store.active.Temperature_Regions.length ? store.active.Temperature_Regions[0].id : (store.active.areas && store.active.areas.length ? store.active.areas[0].id : null);
      const sel = store.selectedAreaId || fallbackId;
      if (!sel) return;

      // try boundaryArea
      if (store.active.boundaryArea && store.active.boundaryArea.id === sel) {
        // boundary area has no editable color/alpha for now
        return;
      }

      // try Temperature_Regions
      let region = (store.active.Temperature_Regions || []).find(r => r.id === sel);
      if (region) {
        const alphaInput = document.getElementById('areaAlphaRange');
        const alphaValueInput = document.getElementById('areaAlphaValue');
        const airInput = document.getElementById('areaAirReq');
        const labelInput = document.getElementById('areaLabelInput');
        const alpha = alphaInput ? parseFloat(alphaInput.value) : (region.alpha || 0.3);
        region.color = colorPicker.value;
        region.alpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.3;
        if (labelInput && labelInput.value) region.name = labelInput.value;
        if (airInput) region.air_requirement = Number.isFinite(parseFloat(airInput.value)) ? parseFloat(airInput.value) : region.air_requirement || 7.5;
        if (alphaValueInput) alphaValueInput.value = region.alpha.toFixed(2);
        store.update(store.active);
        refreshAreasList(store);
        return;
      }

      // fallback to legacy areas
      const area = store.active.areas.find(a => a.id === sel);
      if (area) {
        const alphaInput = document.getElementById('areaAlphaRange');
        const alphaValueInput = document.getElementById('areaAlphaValue');
        const airInput = document.getElementById('areaAirReq');
        const labelInput = document.getElementById('areaLabelInput');
        const alpha = alphaInput ? parseFloat(alphaInput.value) : (area.alpha || 0.3);
        area.color = colorPicker.value;
        area.alpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.3;
        if (labelInput && labelInput.value) area.label = labelInput.value;
        if (airInput) area.air_requirement = Number.isFinite(parseFloat(airInput.value)) ? parseFloat(airInput.value) : area.air_requirement || 7.5;
        if (alphaValueInput) alphaValueInput.value = area.alpha.toFixed(2);
        store.update(store.active);
        refreshAreasList(store);
      }
    });
  }

}

// Helper: commit the area, prompt for label, add to model, and reset temp state
function commitArea(store) {
  console.log("commit area has been called");
  if (store.tempArea.length < 3) return; // need at least a triangle
  // const label = prompt("Label for this area (e.g. private, common):");
  // if (!label) return;

  // Option 1: read from an input field in your HTML
  const labelInput = document.getElementById("areaLabelInput");
  const label = labelInput?.value?.trim() || "area";

  // Map temporary coordinate vertices back to existing node ids when
  // they are within snap tolerance. This keeps area vertices linked to
  // the wall graph when users snapped to nodes or constrained near them.
  const mapped = store.tempArea.map(v => {
    // already a node id
    if (typeof v === 'string') return v;
    if (!Array.isArray(v) || v.length < 2) return null;
    const [x, y] = v;
    // find closest node within snap distance
    const node = store.active.wall_graph.nodes.find(n => Math.hypot(n.x - x, n.y - y) <= SNAP_TO_NODE_DIST);
    if (node) return node.id;
    // otherwise keep coordinates
    return [x, y];
  }).filter(v => v !== null);

  // Resolve mapped entries to coordinates for Temperature_Regions
  const resolvedCoords = mapped.map(v => {
    if (typeof v === 'string') {
      const n = store.active.wall_graph.nodes.find(n => n.id === v);
      return n ? [n.x, n.y] : null;
    }
    return Array.isArray(v) && v.length >= 2 ? [v[0], v[1]] : null;
  }).filter(v => v !== null);

  let newId = null;
  // Prefer the model method when available, otherwise fall back to
  // creating a Temperature_Regions entry directly on the active object
  // (for cases where `store.active` is a plain object without methods).
  if (store.active && typeof store.active.addTemperatureRegion === 'function') {
    newId = store.active.addTemperatureRegion(label, 'internal', resolvedCoords, { color: null, alpha: 0.3 });
  } else {
    // create Pt_* keyed subregion from resolvedCoords
    const subregion = {};
    resolvedCoords.forEach((c, i) => { subregion[`Pt_${i}`] = [c[0], c[1]]; });
    if (resolvedCoords.length) subregion[`Pt_${resolvedCoords.length}`] = [resolvedCoords[0][0], resolvedCoords[0][1]];
    // generate an id
    const genId = (pref) => `${pref || 'tr'}_${Date.now()}_${Math.floor(Math.random()*1000)}`;
    const id = genId('tr');
    const region = {
      id,
      type: 'internal',
      name: label,
      color: null,
      alpha: 0.3,
      air_requirement: 7.5,
      subregions: [subregion],
      avg_load_per_point: 0,
      total_load: 0,
      total_area: 0,
      VAV_number: 1,
      entry_candidates: [[]],
      thermal_control_zones: []
    };
    if (!store.active.Temperature_Regions) store.active.Temperature_Regions = [];
    store.active.Temperature_Regions.push(region);
    newId = id;
  }
  // Auto-select the newly created area so the user can change its color immediately
  store.selectedAreaId = newId;
  store.update(store.active);       // commit to history
  store.tempArea = [];
  store.tempAreaActive = false;

  // Optionally switch back to edit mode
  store.setMode("edit");
}

function refreshAreasList(store) {
  const listEl = document.getElementById('areasList');
  if (!listEl) return;
  listEl.innerHTML = '';

  // Build combined list: boundaryArea, Temperature_Regions, then legacy areas
  const items = [];
  if (store.active.boundaryArea) items.push({ __type: 'boundary', id: store.active.boundaryArea.id, label: store.active.boundaryArea.label, source: store.active.boundaryArea });
  (store.active.Temperature_Regions || []).forEach(r => items.push({ __type: 'temp', id: r.id, label: r.name || `temp_${r.id}`, color: r.color, alpha: r.alpha, source: r }));
  (store.active.areas || []).forEach(a => items.push({ __type: 'legacy', id: a.id, label: a.label, color: a.color, alpha: a.alpha, source: a }));

  items.forEach(item => {
    const li = document.createElement('li');
    const labelSpan = document.createElement('span');
    labelSpan.textContent = item.label;
    labelSpan.style.cursor = 'pointer';
    labelSpan.onclick = () => {
      store.selectedAreaId = item.id;
      const picker = document.getElementById('areaColorPicker');
      if (picker) picker.value = item.color || '#c86464';
      const alphaInput = document.getElementById('areaAlphaRange');
      const alphaValueInput = document.getElementById('areaAlphaValue');
      const labelInput = document.getElementById('areaLabelInput');
      const airInput = document.getElementById('areaAirReq');
      if (labelInput) labelInput.value = item.label || '';
      // for Temperature_Regions the name is stored in `source.name`
      if (item.__type === 'temp' && item.source && item.source.name) {
        if (labelInput) labelInput.value = item.source.name;
      }
      if (picker) picker.value = item.color || '#c86464';
      if (alphaInput) alphaInput.value = typeof item.alpha === 'number' ? item.alpha : 0.3;
      if (alphaValueInput) alphaValueInput.value = typeof item.alpha === 'number' ? item.alpha.toFixed(2) : '0.30';
      if (airInput) airInput.value = (item.source && typeof item.source.air_requirement === 'number') ? String(item.source.air_requirement) : '7.5';
      Array.from(listEl.children).forEach(ch => ch.classList.remove('selected'));
      li.classList.add('selected');
    };
    li.appendChild(labelSpan);

    const sw = document.createElement('span');
    sw.style.display = 'inline-block';
    sw.style.width = '14px';
    sw.style.height = '14px';
    sw.style.marginLeft = '8px';
    sw.style.verticalAlign = 'middle';
    sw.style.border = '1px solid rgba(0,0,0,0.1)';
    if (item.color && typeof item.alpha === 'number') {
      sw.style.background = item.color;
      sw.style.opacity = String(item.alpha);
    } else {
      sw.style.background = item.color || '';
      sw.style.opacity = '';
    }
    li.appendChild(sw);

    const del = document.createElement('button');
    del.textContent = 'x';
    if (item.__type === 'boundary') {
      del.disabled = true;
      del.title = 'Boundary area cannot be deleted';
      li.style.fontWeight = '600';
      const badge = document.createElement('span');
      badge.textContent = ' (boundary)';
      badge.style.fontSize = '0.9em';
      badge.style.marginLeft = '6px';
      li.appendChild(badge);
    } else {
      del.onclick = () => {
        if (item.__type === 'temp') {
          const idx = (store.active.Temperature_Regions || []).findIndex(r => r.id === item.id);
          if (idx >= 0) store.active.Temperature_Regions.splice(idx, 1);
        } else if (item.__type === 'legacy') {
          const idx = (store.active.areas || []).findIndex(a => a.id === item.id);
          if (idx >= 0) store.active.areas.splice(idx, 1);
        }
        store.update(store.active);
        refreshAreasList(store);
      };
    }
    li.appendChild(del);
    listEl.appendChild(li);
  });
}

// Helper: commit the core boundary, add to model, and reset temp state
function commitCore(store) {
  console.log("commit core has been called");
  if (store.tempCore.length < 3) return; // need at least a triangle

  // Convert temp core coordinates to core boundary format
  const coreVertices = store.tempCore.map(v => [v[0], v[1]]);
  
  store.active.addCoreBoundary(coreVertices);
  store.update(store.active);       // commit to history
  store.tempCore = [];
  store.tempCoreActive = false;

  // Optionally switch back to edit mode
  store.setMode("edit");
  console.log("Core boundary added successfully");
}

  // Layer control functionality (exposed as a setup function so it can be
  // initialized from within `bindUI` where the `store` parameter exists).
  function setupLayerControls(store) {
    const layerControls = {
      planBoundaryLayer: 'planBoundary',
      coreBoundaryLayer: 'coreBoundary', 
      columnsLayer: 'columns',
      temperatureRegionsLayer: 'Temperature_Regions',
      beamsLayer: 'beams',
      pointsLayer: 'points',
      edgesLayer: 'edges',
      ductsLayer: 'ducts',
      ductPlanLayer: 'ductPlan'
    };

    Object.entries(layerControls).forEach(([elementId, layerKey]) => {
      const checkbox = document.getElementById(elementId);
      if (checkbox) {
        checkbox.addEventListener('change', () => {
          const fp = store.active;
          if (fp) {
            if (!fp.layers) fp.layers = {};
            fp.layers[layerKey] = checkbox.checked;
            // Trigger re-render
            store.notify();
          }
        });

        // Initialize checkbox state when plan changes
        store.onChange(() => {
          const fp = store.active;
          if (fp && fp.layers && fp.layers.hasOwnProperty(layerKey)) {
            checkbox.checked = fp.layers[layerKey];
          }
        });
      }
    });
  }

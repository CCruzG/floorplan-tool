// renderer/ui/ui.js


import { DrawingService } from '../drawing/drawingService.js';
import { findClosestProjection, findClosestSegment, findClosestNode, findClosestEdgeProjection } from '../drawing/geometry.js';
import { FloorPlan } from '../models/FloorPlan.js'; // adjust path if needed
import { setScalePixelsPerUnit } from '../../config.js';
import { validateFloorPlan } from '../models/validation.js';
import { renderPrompt } from '../models/promptRenderer.js';

// import { DrawingService, findClosestBoundaryPoint } from '../drawing/drawingService.js';


export const SNAP_TO_NODE_DIST = 10;   // pixels
export const SNAP_TO_EDGE_DIST = 8;    // pixels


export function bindUI(store, canvas, mouse) {
  const ctx = canvas.getContext('2d');

  // --- Requirements form live binding ---
  const reqFields = {
    bedrooms: document.getElementById("bedroomsInput"),
    bathrooms: document.getElementById("bathroomsInput"),
    openKitchen: document.getElementById("openKitchenChk"),
    balcony: document.getElementById("balconyChk"),
    style: document.getElementById("styleSelect"),
    notes: document.getElementById("notesInput")
  };

  function readRequirementsFromForm() {
    return {
      bedrooms: parseInt(reqFields.bedrooms.value, 10) || 0,
      bathrooms: parseInt(reqFields.bathrooms.value, 10) || 0,
      openKitchen: reqFields.openKitchen.checked,
      balcony: reqFields.balcony.checked,
      style: reqFields.style.value,
      notes: reqFields.notes.value.trim()
    };
  }

  // Attach listeners for live updates
  Object.values(reqFields).forEach(el => {
    el.addEventListener("input", () => {
      store.updateRequirements(readRequirementsFromForm());
    });
    el.addEventListener("change", () => {
      store.updateRequirements(readRequirementsFromForm());
    });
  });

  // Redraw on store change
  store.onChange(() => {
    // console.log("store.mode: " + store.mode);
    DrawingService.render(ctx, store.active, {
      mode: store.mode,
      showVertices: true,
      ghost: mouse,
      constrain: mouse.constrain,
      tempArea: store.tempAreaActive ? store.tempArea : null,
      // In area mode we should not show or highlight selected segments
      selectedSegment: store.mode === 'area' ? null : store.active.selectedSegment
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
        store.tempAreaLastSnap = nodeSnap;
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
          store.tempArea.push(nodeSnap.id);
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

    // ENTRANCE MODE
    if (store.active.boundaryClosed && store.mode === "entrance") {
      if (store.active.entrances.length === 0) {
        const closest = DrawingService.findClosestBoundaryPoint(store.active, { x, y });
        if (closest) {
          store.active.addEntrance(closest.edgeId, closest.x, closest.y);
          store.update(store.active);
          console.log("Entrance added at", closest);
          store.setMode("edit");
          console.log("Switched to edit mode");
        }
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
    // Optional: Esc to cancel
    if (store.mode === "area" && e.key === "Escape") {
      store.resetTempArea();
    }
  });

  canvas.addEventListener('dblclick', () => {
    if (store.mode === "area") {
      commitArea(store);
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

          // Repopulate requirements form
          const req = fp.requirements || {};
          document.getElementById("bedroomsInput").value = req.bedrooms || 0;
          document.getElementById("bathroomsInput").value = req.bathrooms || 0;
          document.getElementById("openKitchenChk").checked = !!req.openKitchen;
          document.getElementById("balconyChk").checked = !!req.balcony;
          document.getElementById("styleSelect").value = req.style || "";
          document.getElementById("notesInput").value = req.notes || "";
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

  const btnRefine = document.getElementById('btn-refine-ai');
  const aiDebug = document.getElementById('ai-debug');
  const aiError = document.getElementById('ai-error');

  btnRefine.addEventListener('click', async () => {
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

      // Directly apply refined plan (skip validation)
      const refined = FloorPlan.fromJSON(data.response);
      store.update(refined);

      aiError.style.display = "none"; // hide any previous error
    } catch (err) {
      aiError.style.display = "block";
      aiError.textContent = `AI service error: ${err.message}`;
    }

  });

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

  store.active.addArea(label, mapped);
  store.update(store.active);       // commit to history
  store.tempArea = [];
  store.tempAreaActive = false;

  // Optionally switch back to edit mode
  store.setMode("edit");
}

function refreshAreasList(store) {
  const listEl = document.getElementById("areasList");
  if (!listEl) return;
  listEl.innerHTML = "";
  store.active.areas.forEach(area => {
    const li = document.createElement("li");
    li.textContent = area.label;
    // Optional: delete button
    const del = document.createElement("button");
    del.textContent = "x";
    // Do not allow deleting the canonical boundary area from the UI
    if (area.label === 'boundary') {
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
        store.active.removeArea(area.id);
        store.update(store.active);
        refreshAreasList(store);
      };
    }
    li.appendChild(del);
    listEl.appendChild(li);
  });
}


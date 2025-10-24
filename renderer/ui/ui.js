// renderer/ui/ui.js


import { DrawingService } from '../drawing/drawingService.js';
import { findClosestProjection, findClosestSegment, findClosestNode, findClosestEdgeProjection } from '../drawing/geometry.js';
import { FloorPlan } from '../models/FloorPlan.js'; // adjust path if needed
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
      selectedSegment: store.active.selectedSegment
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

      if (nodeSnap) {
        x = nodeSnap.x; y = nodeSnap.y;
        store.tempAreaLastSnap = nodeSnap;
        console.log("Snapped to node", nodeSnap);
      } else if (edgeSnap) {
        x = edgeSnap.x; y = edgeSnap.y;
        store.tempAreaLastSnap = edgeSnap;
        console.log("Snapped to edge projection", edgeSnap);
      } else {
        store.tempAreaLastSnap = null;
      }

      store.tempArea.push([x, y]);
      store.tempAreaActive = true;
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
          model: "gpt-oss",
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

  store.active.addArea(label, store.tempArea);
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
    del.onclick = () => {
      store.active.removeArea(area.id);
      store.update(store.active);
      refreshAreasList(store);
    };
    li.appendChild(del);
    listEl.appendChild(li);
  });
}


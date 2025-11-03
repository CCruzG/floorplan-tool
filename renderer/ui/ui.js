// renderer/ui/ui.js


import { DrawingService } from '../drawing/drawingService.js';
import { findClosestProjection, findClosestSegment, findClosestNode, findClosestEdgeProjection } from '../drawing/geometry.js';
import { FloorPlan } from '../models/FloorPlan.js'; // adjust path if needed
import { setScalePixelsPerUnit, getPixelsPerUnit, getUnitLabel } from '../../config.js';
import { validateFloorPlan } from '../models/validation.js';
import { renderPrompt } from '../models/promptRenderer.js';
import { evaluateRequirements } from '../models/requirementsEvaluator.js';

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

    // Update feasibility panel when requirements or boundary change
    const feasEl = document.getElementById('feasibilityPanel');
    if (feasEl && store.active) {
      try {
        const report = evaluateRequirements(store.active);
        const statusEl = document.getElementById('feasibilityStatus');
        const summaryEl = document.getElementById('feasibilitySummary');
        if (statusEl && summaryEl) {
          statusEl.className = 'status ' + (report.feasible ? 'ok' : 'warn');
          statusEl.textContent = report.feasible ? 'Feasible' : 'Not feasible';
          summaryEl.textContent = (report.summary || '') + ' ' + ((report.suggestions || []).slice(0,3).join('; '));
        } else {
          // Backward compatible: if markup isn't present, fall back to simple text
          feasEl.textContent = (report.summary || '') + ' ' + ((report.suggestions || []).slice(0,3).join('; '));
          feasEl.dataset.status = report.feasible ? 'ok' : 'warn';
        }
      } catch (err) {
        const statusEl = document.getElementById('feasibilityStatus');
        const summaryEl = document.getElementById('feasibilitySummary');
        if (statusEl) {
          statusEl.className = 'status unknown';
          statusEl.textContent = 'Unknown';
        }
        if (summaryEl) summaryEl.textContent = 'Feasibility: unavailable';
      }
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

  // Wire color picker apply button (inside bindUI so `store` is available)
  const applyBtn = document.getElementById('applyAreaColorBtn');
  const colorPicker = document.getElementById('areaColorPicker');
  if (applyBtn && colorPicker) {
    applyBtn.addEventListener('click', () => {
      if (!store.active) return;
      const sel = store.selectedAreaId || (store.active.areas.length ? store.active.areas[0].id : null);
      if (!sel) return;
      const area = store.active.areas.find(a => a.id === sel);
      if (!area) return;
      const alphaInput = document.getElementById('areaAlphaRange');
      const alphaValueInput = document.getElementById('areaAlphaValue');
      const alpha = alphaInput ? parseFloat(alphaInput.value) : (area.alpha || 0.3);
      // ensure numeric range
      area.color = colorPicker.value;
      area.alpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.3;
      // sync numeric input display
      if (alphaValueInput) alphaValueInput.value = area.alpha.toFixed(2);
      store.update(store.active);
      refreshAreasList(store);
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

  const newId = store.active.addArea(label, mapped);
  // Auto-select the newly created area so the user can change its color immediately
  store.selectedAreaId = newId;
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
    // make the list item clickable to select the area
    const labelSpan = document.createElement('span');
    labelSpan.textContent = area.label;
    labelSpan.style.cursor = 'pointer';
    labelSpan.onclick = () => {
      store.selectedAreaId = area.id;
      // reflect selection in the UI (e.g. set color picker)
      const picker = document.getElementById('areaColorPicker');
      if (picker) picker.value = area.color || '#c86464';
      const alphaInput = document.getElementById('areaAlphaRange');
      const alphaValueInput = document.getElementById('areaAlphaValue');
      if (alphaInput) alphaInput.value = typeof area.alpha === 'number' ? area.alpha : 0.3;
      if (alphaValueInput) alphaValueInput.value = typeof area.alpha === 'number' ? area.alpha.toFixed(2) : '0.30';
      // highlight the selected list item
      Array.from(listEl.children).forEach(ch => ch.classList.remove('selected'));
      li.classList.add('selected');
    };
    li.appendChild(labelSpan);

    // small swatch showing current color
    const sw = document.createElement('span');
    sw.style.display = 'inline-block';
    sw.style.width = '14px';
    sw.style.height = '14px';
    sw.style.marginLeft = '8px';
    sw.style.verticalAlign = 'middle';
    sw.style.border = '1px solid rgba(0,0,0,0.1)';
    // prefer to show color with alpha if available
    if (area.color && typeof area.alpha === 'number') {
      // convert hex to rgba for display
      sw.style.background = area.color;
      sw.style.opacity = String(area.alpha);
    } else {
      sw.style.background = area.color || '';
      sw.style.opacity = '';
    }
    li.appendChild(sw);
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

  // (moved into bindUI where `store` is in scope)


// renderer/index.js
import { FloorPlanStore } from './state/store.js';
import { FloorPlan } from './models/FloorPlan.js';
import { DrawingService } from './drawing/drawingService.js';
import { bindUI } from './ui/ui.js';
import { setScalePixelsPerUnit } from '../config.js';

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

const store = new FloorPlanStore();
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// Scale control: numeric width + unit selection
const canvasWidthValue = document.getElementById('canvasWidthValue');
const canvasUnitSelect = document.getElementById('canvasUnitSelect');

function parseUnitValue(value, unit) {
  // value is the number in the chosen unit; we will treat it directly as "units"
  // pxPerUnit = canvas.width / value
  const v = parseFloat(value);
  if (!isFinite(v) || v <= 0) return null;
  return v;
}

function updateScaleFromInput() {
  const val = parseUnitValue(canvasWidthValue?.value, canvasUnitSelect?.value);
  const unit = canvasUnitSelect?.value || 'mm';
  if (!val) return;

  const pxPerUnit = canvas.width / val; // pixels per (selected unit)
  setScalePixelsPerUnit(pxPerUnit, unit);

  // store the scale on the active floorplan so it's included on save
  if (store.active) {
    store.active.units = { length: unit, pxPerUnit };
  }

  // trigger a redraw / JSON panel update
  store.notify();
}

if (canvasWidthValue && canvasUnitSelect) {
  canvasWidthValue.addEventListener('change', updateScaleFromInput);
  canvasWidthValue.addEventListener('input', updateScaleFromInput);
  canvasUnitSelect.addEventListener('change', updateScaleFromInput);
  // initialize
  updateScaleFromInput();
}

// Track mouse and constraint state centrally
const mouse = { x: 0, y: 0, constrain: false };

// Subscribe to store and render
store.onChange(() => {
  // Instrumented rendering: wrap render with a small diagnostic log so we
  // can confirm the renderer pipeline is being invoked during smoke tests.
  try {
    DrawingService.render(ctx, store.active, {
      showVertices: true,
      ghost: mouse,
      constrain: mouse.constrain
    });
    // console.log('[renderer] DrawingService.render invoked', {
    //   boundaryClosed: !!store.active?.boundaryClosed,
    //   nodes: (store.active?.wall_graph?.nodes || []).length,
    //   edges: (store.active?.wall_graph?.edges || []).length,
    //   areas: (store.active?.areas || []).length,
    //   entrances: (store.active?.entrances || []).length
    // });
  } catch (err) {
    console.error('[renderer] Error during DrawingService.render', err);
  }

  const out = document.getElementById("jsonOutput");
  if (out) out.textContent = JSON.stringify(store.active, null, 2);
});

// Bind UI events (will update mouse and call store.update as needed)
bindUI(store, canvas, mouse);

// Start with one plan
store.add(new FloorPlan('Plan 1'));

// renderer/index.js
import { FloorPlanStore } from './state/store.js';
import { FloorPlan } from './models/FloorPlan.js';
import { DrawingService } from './drawing/drawingService.js';
import { bindUI } from './ui/ui.js';

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

// Track mouse and constraint state centrally
const mouse = { x: 0, y: 0, constrain: false };

// Subscribe to store and render
store.onChange(() => {
  DrawingService.render(ctx, store.active, {
    showVertices: true,
    ghost: mouse,
    constrain: mouse.constrain
  });

  document.getElementById("jsonOutput").textContent =
    JSON.stringify(store.active, null, 2);
});

// Bind UI events (will update mouse and call store.update as needed)
bindUI(store, canvas, mouse);

// Start with one plan
store.add(new FloorPlan('Plan 1'));

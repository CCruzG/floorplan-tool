import { History } from './history.js';
import { FloorPlan } from '../models/FloorPlan.js';

export class FloorPlanStore {
  constructor() {
    this.floorplans = [];
    this.active = null;
    this.history = new Map(); // name → History
    this.listeners = [];
    this.mode = "draw" //draw | entrance | edit | area

    // Temporary UI state (not persisted to history)
    this.dragStart = null;       // { x, y } when a drag begins
    this.tempArea = [];
    this.tempActiveArea = false;
    this.tempAreaLastSnap = null;  // { type: "node"|"edge", index, x, y } or null
  }

  add(fp) {
    this.floorplans.push(fp);
    const hist = new History();
    hist.push(fp);                  // push initial state
    this.history.set(fp.name, hist);
    this.setActive(fp);
  }

  setActive(fp) {
    this.active = fp;
    this.notify();
  }

  setMode(mode) {
    this.mode = mode;
    if (mode !== "area") {
      // this.tempArea = [];
      this.tempAreaActive = true;
    } else {
      this.tempArea = [];
      this.tempActiveArea = false;
    }
    this.notify();
  }

  resetTempArea() {
    this.tempArea = [];
    this.tempAreaActive = false;
    this.notify();
  }

  update(fp) {
    if (!this.history.has(fp.name)) {
      const hist = new History();
      hist.push(fp);
      this.history.set(fp.name, hist);
    } else {
      this.history.get(fp.name).push(fp);
    }
    this.notify();
  }
  updateName(newName) {
    if (!this.active) return;
    this.active.setName(newName);
    this.update(this.active); // push to history + notify
  }
  updateRequirements(req) {
    if (!this.active) return;
    this.active.setRequirements(req);
    this.update(this.active); // push to history
  }

  undo() {
    const hist = this.history.get(this.active.name);
    const prev = hist?.undo();
    if (prev) { this.active = prev; this.notify(); }
  }

  redo() {
    const hist = this.history.get(this.active.name);
    const next = hist?.redo();
    if (next) { this.active = next; this.notify(); }
  }

  clear() {
    const fp = new FloorPlan();
    fp.mode = 'draw'
    this.floorplans = [fp];
    this.history = new Map();
    const hist = new History();
    hist.push(fp);
    this.history.set(fp.name, hist);
    this.setActive(fp);
    // this.mode = "draw";
    // trigger a redraw immediately
    // this.notify();
  }

  onChange(cb) { this.listeners.push(cb); }
  notify() { this.listeners.forEach(cb => cb(this)); }
}
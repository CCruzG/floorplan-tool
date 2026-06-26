# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # install dependencies
npm start         # run the Electron app (development)
npm run dist      # build macOS distributable (.dmg + .zip for arm64 and x64)

# Manual serialization check (no test framework required)
node scripts/serialization-check.js
```

There is no automated test suite. Manual checks live in `scripts/`. The serialization check exercises `FloorPlan.toJSON()` → `FloorPlan.fromJSON()` round-trip.

## Architecture

This is an **Electron desktop app** with a clear main/renderer split:

- **`main.js`** — Electron main process. Handles IPC for file I/O (`save-floorplan`, `open-floorplan`, `save-floorplan-silent`) and reference image/PDF import (`pick-reference-asset`). Exposes no Node APIs directly to the renderer.
- **`preload.js`** — Bridges the main process and renderer via `contextBridge`, exposing `window.electronAPI`.
- **`renderer/`** — All UI and application logic runs here as ES modules loaded by `renderer/index.html`.

### Renderer layer structure

```
renderer/
  index.js             # app entry point — wires store, UI, and drawing loop
  models/
    FloorPlan.js        # central data model: boundary, cores, grid, exclusion areas, JSON I/O
    elements.js         # element constructors (walls, openings, grid points, etc.)
    floorPlanUtils.js   # geometry and model helpers
    validation.js       # plan validation helpers
    roomDefaults.js     # default room/wall property values
    promptTemplate.js   # LLM prompt generation scaffolding
    requirementsEvaluator.js
  state/
    store.js            # FloorPlanStore — holds active plan, mode, undo/redo history
    history.js          # History stack (push/undo/redo)
  drawing/
    drawingService.js   # render orchestration — drives the canvas draw loop
    renderers.js        # canvas 2D rendering for walls, grid, areas, previews
    geometry.js         # snapping, closest-segment, projection math
    view3d.js           # Three.js 3D preview (uses vendor/three.module.js)
  ui/
    ui.js               # all UI wiring: toolbar, inspector, panels, keyboard shortcuts
    labels.js           # canvas label rendering helpers
  api/
    apiService.js       # HTTP client for BuildWeave Flask optimisation server (localhost:5001)
  vendor/               # vendored Three.js (three.module.js, three.core.js, OrbitControls.js)
  index.html            # panel and toolbar layout
  styles.css            # application styling
config.js               # unit scale helpers (px ↔ metres/mm/etc.)
```

### Data flow

1. `FloorPlanStore` (singleton in `store.js`) is the source of truth. It holds the active `FloorPlan`, current interaction `mode`, temporary drawing state, and a per-plan `History` stack.
2. UI events in `ui.js` mutate the store by calling methods on the active `FloorPlan` then calling `store.update(fp)` to push a history snapshot and notify listeners.
3. `drawingService.js` subscribes to store changes and re-renders the canvas via `renderers.js`.
4. Save/load goes through `window.electronAPI` (IPC to `main.js`). The JSON format is schema `2.1.0` — see `DOCUMENTATION.md` for the full shape.

### Backend integration

`apiService.js` communicates with a BuildWeave Flask server at `http://127.0.0.1:5001`. Key functions:
- `floorplanToInstance(planJson, units)` — converts `FloorPlan.toJSON()` output to BuildWeave instance format (converting all coordinates to millimetres).
- `startOptimisation / pollOptimisation` — async job polling pattern; `runOptimisation` is deprecated.

The backend is external to this repo and must be running separately.

### JSON schema versioning

- Current export: schema `2.1.0` (via `FloorPlan.toJSON()`).
- Loader (`FloorPlan.fromJSON()`) detects version and supports legacy v1 and v2 files.
- The server accepts both `core` (legacy) and `cores` (v2 array) payload shapes.
- Coordinates are snapped to integers within `0.001` during serialization to reduce floating-point noise.

### Interaction modes

The store's `mode` field drives all interaction behavior in `ui.js` and `renderers.js`:
`select` | `draw` | `entrance` | `area` | `core` | `column` | `beam`

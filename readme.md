# Floorplan Tool

Electron desktop app / browser-based editor for HVAC services optimisation. Draw a floor plan, assign thermal zones and entry points, and run BuildWeave optimisation to generate duct-routing and structural solutions.

---

## Running locally (web mode)

This is the quickest way to test the tool without installing Electron.

**Prerequisites:** Node.js v18+ and npm. Use Chrome or Edge (required for the File System Access API — save/open won't work in Firefox or Safari).

```bash
git clone https://github.com/CCruzG/floorplan-tool.git
cd floorplan-tool
npm install
npm run web
```

The app opens at **http://localhost:5173** in your default browser. If it doesn't open automatically, navigate there manually.

> **Backend:** The tool expects the BuildWeave optimisation server running at `http://127.0.0.1:5001`. The status indicator in the top bar turns green when it is reachable. If the server is on a different host or port, update `API_BASE` in `renderer/api/apiService.js`.

---

## Typical workflow

1. **Draw the boundary** — click to place vertices; close by clicking near the first point.
2. **Add a service core** — use the Add Core tool; core walls are selectable and editable.
3. **Add exclusion areas** — mark areas where ducts cannot run.
4. **Place wall openings** — use Place Door to add openings on any wall segment.
5. **Generate the routing grid** — pick a boundary node as the origin.
6. **Assign thermal zones** — open the Thermal Zones panel. Click a region on the canvas to select it; shift-click to build a multi-region selection.
7. **Link entry points to regions** — select one or more canvas regions, then click an entry-point grid point on the canvas to assign all selected regions to it.
8. **Run optimisation** — use the Run Structural, Run Thermal, or Run Ducts buttons. Results appear in the Results panel.
9. **Save / Load** — use the toolbar buttons. Chrome/Edge will prompt you with a native file picker; other browsers will trigger a download for Save and a file input for Open.

---

## Key panels

| Panel | Purpose |
|---|---|
| Inspector | Properties for the selected wall, core, or grid point(s) |
| Canvas Grid | Snapping and grid-line intensity controls |
| Grid Generation | Routing-grid spacing and origin-picking |
| Exclusion Areas | List and manage no-go areas |
| Thermal Zones | Zone layout, sub-region display, entry-point assignment |
| Layers | Toggle visibility for boundary, cores, columns, beams, grid, ducts |
| Results | Optimisation output — structural and duct plans |

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Cmd/Ctrl + Z` | Undo |
| `Cmd/Ctrl + Shift + Z` | Redo |
| `Shift` | Constrain drawing to snapped angles |
| `L` | Lock / unlock selected wall segment |
| `Enter` | Finish current area or core polygon |
| `Escape` | Cancel current action / clear selection |
| `Delete` / `Backspace` | Delete selected core |

---

## Electron desktop app (optional)

If you prefer a native desktop app rather than the browser:

```bash
npm start
```

To build a distributable (macOS only):

```bash
npm run dist
```

Produces a `.dmg` and `.zip` under `dist/` for `arm64` and `x64`.

---

## Project structure

```
renderer/
  index.html             # panel and toolbar layout
  styles.css             # application styling
  index.js               # app entry point
  models/
    FloorPlan.js         # central data model and JSON serialisation
  state/
    store.js             # active plan, mode, undo/redo history
  drawing/
    renderers.js         # canvas 2D rendering
    drawingService.js    # render loop orchestration
    geometry.js          # snapping and projection math
  ui/
    ui.js                # all UI wiring: toolbar, panels, shortcuts
  api/
    apiService.js        # HTTP client for the BuildWeave Flask server
    electronCompat.js    # browser shim for Electron file/IPC APIs
```

See [DOCUMENTATION.md](DOCUMENTATION.md) for the full feature and data-model reference.

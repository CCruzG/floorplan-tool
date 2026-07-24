# Floorplan Tool

Electron desktop app for HVAC services optimisation. Draw a floor plan, assign structural and thermal zones, and run BuildWeave optimisation to generate duct-routing and structural solutions.

## Prerequisites

- **Node.js** v18 or later (v20+ recommended)
- **npm** v9 or later
- **Python 3.10+** with the BuildWeave server (see [Server Setup](#server-setup))

## Installation

```bash
git clone https://github.com/CCruzG/floorplan-tool.git
cd floorplan-tool
npm install
```

## Running

### Desktop app (Electron)
```bash
npm start
```

### Browser (development web server)
```bash
npm run web
```
Opens at `http://localhost:5173`. The web mode uses a browser-native shim in place of Electron IPC — file save/open uses the browser File System Access API.

### Build distributable (macOS)
```bash
npm run dist
```
Produces a `.dmg` and `.zip` under `dist/` for both `arm64` and `x64`.

---

## Server Setup

The optimisation solver runs as a separate Flask server. It lives in `../Project-71/`.

### 1. Install Python dependencies

```bash
cd ../Project-71
pip install flask flask-cors shapely networkx scipy scikit-learn matplotlib minizinc PySCIPOpt
pip install -r requirements.txt
```

> **MiniZinc** must also be installed at the system level and available on `PATH`. Download from [minizinc.org](https://www.minizinc.org/).

### 2. Start the server

```bash
cd ../Project-71
python server.py
```

The server listens on `http://127.0.0.1:5001`. The UI shows a green status indicator when it is reachable.

---

## Typical Workflow

1. **Draw the boundary** — click to place vertices; close by clicking near the first point.
2. **Add a service core** — use the Add Core tool; core walls are selectable and editable.
3. **Add exclusion areas** — mark areas where ducts cannot run.
4. **Place wall openings** — use Place Door to add openings to any wall segment.
5. **Generate the routing grid** — pick a boundary node as the origin; the grid fills the usable plan area.
6. **Assign thermal zones** — open the Thermal Zones panel. Load a zone layout from the server or import one from JSON. Click a region on the canvas to select it; shift-click to build a multi-region selection.
7. **Link entry points to regions** — switch to the Entry Points tab, select one or more canvas regions (plain click or shift-click), then click an entry-point grid point on the canvas to assign all selected regions to it.
8. **Run optimisation** — use the Run Structural, Run Thermal, or Run Ducts buttons. Results appear in the Results panel.
9. **Save / Load** — `File > Save` writes a `.json` plan file. `File > Open` loads it back. The format is schema `2.1.0`.

---

## Key Panels

| Panel | Purpose |
|---|---|
| Inspector | Properties for the selected wall, core, or grid point(s) |
| Canvas Grid | Snapping and grid-line intensity controls |
| Grid Generation | Routing-grid spacing and origin-picking |
| Exclusion Areas | List and manage no-go areas |
| Thermal Zones | Zone layout, sub-region display, entry-point assignment |
| Layers | Toggle visibility for boundary, cores, columns, beams, grid, ducts |
| Results | Optimisation output — structural and duct plans |

## Keyboard Shortcuts

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

## Project Structure

```
main.js                  # Electron main process (IPC, file I/O)
preload.js               # contextBridge — exposes electronAPI to renderer
config.js                # unit-scale helpers
renderer/
  index.html             # panel and toolbar layout
  styles.css             # application styling
  index.js               # app entry point
  models/
    FloorPlan.js         # central data model and JSON serialisation
    elements.js          # element constructors
    floorPlanUtils.js    # geometry helpers
  state/
    store.js             # FloorPlanStore — active plan, mode, undo/redo
  drawing/
    renderers.js         # canvas 2D rendering
    drawingService.js    # render loop orchestration
    geometry.js          # snapping and projection math
    view3d.js            # Three.js 3D preview
  ui/
    ui.js                # all UI wiring: toolbar, panels, shortcuts
  api/
    apiService.js        # HTTP client for the BuildWeave Flask server
```

For full feature and data-model reference see [DOCUMENTATION.md](DOCUMENTATION.md).

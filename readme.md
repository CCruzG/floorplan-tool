# Floorplan Editor (Electron App)

An interactive Electron/JavaScript application for drawing, editing, and saving modular floorplans.  
Supports rule‑based geometry, requirements input, undo/redo history, and JSON round‑trip for persistence.

---

## ✨ Features

- **Draw & Edit Walls**: Add vertices, close boundaries, and lock/unlock segments.
- **Areas & Entrances**: Define labelled areas and place entrances with width and edge association.
- **Requirements Panel**: Capture metadata (bedrooms, bathrooms, style, notes, etc.) linked to each plan.
- **Save & Open**: Round‑trip JSON persistence with backward compatibility for older schema versions.
- **Undo/Redo**: Full history stack per floorplan.
- **Grid Background**: Adaptive CSS grid for architectural feel.
- **Mode Switching**: Draw, Edit, and Area modes with live indicator.

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+ recommended)
- [npm](https://www.npmjs.com/) (comes with Node)

### Installation
Clone the repository and install dependencies:

```bash
git clone https://github.com/<your-username>/floorplan-editor.git
cd floorplan-editor
npm install
```

### Running the App

```bash
npm start
```
This launches the Electron app with hot reload.

### 🗂 Project Structure

```
.
├── main.js                # Electron main process
├── preload.js             # Secure API exposure
├── renderer/
│   ├── index.html         # UI layout
│   ├── ui.js              # Event bindings
│   ├── drawing/
│   │   └── drawingService.js
│   └── models/
│       └── FloorPlan.js   # Core data model
├── store/
│   └── store.js           # FloorPlanStore + History
└── package.json
```

### 💾 Save Format

Plans are stored as JSON with the following schema:

```json
{
  "name": "My Plan",
  "boundaryClosed": true,
  "wall_graph": {
    "nodes": [[x, y], [x, y], ...],
    "edges": [
      { "v1": [x, y], "v2": [x, y], "locked": false }
    ]
  },
  "entrances": [
    {
      "position": [x, y],
      "edge": { "v1": [x, y], "v2": [x, y], "locked": false },
      "width": 900
    }
  ],
  "areas": [
    { "label": "private", "vertices": [[x, y], ...] }
  ],
  "requirements": {
    "bedrooms": 2,
    "bathrooms": 1,
    "style": "modern",
    "notes": "example"
  }
}
```

### 🛠 Development Notes

- Consistency: wall_graph is the canonical schema for nodes/edges.
- Backward Compatibility: fromJSON supports legacy vertices/edges.
- Extensibility: Requirements and areas are designed for easy extension.
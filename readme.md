# floorplan-tool

Electron-based floorplan editor for boundary drawing, core and exclusion-area definition, wall opening placement, grid generation, and JSON import/export.

## Quick Start
1. `npm install`
2. `npm start`

## Current Highlights
- Draw and edit plan boundaries on a canvas.
- Add exclusion areas and service cores.
- Select walls, split edges, and lock segments.
- Select one or many grid points and edit shared properties.
- Generate a routing grid from a picked origin.
- Save to schema `2.0.0` JSON and load both legacy and v2 plan files.

## Main Files
- `renderer/ui/ui.js`
- `renderer/models/FloorPlan.js`
- `renderer/drawing/renderers.js`
- `renderer/drawing/drawingService.js`

See `DOCUMENTATION.md` for the current workflow and feature reference.

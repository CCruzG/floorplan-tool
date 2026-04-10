# Floorplan Tool Documentation

## Overview
The Floorplan Tool is an Electron-based desktop app for drawing floorplan boundaries, defining exclusion areas and service cores, placing wall openings, generating a routing grid, and saving or loading plan data as JSON.

The current application is centered around a canvas editor with a floating tool palette, a live JSON panel, an inspector panel, canvas-grid controls, grid-generation controls, an exclusion-areas panel, and a layers panel.

## Current User-Facing Tools

### Select
- Select wall segments, grid points, or the full core area.
- Clicking a wall segment selects that segment.
- Clicking inside the core area selects the whole core.
- Clicking a selected wall segment a second time splits it by inserting a new vertex at the closest point on the segment.
- Clicking empty space clears the current selection.

### Draw Boundary
- Click to place boundary vertices.
- The preview supports projection snapping and Shift-constrained drawing.
- Boundary creation closes when the user clicks near the first vertex.

### Add Exclusion Area
- Creates polygonal exclusion areas inside the plan.
- Finish with the Finish Area button or by using the keyboard shortcut documented below.
- Exclusion areas are listed in the Exclusion Areas panel.

### Add Core
- Draws a polygonal service core.
- Core walls are added to the wall graph so they can be selected, locked, and edited like other walls.
- The whole core can be selected by clicking its area and deleted from the inspector or keyboard.

### Place Door
- Places a door opening on a selected wall.
- If no segment is already selected, the app finds the nearest wall segment when placing the door.
- Existing wall openings can be edited from the inspector.

### Generate Grid
- Prompts for a boundary node to use as the grid origin.
- Generates grid points inside the usable plan area.
- Generated points support `column` and `mechanical` flags.

## Selection and Editing

### Wall Segments
- Selecting a segment opens the wall inspector.
- The inspector supports wall type, translucency, lock state, endpoint coordinates, and wall openings.
- Pressing `L` toggles the selected segment lock state.
- Locked walls render in the locked wall style.

### Segment Splitting
- When a segment is already selected, hovering shows a split preview marker on the closest point of that segment.
- Clicking again on that same segment inserts a new vertex and replaces the original segment with two segments.
- The split point is snapped to the canvas grid when grid snapping is enabled.
- Splitting is rejected when the new point would be too close to an existing endpoint.

### Grid Points
- Grid points can be selected individually.
- Shift-click toggles grid points into or out of a multi-selection.
- The inspector applies `column` and `mechanical` changes to all selected grid points when multiple points are selected.

### Core Selection
- Clicking a core wall selects only that wall segment.
- Clicking inside the core area selects the full core.
- The core inspector includes a Delete Core action.
- `Delete` or `Backspace` deletes the selected core.

## Panels

### Inspector
- Shows properties for the active selection.
- Supports three main selection types:
  - Grid point selection, including multi-selection.
  - Core selection.
  - Wall segment selection.

### Canvas Grid
- Controls canvas-grid snapping and visual intensity.
- Grid spacing is configurable in current plan units.

### Grid Generation
- Sets routing-grid spacing.
- Starts origin-picking mode for grid generation.
- Clears the generated grid.

### Exclusion Areas
- Lists current exclusion areas.
- Includes the Finish Area action while drawing a new exclusion area.

### Layers
- Toggles visibility for:
  - Plan Boundary
  - Boundary Area
  - Core Boundary
  - Core Area
  - Columns
  - Exclusion Areas
  - Beams
  - Grid Points
  - Grid Edges
  - Ducts
  - Duct Plan
- Also includes editable plan name input.

## Keyboard Shortcuts
- `Shift`: constrain boundary/core drawing to snapped angles.
- `Cmd/Ctrl + Z`: undo.
- `Cmd/Ctrl + Shift + Z`: redo.
- `L`: lock or unlock the selected wall segment.
- `Enter`: finish the current area or core polygon.
- `Escape`:
  - In Select mode, clear the current selection.
  - In Area/Core/Door/Grid Origin modes, exit or cancel the current action.
- `Delete` or `Backspace`: delete the selected core.

## Data Model and JSON

### Current Export Format
The active `toJSON()` implementation exports schema version `2.0.0`.

The v2 format includes:
- top-level metadata such as `schema_version`, `name`, and `units`
- `boundary.edges`
- `core.edges`
- `grid_points`
- `exclusion_areas`
- `thermal_zones`
- `structural_components`
- `mechanical_components`
- `layers`

Boundary and core edges are exported as objects with their own properties, including wall type, translucency, lock state, and serialized openings.

Grid points are exported as objects with at least:
- `id`
- `x`
- `y`
- `column`
- `mechanical`

Coordinates are snapped during serialization when they are within `0.001` of an integer to reduce floating-point noise.

### Backward Compatibility
- The loader supports older JSON files as well as the current v2 structure.
- `FloorPlan.fromJSON()` detects v2 files and routes them through the dedicated v2 loader.

## Rendering and Interaction Notes
- Wall vertices are rendered subtly to reduce visual clutter.
- Grid points are smaller and more desaturated than earlier versions.
- Selected walls and selected grid points use a stronger highlight color.
- Core walls are highlighted together when the whole core is selected.

## Current Limitations
- The UI button label says Place Door, while some internal code still contains legacy `entrance` naming for compatibility.
- The exported JSON is v2, but some legacy validation/schema helpers in the codebase still describe older structures.
- Beam, ducts, and duct-plan layers exist primarily as visibility toggles and data placeholders rather than full editing workflows.
- Grid generation currently forces the Grid Points layer visible when a new grid is generated.

## Main Source Files
- `renderer/ui/ui.js`: UI wiring, modes, shortcuts, inspector, layer controls, save/load actions.
- `renderer/models/FloorPlan.js`: main model, selection state, wall/core/grid operations, JSON serialization.
- `renderer/drawing/renderers.js`: canvas rendering for walls, areas, grid points, core previews, and split preview.
- `renderer/drawing/drawingService.js`: render orchestration.
- `renderer/drawing/geometry.js`: snapping, closest-segment, and projection helpers.
- `renderer/index.html`: visible panel and toolbar layout.
- `renderer/styles.css`: application styling.

## Typical Workflow
1. Draw the outer boundary.
2. Add one or more exclusion areas if needed.
3. Add the service core.
4. Edit wall properties and openings from the inspector.
5. Generate the routing grid from a chosen origin.
6. Toggle layers to inspect different aspects of the model.
7. Save the plan as JSON.

# Floorplan Tool - Application Documentation

## Overview
The Floorplan Tool is an Electron-based desktop application for creating, editing, and managing building floor plans. It provides a visual canvas-based interface for drawing boundaries, defining areas, placing cores, and managing building elements with support for importing/exporting JSON data.

---

## Core Capabilities

### 1. Drawing & Editing
- **Boundary Drawing Mode**: Create building perimeters by clicking to place vertices
  - Automatic vertex snapping to existing nodes (10px threshold)
  - Edge projection snapping (8px threshold)
  - Orthogonal constraint mode (hold Shift for horizontal/vertical alignment)
  - Visual projection guides showing alignment from existing vertices
  - Double-click or press Enter to close the boundary
  - Press Escape to cancel drawing

- **Core Boundary Mode**: Define service core areas (stairs, elevators, mechanical rooms)
  - Same drawing mechanics as boundary mode
  - Alignment guides snap to both boundary and existing core vertices
  - Visual feedback with green highlights for boundary alignment, red for core alignment
  - Cursor snaps to guides within 15px for precise placement
  - Red dashed preview line during drawing
  - Separate fill and outline layers for visualization

- **Area Definition Mode**: Mark functional zones (rooms, spaces)
  - Click to place vertices and define polygons
  - Supports color and alpha transparency customization
  - Area measurements and labeling

- **Entrance Placement Mode**: Add building entry points
  - Click on wall edges to place entrances
  - Define entrance width and position
  - Visual projection guides for edge alignment

- **Edit Mode**: Modify existing geometry
  - Select wall segments by clicking
  - Lock/unlock segments (L key or Lock button)
  - Locked segments appear as red dashed lines
  - Drag segments to reposition (planned feature)

### 2. Layer Management
The application supports independent visibility control for multiple layers:

**Active Layers** (enabled by default):
- **Plan Boundary**: Building perimeter outline (wall edges)
- **Boundary Area**: Building perimeter fill
- **Core Boundary**: Service core outlines
- **Core Area**: Service core area fills
- **Columns**: Structural column footprints
- **Temperature Regions**: Thermal zone definitions

**Disabled Layers** (can be enabled):
- **Beams**: Structural beam definitions with height constraints
- **Grid Points**: Discretized routing grid vertices
- **Grid Edges**: Valid connections between grid points
- **Ducts**: Available duct specifications
- **Duct Plan**: Final duct routing solution

Each layer can be toggled independently via checkboxes in the Layers panel.

### 3. Canvas Controls
- **Pan & Zoom**: Navigate large floor plans (view transform system)
- **Unit System**: Support for mm, cm, m, in, ft with configurable canvas width
- **Scale Management**: Pixels-per-unit conversion for accurate measurements
- **Visual Feedback**: 
  - Hover tooltips showing dimensions
  - Mode indicator showing current editing mode
  - Ghost rendering for preview during drawing

### 4. Data Management

#### Import/Export
- **Save Floorplan**: Export to JSON with all geometry and metadata
- **Open Floorplan**: Load JSON files with backward compatibility
- **Schema Version**: Tracks data format version (current: 1.0.0)
- **Unit Preservation**: Saves and restores measurement units

#### Data Structure
The application uses a dual-schema approach:
- **Legacy Schema**: `wall_graph` (nodes/edges), simple `areas` array
- **Reference Schema**: Structured collections for advanced features
  - `Plan_Boundary`: Array of polygon objects (Pt_0, Pt_1, etc.)
  - `Core_Boundary`: Service core polygons
  - `Columns`: Column footprint polygons
  - `Temperature_Regions`: Thermal zone objects with subregions
  - `Beams`: Beam objects with height constraints
  - `Points`/`Edges`: Routing grid for duct planning
  - `Ducts`: Available duct specifications
  - `Duct_Plan`: Optimized routing solution

#### Validation
- JSON schema validation for floorplan data
- Coordinate deduplication (configurable epsilon tolerance)
- Node/edge canonicalization for consistency
- Automatic conversion between legacy and reference schemas

### 5. Geometry Features

#### Snapping System
- **Node Snap**: 10px threshold for vertex-to-vertex alignment
- **Edge Snap**: 8px threshold for point-to-edge projection
- **Alignment Guides**: Visual guides show horizontal/vertical alignment
- **Orthogonal Constraint**: Force 90° angles with Shift key

#### Measurements
- **Edge Lengths**: Automatic dimension display on wall segments
- **Area Calculations**: Polygon area computation
- **Unit Conversion**: Seamless conversion between measurement systems

#### Rendering
- **Anti-aliased Canvas**: Smooth geometry rendering
- **Color Customization**: RGB/hex color support with alpha transparency
- **Visual Hierarchy**: Distinct colors for different element types
  - Walls: Black (#222)
  - Locked segments: Red dashed (#c22)
  - Core boundaries: Red (#ff6b6b)
  - Core areas: Light red (rgba(255, 107, 107, 0.15))
  - Temperature regions: Customizable per region
  - Columns: Gray (rgba(128, 128, 128, 0.6))

### 6. UI Components

#### Toolbar
- Clear: Reset to empty floorplan
- Add Area: Enter area definition mode
- Add Core: Enter core boundary mode
- Entrance: Enter entrance placement mode
- Lock: Toggle lock on selected segment
- Open Floorplan: Load JSON file
- Save Floorplan: Export current work
- Optimize: Generate optimization request (API integration planned)

#### Panels
- **Canvas Panel**: Main drawing area with mode indicator
- **JSON Panel**: Live view of floorplan data structure
- **Layers Panel**: Layer visibility toggles
- **Plan Panel**: Floorplan name and properties
- **Areas Panel**: List of defined areas (planned)
- **Core Panel**: Finish Core button to complete drawing

#### Keyboard Shortcuts
- **Shift**: Enable orthogonal constraint during drawing
- **L**: Lock/unlock selected wall segment
- **Enter**: Finish current polygon (area or core)
- **Escape**: Cancel current drawing operation
- **Cmd/Ctrl + Z**: Undo
- **Cmd/Ctrl + Shift + Z**: Redo

### 7. History & State Management
- **Undo/Redo**: Full history tracking for all edits
- **Store System**: Centralized state management (FloorPlanStore)
- **Auto-save**: JSON output updates on every change
- **Multiple Plans**: Support for multiple floorplan documents (architecture in place)

---

## Technical Architecture

### Frontend
- **Framework**: Electron (desktop application)
- **Rendering**: HTML5 Canvas 2D context
- **Modules**: ES6 modules with clean separation
  - `renderer/drawing/`: Canvas rendering and geometry
  - `renderer/models/`: Data models (FloorPlan)
  - `renderer/state/`: State management (Store, History)
  - `renderer/ui/`: User interface and event handling

### Data Flow
1. User interaction → UI event handlers
2. Update FloorPlan model
3. Push to History (for undo/redo)
4. Notify Store listeners
5. Trigger canvas re-render
6. Update JSON panel display

### File Structure
```
floorplan-tool/
├── main/                 # Electron main process
├── renderer/
│   ├── drawing/         # Canvas rendering, geometry utilities
│   │   ├── drawingService.js
│   │   ├── renderers.js
│   │   └── geometry.js
│   ├── models/          # Data models and validation
│   │   ├── FloorPlan.js
│   │   ├── validation.js
│   │   └── promptRenderer.js
│   ├── state/           # State management
│   │   ├── store.js
│   │   └── history.js
│   ├── ui/              # UI and event handling
│   │   └── ui.js
│   ├── index.html       # Main HTML structure
│   ├── index.js         # Renderer entry point
│   └── styles.css       # Application styles
├── config.js            # Unit conversion and scale settings
└── package.json         # Dependencies and scripts
```

---

## Known Limitations & Future Enhancements

### Current Limitations
- Beams, Grid Points, Grid Edges, Ducts, and Duct Plan layers have no rendering implementation yet
- Column placement/editing UI not yet implemented
- Area list panel not functional
- Segment dragging in edit mode incomplete
- No measurement tools for distances/angles
- Limited column manipulation

### Planned Features
- API integration for optimization (replace "Refine with AI" button)
- Backend coordination for unified JSON structure
- Enhanced validation with visual error feedback
- Advanced geometry editing (move, rotate, scale)
- Measurement and annotation tools
- Template system for common layouts
- Export to CAD formats (DXF, DWG)

---

## Development Workflow Recommendations

### Basic Workflow
1. **Start Application**: `npm start`
2. **Draw Boundary**: Click to place vertices, close polygon
3. **Add Core Areas**: Switch to core mode, define service cores
4. **Define Zones**: Use area mode for functional spaces
5. **Place Entrances**: Switch to entrance mode, click on walls
6. **Adjust Layers**: Toggle visibility as needed for clarity
7. **Save Work**: Export JSON file for backup/sharing
8. **Optimize**: (When API ready) Generate optimization request

### Testing Workflow
1. Load existing JSON files to test backward compatibility
2. Verify layer toggles work correctly
3. Test undo/redo after major edits
4. Check coordinate precision with different unit systems
5. Validate export/import cycle preserves all data
6. Test snapping behavior at various zoom levels

### Development Workflow
1. Make changes to renderer code
2. Hot reload updates automatically (Electron dev mode)
3. Check browser console for errors/warnings
4. Verify JSON output panel for data integrity
5. Test with various floorplan sizes and complexities
6. Commit changes with descriptive messages

---

## Recent Updates (Dec 2, 2025)

### Completed Features
- ✅ Core drawing projection guides with alignment snapping
- ✅ Cursor snapping to alignment guides (15px threshold)
- ✅ Layer toggle system fully functional
- ✅ Separate Core Area and Core Boundary layers
- ✅ Lock button functionality for wall segments
- ✅ Fixed layer visibility issues with proper state management

### Bug Fixes
- Fixed layer toggles not working (hasOwnProperty issue)
- Fixed checkbox state being reset by onChange callbacks
- Fixed boundary rendering showing segmented lines
- Separated boundary area from temperature regions rendering
- Added null checks for optimize button to prevent errors

---

## API Integration (Planned)

The optimize button is designed to:
1. Validate current floorplan data
2. Serialize to JSON format
3. Send to backend optimization API
4. Receive optimized layout suggestions
5. Apply or preview changes

**Status**: Button exists, API endpoint and contract pending backend team discussion.

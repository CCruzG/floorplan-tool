# Help & How-To

<!--
This is the in-app manual. Edit it freely — every `## ` heading becomes a
section in the table of contents, and the tool re-renders it on load.
Supported formatting: paragraphs, `- ` bullet lists, `> ` tip callouts,
**bold**, and `inline code`. Content above the first `## ` is ignored.
-->

## Overview

This is an early-stage design tool for the **structural and mechanical services** of a floor plate. You draw the plate, discretise it into a grid, and run optimisation stages that place structure, thermal (VAV) zones and duct routing — then read the resulting quantities and costs.

It follows a **kit-of-parts** approach: beams, columns, slabs and ducts are drawn from a costed catalogue, so the numbers on the dashboard reflect buildable components rather than abstract geometry.

> The tool is a decision aid for early design coordination — it informs choices about structure and services, it does not produce construction documentation.

## The workflow

Work top-to-bottom through the tool palette. Each step depends on the ones above it:

- **1. Set the scale** — tell the tool how big the canvas is.
- **2. Draw Boundary** — the outline of the floor plate.
- **3. Draw Core** — lift/stair/riser cores (voids in the plate).
- **4. Place Door** — the entrance(s).
- **5. Place Grid** — discretise the plate into points the optimiser works on.
- **6. Structural / Duct settings** — set the parameters for each stage.
- **7. Optimise** — run Structure → Thermal Zones → Duct Routing, or Full Optimise.
- **8. Read the Dashboard** — quantities, costs and clash/buildup analysis.
- **9. Snapshot / Save** — capture and compare solutions.

You can re-run any stage after changing an input; later stages depend on earlier results, so re-running Structure will usually mean re-running the stages below it.

## 1 · Setting the scale

Before drawing, set how wide the canvas represents in the real world using the **Canvas width** field and unit selector in the top toolbar (mm, cm, m, in, ft). Everything you draw and every cost is calculated against this scale, so set it first.

If you are tracing over an imported reference image, use **Calibrate Scale** instead: draw a line over a known dimension in the image (e.g. a 5 m grid line) and enter its real length. The tool derives the scale from that line.

> Getting the scale wrong is the most common source of nonsensical costs. If quantities look 10× or 100× off, re-check the canvas width and unit.

## 2 · Draw Boundary

**Draw Boundary** traces the outline of the floor plate. Click to place each corner; the boundary is a closed polygon, so finish back at (or near) the start point to close it.

- Lines snap to 45° increments to keep edges clean — hold to override where you need a free angle.
- Vertices snap to existing nodes and edges so adjoining geometry stays coincident.
- Use **Select** mode afterwards to drag vertices and adjust the shape.

## 3 · Draw Core

**Draw Core** defines the service cores — lift shafts, stairs and riser groups — as closed polygons inside the boundary. Cores are treated as voids: the grid is not placed inside them, and they are where duct risers drop into the plate.

Draw the core outline the same way as the boundary, then press **Finish Core** to close it. You can place more than one core.

> Core position matters for duct routing: entry points (riser drops) are taken from the core edges, so a central core and a perimeter core produce very different duct solutions.

## 4 · Place Door

**Place Door** marks the entrance(s) to the plate. Click on a boundary edge to drop the door. Entrances are used by the layout logic as fixed points of access.

## Reference images

You can import a PNG, JPG or PDF to trace over — architectural plans, sketches or survey drawings. Import controls (position, scale, opacity) live in the **Display** panel. Import the image, position it, then use **Calibrate Scale** (see Setting the scale) so your tracing is at true size.

## 5 · Place Grid

**Place Grid…** discretises the plate into a regular grid of points. These points are what the optimiser reasons about — candidate locations for columns, mechanical equipment and duct entry.

Each grid point carries flags that control what may sit on it:

- **column** / **beam** — eligible for structure.
- **mechanical** — eligible for services equipment and duct routing.
- **entry point** — a riser/entry location (typically on a core edge).

Use **exclusion zones** to keep the grid out of areas that must stay clear. Set the grid spacing in the modal before generating.

> A finer grid gives the optimiser more freedom but solves slower. Start coarse, refine once the layout is roughly right.

## 6a · Structural Settings

**Structural Settings…** sets the parameters for the structural stage: the material and member catalogue the optimiser draws from, and any constraints such as a forced column line via the structural axis input. Confirm these before running **Structure**.

## 6b · Duct Settings

**Duct Settings…** configures the duct-routing stage — air-flow rates and the parameters that govern how risers, branches and fittings are placed. Air-flow rate can be edited per unit (l/s·m²) in the criteria panel and per thermal region on the canvas.

## Thermal zones & entry points

The thermal stage groups the plate into **VAV control zones**. You can edit flow values per region, and they are reflected on the canvas. Once zones are generated, the canvas shows only the VAV control zones to keep the view readable.

**Entry points** (riser drops) can be assigned to thermal zones and, if you want to override the optimiser, **pinned** manually — a pinned entry point is used as a hard location rather than a candidate. Use **Clear Entry Point Assignment** to release manual pins; assignments also auto-clear when you re-optimise the thermal zones.

> If a duct run reports "no feasible plan", check that entry points are flagged and not all sharing a single location — the router needs a distinct entry per zone group.

## 7 · Running optimisation

Run the stages in order, or all at once:

- **Structure** — places beams, columns and slab.
- **Thermal Zones** — groups the plate into VAV control zones.
- **Duct Routing** — routes ducts from the core risers to the zones.
- **Full Optimise** — runs all three in sequence.

All optimise buttons disable together while a run is in progress. Use **stop** to cancel a run and **continue** to resume where offered. A status line reports progress underneath the buttons.

> Stages depend on each other: changing structure invalidates the thermal and duct results below it, so re-run downstream stages after an upstream change.

## 8 · Reading the Dashboard

The dashboard panel visualises the optimisation results:

- **Structural** — material, beam size, column footprint, slab depth, per-component cost and cost/m².
- **Duct** — full costing (linear metres plus fittings by type), per-branch colour-coded breakdown.
- **Buildup analysis** — where ducts clash with each other or with beams (height conflicts), with a user-settable threshold and severity tiers.

Pinch/stress points and heights come from the backend and are drawn on the canvas.

> A cost of $0 for a component usually means that stage has not been run yet, not that it is free — run the relevant optimise stage first.

## 9 · Snapshots

**Snapshot** captures the current solution as a numbered card. Each card records the structural configuration (material, grid, orientation) and the costs, and you can Load, Update or Delete it. The comparison table puts structural, mechanical, total and cost/m² side by side across snapshots — the way to compare design options.

## Save, Open & New Project

**Save** / **Save As…** write the whole floor plan — geometry, grid, settings and results — to a file. **Open Floorplan** loads one back. **New Project** starts a clean plate (you are prompted to save first).

> Save regularly. A long optimisation run is worth snapshotting and saving before you change inputs and re-run.

## 3D View

**3D View** shows the plate, structure and services in three dimensions. Orbit, pan and zoom with the mouse. Use it to sanity-check that structure and ducts coordinate in section, not just in plan.

## Troubleshooting

- **Server status** — the dot in the top toolbar shows the optimisation server state. It must be green/ready before you can run a stage; "starting…" means wait a moment.
- **A stage won't run** — check the step above it has completed (structure before thermal, thermal before duct) and the server is ready.
- **Costs look wrong** — re-check the canvas scale first, then confirm the relevant optimise stage has actually been run.
- **Duct routing reports no feasible plan** — check entry points are flagged, distinct, and not filtered out (see Thermal zones & entry points).

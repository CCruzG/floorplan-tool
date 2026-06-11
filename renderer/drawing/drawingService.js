// renderer/drawing/drawingService.js
import { closestPointOnSegment, findClosestProjection, edgeLength, edgeMidpoint, isPointNearEdge, closestEdgeProjection } from './geometry.js';
import { formatLen } from '../../config.js';
import { drawTooltip } from '../ui/labels.js';
import { getNodeById, edgeToCoords, areaToCoords } from '../models/floorPlanUtils.js';
// Lightweight orchestrator that delegates drawing work to the renderers module.
import * as R from './renderers.js';

export const DrawingService = {
  render(ctx, fp, options = {}) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!fp) return;

    // White background in screen space — always covers the full canvas.
    const _W = ctx.canvas.width, _H = ctx.canvas.height;
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, _W, _H);

    // Apply the interactive viewport (zoom/pan) around all content drawing.
    // Falls back to fp._view (set by the open-plan fit-to-canvas flow) when
    // no explicit viewport is provided.
    const _vp = options.viewport
      ?? (fp._view ? { scale: fp._view.scale, tx: fp._view.offsetX || 0, ty: fp._view.offsetY || 0 } : null);
    const _hasVP = _vp && (_vp.scale !== 1 || _vp.tx !== 0 || _vp.ty !== 0);
    if (_hasVP) {
      ctx.save();
      ctx.setTransform(_vp.scale, 0, 0, _vp.scale, _vp.tx, _vp.ty);
    }

    R.drawReferenceImage(ctx, fp);

    // Grid drawn inside the transform so it zooms / pans with the plan.
    R.drawBackgroundGrid(ctx, fp, options.gridSettings, _vp);

    // If the plan was loaded in "boundary-only" visual mode, draw only
    // the boundary vertices, core vertices, and columns (if present) and nothing else. 
    // This is used when opening large imported plans where we want a minimal 
    // visual inspection. Respect layer visibility settings.
    if (fp._renderOnlyBoundaryVertices) {
      if (fp.layers?.Plan_Boundary !== false && typeof R.drawBoundaryVertices === 'function') {
        R.drawBoundaryVertices(ctx, fp);
      }
      if (fp.layers?.Core_Boundary !== false && typeof R.drawCoreVertices === 'function') {
        R.drawCoreVertices(ctx, fp);
      }
      if (fp.layers?.Columns !== false && typeof R.drawColumnsVertices === 'function') {
        R.drawColumnsVertices(ctx, fp);
      }
      if (_hasVP) ctx.restore();
      return;
    }

    // Delegate to modular render functions - respecting layer visibility
    if (fp.layers?.Boundary_Area !== false) {
      R.drawBoundaryArea(ctx, fp);
    }
    // Thermal zones (BuildWeave segmentation/zone results) — behind walls
    if (fp.layers?.Thermal_Zones !== false) {
      R.drawThermalZones(ctx, fp);
      R.drawThermalControlZones(ctx, fp);
    }
    if (fp.layers?.Exclusion_Areas !== false) {
      R.drawExclusionAreas(ctx, fp);
    }
    // console.log('Rendering Plan_Boundary:', fp.layers?.Plan_Boundary);
    if (fp.layers?.Plan_Boundary !== false) {
      R.drawWalls(ctx, fp, options);
    }
    if (fp.layers?.Core_Area !== false) {
      R.drawCoreAreas(ctx, fp);
    }
    // console.log('Rendering Core_Boundary:', fp.layers?.Core_Boundary);
    if (fp.layers?.Core_Boundary !== false) {
      R.drawCoreBoundaries(ctx, fp);
    }
    // console.log('Rendering Columns:', fp.layers?.Columns);
    if (fp.layers?.Columns !== false) {
      R.drawColumns(ctx, fp);
    }
    if (fp.layers?.Beams !== false) {
      R.drawBeams(ctx, fp);
    }
    // Draw grid points if layer is enabled
    if (fp.layers?.Points !== false) {
      R.drawGridPoints(ctx, fp);
    }
    // Draw grid edges if layer is enabled
    if (fp.layers?.Edges !== false) {
      R.drawGridEdges(ctx, fp);
    }
    // Duct plan (BuildWeave duct routing results) — on top of grid
    if (fp.layers?.Duct_Plan !== false) {
      R.drawDuctPlan(ctx, fp);
    }
    R.drawEntrances(ctx, fp);
    if (options.showVertices) R.drawVertices(ctx, fp);

    if (options.ghost) {
      R.drawGhost(ctx, fp, options.ghost, { constrain: options.constrain });
    }

    if (options.ghost && fp.boundaryClosed && options.mode === 'entrance') {
      R.drawEntranceProjection(ctx, fp, options.ghost);
    }

    if (options.ghost && options.mode === 'door') {
      R.drawDoorGhost(ctx, fp, options.ghost);
    }

    if (options.ghost && options.mode === 'select' && fp.selectedSegment != null) {
      R.drawSplitPreview(ctx, fp, options.ghost);
    }

    if (options.ghost && !fp.boundaryClosed) {
      R.drawGhost(ctx, fp, options.ghost, { constrain: options.constrain });
      R.drawProjectionGuides(ctx, fp, options.ghost);
    }

    if (options.ghost && options.mode !== "draw") {
      R.drawHoverTooltip(ctx, fp, options);
    }

    if (options.mode === "area" && options.tempArea) {
      R.drawAreaGhost(ctx, fp, options.tempArea, options.ghost);
    }

    if (options.mode === "core" && options.tempCore) {
      // pass the orthogonal constraint flag so the ghost renderer can
      // show visual feedback when the user holds Shift
      R.drawCoreGhost(ctx, fp, options.tempCore, options.ghost, !!options.constrain);
      // Show projection guides from last core vertex (like boundary drawing)
      if (options.ghost && options.tempCore.length > 0) {
        R.drawCoreProjectionGuides(ctx, fp, options.tempCore, options.ghost);
      }
    }

    if (options.mode === 'grid-origin' && options.ghost) {
      R.drawGridOriginGhost(ctx, fp, options.ghost);
    }

    if (options.selectionBox?.start && options.selectionBox?.end) {
      R.drawSelectionBox(ctx, options.selectionBox.start, options.selectionBox.end);
    }

    if (_hasVP) ctx.restore();
  },

  // keep convenient re-exports for existing callers
  findClosestBoundaryPoint: R.findClosestBoundaryPoint,
  drawAreas: R.drawAreas,
  drawWalls: R.drawWalls,
  drawGhost: R.drawGhost,
  drawProjectionGuides: R.drawProjectionGuides,
  drawEntranceProjection: R.drawEntranceProjection
};


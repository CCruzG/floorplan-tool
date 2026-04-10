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

    // Draw scale-aware background grid first so all geometry renders on top
    R.drawBackgroundGrid(ctx, fp, options.gridSettings);

    // Apply an optional view transform (scale + offset) so large imported
    // plans can be fitted into the canvas. The transform is stored on the
    // FloorPlan as `_view` by the UI loader when appropriate.
    let appliedView = false;
    if (fp._view && typeof fp._view.scale === 'number') {
      appliedView = true;
      ctx.save();
      ctx.setTransform(fp._view.scale, 0, 0, fp._view.scale, fp._view.offsetX || 0, fp._view.offsetY || 0);
    }

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
      if (appliedView) ctx.restore();
      return;
    }

    // Do not paint an opaque canvas background here — drawBackgroundGrid
    // already fills the canvas before this point.

    // Delegate to modular render functions - respecting layer visibility
    if (fp.layers?.Boundary_Area !== false) {
      R.drawBoundaryArea(ctx, fp);
    }
    if (fp.layers?.Exclusion_Areas !== false) {
      R.drawExclusionAreas(ctx, fp);
    }
    console.log('Rendering Plan_Boundary:', fp.layers?.Plan_Boundary);
    if (fp.layers?.Plan_Boundary !== false) {
      R.drawWalls(ctx, fp, options);
    }
    if (fp.layers?.Core_Area !== false) {
      R.drawCoreAreas(ctx, fp);
    }
    console.log('Rendering Core_Boundary:', fp.layers?.Core_Boundary);
    if (fp.layers?.Core_Boundary !== false) {
      R.drawCoreBoundaries(ctx, fp);
    }
    console.log('Rendering Columns:', fp.layers?.Columns);
    if (fp.layers?.Columns !== false) {
      R.drawColumns(ctx, fp);
    }
    // Draw grid points if layer is enabled
    if (fp.layers?.Points !== false) {
      R.drawGridPoints(ctx, fp);
    }
    // Draw grid edges if layer is enabled
    if (fp.layers?.Edges !== false) {
      R.drawGridEdges(ctx, fp);
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

    if (appliedView) ctx.restore();
  },

  // keep convenient re-exports for existing callers
  findClosestBoundaryPoint: R.findClosestBoundaryPoint,
  drawAreas: R.drawAreas,
  drawWalls: R.drawWalls,
  drawGhost: R.drawGhost,
  drawProjectionGuides: R.drawProjectionGuides,
  drawEntranceProjection: R.drawEntranceProjection
};


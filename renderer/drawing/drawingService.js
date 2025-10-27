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

    // Do not paint an opaque canvas background here so the wrapper
    // element's CSS grid/background remains visible. The canvas should be
    // transparent and only draw geometry on top of the CSS background.

    // Delegate to modular render functions
    R.drawAreas(ctx, fp);
    R.drawWalls(ctx, fp, options);
    R.drawEntrances(ctx, fp);
    if (options.showVertices) R.drawVertices(ctx, fp);

    if (options.ghost) {
      R.drawGhost(ctx, fp, options.ghost, { constrain: options.constrain });
    }

    if (options.ghost && fp.boundaryClosed && options.mode === 'entrance') {
      R.drawEntranceProjection(ctx, fp, options.ghost);
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
  },

  // keep convenient re-exports for existing callers
  findClosestBoundaryPoint: R.findClosestBoundaryPoint,
  drawAreas: R.drawAreas,
  drawWalls: R.drawWalls,
  drawGhost: R.drawGhost,
  drawProjectionGuides: R.drawProjectionGuides,
  drawEntranceProjection: R.drawEntranceProjection
};


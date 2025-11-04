// renderer/models/requirementsEvaluator.js
import { polygonArea } from '../drawing/geometry.js';
import { getNodeById } from './floorPlanUtils.js';
import { DEFAULT_CONFIG } from './roomDefaults.js';

// map unit label to meters per unit
const UNIT_TO_METER = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
  ft: 0.3048,
  px: 0.001 // fallback: assume px ~ 1mm (best effort)
};

function getPxPerUnit(fp) {
  return (fp.units && fp.units.pxPerUnit) ? fp.units.pxPerUnit : 1;
}

function unitToMeter(unitLabel) {
  return UNIT_TO_METER[unitLabel] || 0.001; // default to mm
}

function resolveAreaCoords(fp, area) {
  // area.vertices may contain node ids or coordinate arrays
  const pts = [];
  (area.vertices || []).forEach(v => {
    if (typeof v === 'string') {
      const n = getNodeById(fp.wall_graph.nodes, v);
      if (n) pts.push([n.x, n.y]);
    } else if (Array.isArray(v) && v.length >= 2) {
      pts.push([v[0], v[1]]);
    } else if (v && typeof v.x === 'number' && typeof v.y === 'number') {
      pts.push([v.x, v.y]);
    }
  });
  return pts;
}

export function computeBoundaryAreaPx(fp) {
  // Prefer an explicit boundaryArea if present (special object) or a
  // legacy 'boundary' area in the areas list.
  let boundary = fp.boundaryArea || (fp.areas || []).find(a => a && a.label === 'boundary');
  if (boundary) {
    // boundaryArea may contain node ids or coordinate arrays; adapt resolver
    const proxy = { vertices: boundary.vertices };
    const pts = resolveAreaCoords(fp, proxy);
    if (pts.length >= 3) return polygonArea(pts);
  }

  // Fallback: use wall_graph node order (assumes closed polygon)
  const nodes = fp.wall_graph.nodes || [];
  if (nodes.length >= 3) {
    const pts = nodes.map(n => [n.x, n.y]);
    return polygonArea(pts);
  }
  return 0;
}

export function pxAreaToSquareMeters(pxArea, fp) {
  const pxPerUnit = getPxPerUnit(fp) || 1; // pixels per unit
  const unitLabel = (fp.units && fp.units.length) || 'mm';
  const unitMeters = unitToMeter(unitLabel);
  // area in unit^2 = pxArea / (pxPerUnit^2)
  const areaInUnitsSq = pxArea / (pxPerUnit * pxPerUnit);
  // convert to m^2
  return areaInUnitsSq * (unitMeters * unitMeters);
}

export function evaluateRequirements(fp, options = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...(options.config || {}) };
  const roomMin = cfg.roomMinAreas;
  const overhead = cfg.overhead;

  const totalAvailablePx = computeBoundaryAreaPx(fp);
  const totalAvailableM2 = pxAreaToSquareMeters(totalAvailablePx, fp);

  const req = fp.requirements || {};
  // Interpret requested counts, but always enforce at least one bathroom,
  // one kitchen and one common living/dining area as baseline requirements.
  const bedrooms = Math.max(0, parseInt(req.bedrooms || 0, 10));
  const bathrooms = Math.max(1, parseInt(req.bathrooms || 0, 10)); // always at least 1

  // At least one kitchen and one living/common area per plan
  const kitchens = Math.max(1, parseInt(req.kitchens || 1, 10));
  const livings = 1; // common area (dining + sitting) always considered

  // --- New template-based minimums per your specification ---
  // Template minima (m^2) for common configurations (bedrooms + 1 bathroom)
  const TEMPLATE_MIN = {
    0: 37,  // studio + 1 bath
    1: 47,  // 1 bed + 1 bath
    2: 67,  // 2 bed + 1 bath
    3: 90   // 3 bed + 1 bath
  };

  const minBedroom = roomMin.bedroom || 9;
  const minBathroom = roomMin.bathroom || 3;
  const minKitchen = roomMin.kitchen || 6;
  const minLiving = roomMin.living || 10;

  // Compute a base template for the requested bedroom count. If bedrooms > 3,
  // fall back to a simple additive model (sum minima).
  let templateBase = TEMPLATE_MIN[bedrooms];
  if (templateBase == null) {
    templateBase = (bedrooms * minBedroom) + minKitchen + minLiving + minBathroom;
  }

  // Account for extra toilets / additional full bathrooms if provided.
  // Interpretation: `bathrooms` is total full bathrooms requested. The template
  // values assume 1 bathroom; additional full bathrooms cost ~5 m^2 each.
  const extraFullBathrooms = Math.max(0, bathrooms - 1);
  const extraToilets = Math.max(0, parseInt(req.extraToilets || req.toilets || 0, 10));

  const templateExtra = (extraFullBathrooms * 5) + (extraToilets * 3);

  // Required area before overhead = template base + extras
  const requiredBase = templateBase + templateExtra;

  const requiredWithOverhead = requiredBase * (1 + overhead);

  const feasible = requiredWithOverhead <= totalAvailableM2;
  const bufferM2 = totalAvailableM2 - requiredWithOverhead;

  const breakdown = {
    availableM2: totalAvailableM2,
    requiredBaseM2: requiredBase,
    requiredWithOverheadM2: requiredWithOverhead,
    bedrooms: { requested: bedrooms, perMin: roomMin.bedroom, total: bedrooms * (roomMin.bedroom || 9) },
    bathrooms: { requested: bathrooms, perMin: roomMin.bathroom, total: bathrooms * (roomMin.bathroom || 3) },
    kitchens: { requested: kitchens, perMin: roomMin.kitchen, total: kitchens * (roomMin.kitchen || 6) },
    livings: { requested: livings, perMin: roomMin.living, total: livings * (roomMin.living || 10) },
    overhead
  };

  // Explain what the evaluator forced/enforced irrespective of user inputs
  const ensured = [];
  if (bathrooms >= 1) ensured.push('>=1 bathroom');
  if (kitchens >= 1) ensured.push('>=1 kitchen');
  ensured.push('common living/dining area');

  const suggestions = [];
  if (!feasible) {
    const deficit = Math.abs(bufferM2);
    suggestions.push(`Deficit of ${deficit.toFixed(2)} m²`);
    // Try greedy reductions: bedrooms -> bathrooms -> kitchen
    if (bedrooms > 0) suggestions.push('Consider reducing number of bedrooms');
    if (bathrooms > 0) suggestions.push('Consider sharing bathrooms or reducing bathroom count');
    suggestions.push('Consider reducing bedroom sizes or increasing boundary area');
  } else {
    if (bufferM2 < Math.max(1, totalAvailableM2 * 0.1)) {
      suggestions.push('Feasible but tight — consider small reductions to room sizes or allowing flexible layouts.');
    } else {
      suggestions.push('Feasible with comfortable buffer.');
    }
  }

  // Compute suggested room counts based on available surface area.
  // We allocate the minimum essential items first (1 bathroom, 1 kitchen,
  // 1 living) and then fill remaining area with bedrooms of minimum size.

  // Usable area before overhead (we reverse the overhead factor to approximate)
  const usableM2 = totalAvailableM2 / (1 + overhead);
  const essentialSum = minBathroom + minKitchen + minLiving; // one of each
  let suggestedBedrooms = 0;
  if (usableM2 > essentialSum) {
    suggestedBedrooms = Math.floor((usableM2 - essentialSum) / minBedroom);
    if (suggestedBedrooms < 0) suggestedBedrooms = 0;
  }

  // After allocating bedrooms, see if additional bathrooms fit
  const remainingAfterBedrooms = usableM2 - essentialSum - (suggestedBedrooms * minBedroom);
  const additionalBaths = remainingAfterBedrooms > minBathroom ? Math.floor(remainingAfterBedrooms / minBathroom) : 0;
  const suggestedBathrooms = Math.max(1, 1 + additionalBaths);

  const suggestedCounts = {
    bedrooms: suggestedBedrooms,
    bathrooms: suggestedBathrooms,
    kitchens: 1,
    livings: 1
  };

  suggestions.unshift(`Suggested layout: ${suggestedCounts.bedrooms} bedrooms, ${suggestedCounts.bathrooms} bathrooms, 1 kitchen, 1 living.`);

  // --- Spatial / side checks using axis-aligned bounding box (heuristic) ---
  // Compute bounding box of boundary in meters to check side/width constraints.
  const pxPerUnit = getPxPerUnit(fp) || 1;
  const unitLabel = (fp.units && fp.units.length) || 'mm';
  const unitMeters = unitToMeter(unitLabel);

  // Resolve boundary points (prefer explicit boundaryArea special object)
  const boundaryAreaObj = fp.boundaryArea || (fp.areas || []).find(a => a && a.label === 'boundary');
  let bboxPts = [];
  if (boundaryAreaObj) bboxPts = resolveAreaCoords(fp, { vertices: boundaryAreaObj.vertices });
  if (!bboxPts || bboxPts.length === 0) {
    bboxPts = (fp.wall_graph?.nodes || []).map(n => [n.x, n.y]);
  }

  let bboxWidthM = 0, bboxHeightM = 0;
  if (bboxPts && bboxPts.length) {
    const xs = bboxPts.map(p => p[0]);
    const ys = bboxPts.map(p => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const widthPx = Math.max(0, maxX - minX);
    const heightPx = Math.max(0, maxY - minY);
    bboxWidthM = (widthPx / pxPerUnit) * unitMeters;
    bboxHeightM = (heightPx / pxPerUnit) * unitMeters;
  }

  // Master bedroom constraints: at least 10 m2 and no side shorter than 3m
  const masterMinArea = 10;
  const masterSideMin = 3;
  const masterBedroomOk = (totalAvailableM2 >= masterMinArea) && (Math.min(bboxWidthM, bboxHeightM) >= masterSideMin);

  // Other bedrooms constraints: at least 9 m2 and no side shorter than 3m
  const otherBedroomOk = (minBedroom >= 9) ? (Math.min(bboxWidthM, bboxHeightM) >= 3) : (Math.min(bboxWidthM, bboxHeightM) >= 3);

  // Living area width constraint: studio or 1-bed -> 3.6 m, otherwise 4 m
  const livingWidthReq = (suggestedCounts.bedrooms <= 1) ? 3.6 : 4.0;
  const livingWidthOk = (bboxWidthM >= livingWidthReq) || (bboxHeightM >= livingWidthReq);

  // Add dimension checks to breakdown for UI/prompts
  breakdown.dimensionChecks = {
    bboxWidthM: Number(bboxWidthM.toFixed(2)),
    bboxHeightM: Number(bboxHeightM.toFixed(2)),
    masterBedroomOk,
    otherBedroomOk,
    livingWidthReq,
    livingWidthOk
  };

  const summary = feasible
    ? `Feasible: required ${requiredWithOverhead.toFixed(2)} m², available ${totalAvailableM2.toFixed(2)} m² (buffer ${bufferM2.toFixed(2)} m²). Includes: ${ensured.join(', ')}.`
    : `Not feasible: required ${requiredWithOverhead.toFixed(2)} m², available ${totalAvailableM2.toFixed(2)} m² (deficit ${Math.abs(bufferM2).toFixed(2)} m²). Includes: ${ensured.join(', ')}.`;

  return {
    feasible,
    availableM2: totalAvailableM2,
    requiredBaseM2: requiredBase,
    requiredWithOverheadM2: requiredWithOverhead,
    bufferM2,
    breakdown,
    suggestions,
    summary,
    ensured,
    suggestedCounts
  };
}

export default { computeBoundaryAreaPx, pxAreaToSquareMeters, evaluateRequirements };

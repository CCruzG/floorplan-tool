// config.js
// Runtime-configurable unit formatting. By default we report pixels.
let UNIT_SCALE = 1; // multiplier to convert px -> unit (e.g., mm)
let UNIT_LABEL = "px";

export function setScalePixelsPerUnit(pixelsPerUnit, label = 'mm') {
  if (!pixelsPerUnit || typeof pixelsPerUnit !== 'number' || !isFinite(pixelsPerUnit)) return;
  UNIT_SCALE = 1 / pixelsPerUnit; // px * UNIT_SCALE => units
  UNIT_LABEL = label;
}

export function formatLen(pxLen) {
  const v = pxLen * UNIT_SCALE;
  return `${v.toFixed(2)} ${UNIT_LABEL}`;
}

export function getUnitScale() { return UNIT_SCALE; }
export function formatArea(pxArea) {
  // pxArea is in square pixels. Convert to square units using UNIT_SCALE.
  const unitArea = pxArea * (UNIT_SCALE * UNIT_SCALE);
  // Choose a sensible label for squared units
  const label = `${UNIT_LABEL}\u00B2`; // e.g., mm²
  return `${unitArea.toFixed(2)} ${label}`;
}

// Return the configured pixels-per-unit (pxPerUnit). If UNIT_SCALE is
// zero or unset, fall back to 1.
export function getPixelsPerUnit() {
  return UNIT_SCALE ? (1 / UNIT_SCALE) : 1;
}

export function getUnitLabel() { return UNIT_LABEL; }

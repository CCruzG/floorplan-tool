// config.js
export const UNIT_SCALE = 1; // pixels-to-metres or your chosen unit
export const UNIT_LABEL = "px"; // or "m"
export function formatLen(pxLen) {
  const v = pxLen * UNIT_SCALE;
  return `${v.toFixed(2)} ${UNIT_LABEL}`;
}

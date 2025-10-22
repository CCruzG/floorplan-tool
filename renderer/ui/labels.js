// ui/labels.js
export function drawTooltip(ctx, text, x, y, {
  paddingX = 8,
  paddingY = 5,
  radius = 6,
  font = "12px sans-serif",
  bg = "rgba(30, 30, 35, 0.95)",
  fg = "#fff",
  offsetX = 12,
  offsetY = 12,
  maxWidth = 160
} = {}) {
  if (!text) return;

  ctx.save();
  ctx.font = font;

  // measure and constrain text
  const metrics = ctx.measureText(text);
  const textW = Math.min(metrics.width, maxWidth);
  const w = textW + paddingX * 2;
  const h = parseInt(font, 10) + paddingY * 2;

  // position near cursor
  const px = x + offsetX;
  const py = y + offsetY;

  // rounded rect
  ctx.beginPath();
  ctx.moveTo(px + radius, py);
  ctx.arcTo(px + w, py, px + w, py + h, radius);
  ctx.arcTo(px + w, py + h, px, py + h, radius);
  ctx.arcTo(px, py + h, px, py, radius);
  ctx.arcTo(px, py, px + w, py, radius);
  ctx.closePath();

  // fill background
  ctx.fillStyle = bg;
  ctx.fill();

  // text
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, px + w / 2, py + h / 2);

  ctx.restore();
}

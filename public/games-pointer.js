// The canvas bitmap uses object-fit:contain, so its visible image can be
// smaller than the element's box. Aim only within the centered bitmap.
export function nesPointerPosition(rect, clientX, clientY) {
  if (![rect?.left, rect?.top, rect?.width, rect?.height, clientX, clientY].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
  const scale = Math.min(rect.width / 256, rect.height / 240);
  const width = 256 * scale, height = 240 * scale;
  const left = rect.left + (rect.width - width) / 2;
  const top = rect.top + (rect.height - height) / 2;
  if (clientX < left || clientY < top || clientX >= left + width || clientY >= top + height) return null;
  return {x: Math.min(255,Math.floor((clientX-left)/scale)), y: Math.min(239,Math.floor((clientY-top)/scale))};
}

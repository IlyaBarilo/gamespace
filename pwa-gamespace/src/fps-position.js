export const FPS_POSITION_KEY = "gamespace:viewer-fps-position:v1";
export function normalizeFpsPosition(value) {
  return /^(top-left|top-right|bottom-left|bottom-right|middle-left|black-field)$/.test(value) ? value : "top-left";
}

// Keep the saved black-field choice while temporarily falling back inside content.
export function fpsPlacement(value, { landscape, gutterWidth, contentFullscreen } = {}) {
  const position = normalizeFpsPosition(value);
  if (position !== "black-field") return { position, external: false };
  if (!landscape || contentFullscreen || !(gutterWidth >= 140)) return { position: "top-left", external: false };
  return { position: "top-left", external: true, maxWidth: Math.min(280, gutterWidth - 16) };
}

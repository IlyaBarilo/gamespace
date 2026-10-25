export const FPS_POSITION_KEY = "gamespace:viewer-fps-position:v1";
export function toolbarFpsWidth({ width, titleWidth, controlsWidth, padding = 20, gap = 20, sidePanel = false }) {
  if (sidePanel) return 0;
  const available = Math.floor(width - titleWidth - controlsWidth - padding - gap);
  return available >= 80 ? Math.min(260, available) : 0;
}
export function normalizeFpsPosition(value) {
  return /^(toolbar|top-left|top-right|bottom-left|bottom-right|middle-left|black-field)$/.test(value) ? value : "toolbar";
}

// Keep the saved black-field choice while temporarily falling back inside content.
export function fpsPlacement(value, { landscape, gutterWidth, contentFullscreen } = {}) {
  const position = normalizeFpsPosition(value);
  if (position === "toolbar") return contentFullscreen
    ? { position: "top-left", external: false }
    : { position: "top-left", external: true, inline: true };
  if (position !== "black-field") return { position, external: false };
  if (!landscape || contentFullscreen || !(gutterWidth >= 140)) return { position: "top-left", external: false };
  return { position: "top-left", external: true, maxWidth: Math.min(280, gutterWidth - 16) };
}

const UI_MODES = new Set(["mobile", "tv"]);

export function normalizeGameUiMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return UI_MODES.has(mode) ? mode : "";
}

export const VIEWER_ASPECT_RATIO_KEY = "gamespace:viewer-aspect-ratio:v1";
export function normalizeViewerAspectRatio(value) {
  return ["auto", "9:16", "10:16", "16:9", "16:10"].includes(value) ? value : "auto";
}

export function gameContentViewport({ width, height, aspectRatio = "auto" }) {
  const viewportWidth = Math.max(0, Number(width) || 0);
  const viewportHeight = Math.max(0, Number(height) || 0);
  const ratio = normalizeViewerAspectRatio(aspectRatio);
  if (ratio === "auto") {
    return { width: viewportWidth, height: viewportHeight };
  }

  const [widthUnits, heightUnits] = ratio.split(":").map(Number);
  return {
    width: Math.min(viewportWidth, viewportHeight * widthUnits / heightUnits),
    height: viewportHeight,
  };
}

export function detectGameUiMode({ width, height, coarsePointer = false, requested = "" }) {
  const override = normalizeGameUiMode(requested);
  if (override) return override;

  const viewportWidth = Math.max(0, Number(width) || 0);
  const viewportHeight = Math.max(0, Number(height) || 0);
  const shortSide = Math.min(viewportWidth, viewportHeight);
  const longSide = Math.max(viewportWidth, viewportHeight);

  if (coarsePointer && shortSide >= 1000 && longSide >= 1700) return "tv";
  if (!coarsePointer && shortSide >= 1300 && longSide >= 2200) return "tv";
  if (coarsePointer || (shortSide < 700 && longSide < 1000)) return "mobile";
  return "";
}

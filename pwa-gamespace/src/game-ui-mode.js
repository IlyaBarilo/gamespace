const UI_MODES = new Set(["mobile", "tv"]);

export function normalizeGameUiMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return UI_MODES.has(mode) ? mode : "";
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
  if (coarsePointer || shortSide < 700) return "mobile";
  return "";
}

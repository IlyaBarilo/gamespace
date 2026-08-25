export const VERSION_BATCH_SIZE = 3;

export function getVersionBatch(versions, offset, batchSize = VERSION_BATCH_SIZE) {
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeBatchSize = Math.max(1, Number(batchSize) || VERSION_BATCH_SIZE);
  const items = versions.slice(safeOffset, safeOffset + safeBatchSize);
  const nextOffset = safeOffset + items.length;
  return {
    items,
    nextOffset,
    remaining: Math.max(0, versions.length - nextOffset),
  };
}

export function shouldExpandDescription(index, activeIndex) {
  if (activeIndex < 0) return index === 0;
  return index < activeIndex;
}

export function normalizeReleaseDescription(value) {
  return String(value || "Стабильный выпуск GameSpace")
    .replace(/\r\n?/g, "\n")
    .trim();
}

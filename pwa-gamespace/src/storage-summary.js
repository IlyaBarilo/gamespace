function knownBytes(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function summarizeStorage(managedBytes, estimate) {
  const managed = knownBytes(managedBytes) ?? 0;
  const usage = knownBytes(estimate?.usage);
  const reportedQuota = knownBytes(estimate?.quota);
  const quota = reportedQuota > 0 ? reportedQuota : null;
  // The browser estimate already includes site data: never add it a second time.
  // A lower estimate must not hide files already counted by GameSpace.
  const usesManagedSize = managed > 0 && (usage === null || managed > usage);
  const usedBytes = usesManagedSize ? managed : usage;
  const percent = quota !== null && usedBytes !== null
    ? Math.min(100, usedBytes / quota * 100)
    : null;
  return { usage, quota, usedBytes, usesManagedSize, percent };
}

export function formatStoragePercent(percent) {
  if (percent === null) return "—";
  if (percent > 0 && percent < 0.1) return "<0,1%";
  return `${percent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
}

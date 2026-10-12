// Show the official latest release first, then traverse the rest without growing the menu.
export function compareReleaseVersions(left, right) {
  const parse = value => String(value).split("-");
  const [lmain, ...lpre] = parse(left);
  const [rmain, ...rpre] = parse(right);
  const lparts = lmain.split(".").map(Number);
  const rparts = rmain.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (lparts[i] !== rparts[i]) return lparts[i] > rparts[i] ? 1 : -1;
  }
  const lp = lpre.join("-");
  const rp = rpre.join("-");
  if (lp === rp) return 0;
  if (!lp || !rp) return lp ? -1 : 1;
  const li = lp.split(".");
  const ri = rp.split(".");
  for (let i = 0; i < Math.max(li.length, ri.length); i++) {
    if (li[i] === ri[i]) continue;
    if (li[i] === undefined || ri[i] === undefined) return li[i] === undefined ? -1 : 1;
    const ln = /^\d+$/.test(li[i]);
    const rn = /^\d+$/.test(ri[i]);
    if (ln && rn) return Number(li[i]) > Number(ri[i]) ? 1 : -1;
    if (ln !== rn) return ln ? -1 : 1;
    return li[i] > ri[i] ? 1 : -1;
  }
  return 0;
}

export function isNewerRelease(candidate, installed) {
  return compareReleaseVersions(candidate, installed) > 0;
}

export function orderedReleases(catalog) {
  const latest = catalog.versions.find(release => release.version === catalog.latest);
  return [latest, ...catalog.versions.filter(release => release !== latest)
    .sort((a, b) => compareReleaseVersions(b.version, a.version))];
}

export function normalizeReleaseDescription(value) {
  return String(value || "Стабильный выпуск GameSpace")
    .replace(/\r\n?/g, "\n")
    .trim();
}

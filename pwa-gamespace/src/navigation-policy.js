const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export function isAllowedExternalUrl(value, base = globalThis.location?.href) {
  try {
    return ALLOWED_EXTERNAL_PROTOCOLS.has(new URL(value, base).protocol.toLocaleLowerCase("en-US"));
  } catch {
    return false;
  }
}

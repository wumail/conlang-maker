export const DEFAULT_FONT_FEATURES = [
  "ccmp", "rlig", "liga", "clig", "calt", "locl", "mark", "mkmk", "kern",
] as const;

export function parseFontFeature(feature: string): { tag: string; value: number } {
  const match = /^([+-]?)([A-Za-z0-9]{4})(?:=(\d+))?$/.exec(feature.trim());
  if (!match) {
    throw new Error(`Invalid OpenType feature ${feature}`);
  }
  const value = match[3] === undefined
    ? Number(match[1] !== "-")
    : Number(match[3]);
  if (!Number.isSafeInteger(value) || value > 0xffffffff) {
    throw new Error(`Invalid OpenType feature value ${feature}`);
  }
  return { tag: match[2], value };
}

/** Apply language overrides to the shared browser/HarfBuzz baseline. */
export function resolveFontFeatures(overrides: readonly string[] = []): string[] {
  const values = new Map<string, number>(DEFAULT_FONT_FEATURES.map((tag) => [tag, 1]));
  for (const feature of overrides) {
    const { tag, value } = parseFontFeature(feature);
    values.set(tag, value);
  }
  return Array.from(values, ([tag, value]) => `${tag}=${value}`);
}

export function fontFeaturesToCss(features: readonly string[] = []): string {
  return resolveFontFeatures(features)
    .map((feature) => {
      const { tag, value } = parseFontFeature(feature);
      return `"${tag}" ${value}`;
    })
    .join(", ");
}

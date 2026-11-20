/**
 * Where the owner lives decides which venues they may use. Fren asks once at
 * setup ("are you in one of these countries?") and never routes around a block:
 * a yes keeps the venue close-only, and a server's own location still has to
 * pass the venue's check.
 *
 * Polymarket's list, from https://docs.polymarket.com/api-reference/geoblock
 * (checked 2026-11-20): countries and regions where its API is blocked or
 * close-only. Update it when theirs changes.
 */
export const POLYMARKET_RESTRICTED: Record<string, string> = {
  // OFAC: blocked completely
  CU: "Cuba",
  IR: "Iran",
  KP: "North Korea",
  SY: "Syria",
  "UA-43": "Crimea",
  "UA-14": "Donetsk",
  "UA-09": "Luhansk",
  // Close-only on the website and the API
  AR: "Argentina",
  AU: "Australia",
  BE: "Belgium",
  BI: "Burundi",
  BR: "Brazil",
  BY: "Belarus",
  "CA-AB": "Alberta (Canada)",
  "CA-BC": "British Columbia (Canada)",
  "CA-ON": "Ontario (Canada)",
  "CA-QC": "Quebec (Canada)",
  CD: "Congo (Kinshasa)",
  CF: "Central African Republic",
  DE: "Germany",
  ET: "Ethiopia",
  FR: "France",
  GB: "United Kingdom",
  IQ: "Iraq",
  IT: "Italy",
  LB: "Lebanon",
  LY: "Libya",
  MM: "Myanmar",
  NI: "Nicaragua",
  NZ: "New Zealand",
  PL: "Poland",
  RU: "Russia",
  SD: "Sudan",
  SG: "Singapore",
  SK: "Slovakia",
  SO: "Somalia",
  SS: "South Sudan",
  TH: "Thailand",
  TW: "Taiwan",
  UM: "US Minor Outlying Islands",
  US: "United States",
  VE: "Venezuela",
  YE: "Yemen",
  ZW: "Zimbabwe",
};

/** "United States, United Kingdom, …": the list as people read it, most-asked first. */
export function restrictedCountriesText(): string {
  const first = ["US", "GB", "FR", "DE", "IT", "AU", "CA-ON"];
  const rest = Object.keys(POLYMARKET_RESTRICTED)
    .filter((k) => !first.includes(k))
    .sort((a, b) => POLYMARKET_RESTRICTED[a]!.localeCompare(POLYMARKET_RESTRICTED[b]!));
  return [...first, ...rest].map((k) => POLYMARKET_RESTRICTED[k]).join(", ");
}

/** A country name for a code Polymarket's region check returns ("DE" → "Germany"). */
export function countryName(code: string | undefined, region?: string): string {
  if (!code) return "an unknown country";
  const sub = region ? POLYMARKET_RESTRICTED[`${code}-${region}`] : undefined;
  if (sub) return sub;
  if (POLYMARKET_RESTRICTED[code]) return POLYMARKET_RESTRICTED[code]!;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

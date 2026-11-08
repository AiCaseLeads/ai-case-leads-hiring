import { countryOptions } from "../countries";
import { countryRegions } from "../country-regions";

const fold = (value: string) => value.trim().toLowerCase().replace(/\band\b/g,"&");
const codes = new Map(countryOptions.flatMap(({value,label})=>[[fold(value),value],[fold(label),value]]));
for (const [alias,code] of [["usa","US"],["u.s.","US"],["u.s.a.","US"],["uk","GB"],["u.k.","GB"]]) codes.set(alias,code);

/** Free-text fallback for old job postings without a country screening rule. */
export function postingLocationCountries(location = ""): string[] | "worldwide" {
  const place = location.replace(/^(remote|on-site|onsite|hybrid)\s*[·:–-]\s*/i,"").trim();
  if (/^(worldwide|international|global|anywhere|fully remote worldwide)$/i.test(place)) return "worldwide";
  const lookup = (part: string): string[] => {
    const code = codes.get(fold(part));
    if (code) return [code];
    const region = countryRegions.find(item=>fold(item.name)===fold(part));
    return region ? [...region.codes] : [];
  };
  // Office/hybrid addresses use city, region, country order. Interior state
  // abbreviations such as CA are not additional hiring countries.
  if (/^(?:on-site|onsite|hybrid)\s*[·:–-]/i.test(location)) {
    const office = lookup(place);
    return office.length ? office : lookup(place.split(",").at(-1) || "");
  }
  const exact = lookup(place);
  if (exact.length) return exact;
  return [...new Set(place.split(/[,;/]/).flatMap(part => {
    const direct = lookup(part);
    return direct.length ? direct : part.split(/\s+(?:and|&)\s+/i).flatMap(lookup);
  }))];
}
export function matchesResidence(job: {eligibleCountries?: string[] | "worldwide"; location?: string}, country: string) {
  if (!country) return true;
  const allowed = job.eligibleCountries ?? postingLocationCountries(job.location);
  return allowed === "worldwide" || allowed.includes(country);
}

export function countrySummary(allowed: string[] | "worldwide") {
  if (allowed === "worldwide") return "Worldwide";
  if (allowed.length > 4) return `${allowed.length} eligible countries`;
  return allowed.map(code=>countryOptions.find(option=>option.value===code)?.label||code).join(", ");
}

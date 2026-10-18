import { countryOptions } from "../countries";
import { countryRegions } from "../country-regions";
import { formatNumber } from "../hiring/number-format";
import type { ApplicationField } from "../hiring/types";

/** Compress only complete geographic groups; never imply eligibility for an unselected country. */
export function summarizeCountries(values: readonly string[]) {
  const selected = new Set(values);
  const groups = countryRegions.map(region => ({
    name: region.name,
    complete: region.codes.every(code => selected.has(code)),
    countries: countryOptions.filter(option => region.codes.includes(option.value as never) && selected.has(option.value)),
  })).filter(group => group.countries.length);
  const known = new Set(groups.flatMap(group => group.countries.map(country => country.value)));
  const other = [...selected].filter(code => !known.has(code));
  const complete = groups.filter(group => group.complete).map(group => group.name);
  const remaining = groups.filter(group => !group.complete).flatMap(group => group.countries.map(country => country.label)).concat(other);
  const labels = [...complete, ...(remaining.length <= 3 ? remaining : [`${remaining.length} other countries`])];
  return { count: selected.size, groups, other, label: labels.join(" · ") || "No countries selected" };
}

export function screeningValue(value: string | number | boolean | string[], field?: ApplicationField) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return formatNumber(value, field?.numberFormat === "currency");
  if (Array.isArray(value)) return value.join(", ");
  return field?.options?.find(option => option.value === value)?.label || value;
}

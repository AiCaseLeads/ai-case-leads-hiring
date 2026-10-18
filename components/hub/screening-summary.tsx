import type { ApplicationField } from "@/lib/hiring/types";
import { isCountryResidence } from "@/lib/countries";
import { screeningValue, summarizeCountries } from "@/lib/job-setup/screening-summary";
import type { Rule } from "./types";


const conditions: Record<Rule["operator"], string> = {
  gte: "Minimum", lte: "Maximum", equals: "Required answer", not_equals: "Must not equal",
  contains: "Must include", in: "Eligible locations", not_in: "Excluded locations",
};

export function ScreeningSummary({ rules, fields }: { rules: Rule[]; fields: ApplicationField[] }) {
  const enabled = rules.filter(rule => rule.enabled);
  return <section className={"hub-screening-preview-summary"} aria-label="Screening requirements">
    <h4>Screening requirements <span className={"hub-screening-preview-count"}>{enabled.length}</span></h4>
    {!enabled.length ? <p className="hub-muted">No qualifying requirements set.</p> : <ul className={"hub-screening-preview-rules"}>
      {enabled.map((rule, index) => {
        const field = fields.find(item => item.path === rule.fieldPath);
        const countries = field && isCountryResidence(field) && Array.isArray(rule.value) ? summarizeCountries(rule.value) : null;
        return <li key={`${rule.fieldPath}:${rule.operator}:${index}`} className={"hub-screening-preview-rule"}>
          <div className={"hub-screening-preview-question"}>{field?.title || "Application question"}</div>
          <div className={"hub-screening-preview-answer"}><span className={"hub-screening-preview-condition"}>{conditions[rule.operator]}</span><strong>{countries ? countries.label : screeningValue(rule.value, field)}</strong></div>
          {countries && <details className={"hub-screening-preview-countries"}>
            <summary>View {countries.count} selected countries</summary>
            <div className={"hub-screening-preview-countryGroups"}>{countries.groups.map(group => <section key={group.name}>
              <h5>{group.name} <span>({group.countries.length})</span></h5>
              <ul>{group.countries.map(country => <li key={country.value}>{country.label}</li>)}</ul>
            </section>)}{countries.other.length > 0 && <section><h5>Other entries</h5><ul>{countries.other.map(code => <li key={code}>{code}</li>)}</ul></section>}</div>
          </details>}
        </li>;
      })}
    </ul>}
  </section>;
}

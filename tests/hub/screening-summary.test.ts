import test from "node:test";
import assert from "node:assert/strict";
import { summarizeCountries, screeningValue } from "../../lib/job-setup/screening-summary";
import { countryRegions } from "../../lib/country-regions";

test("summary compresses whole regions without listing every country", () => {
  const result = summarizeCountries([...countryRegions[0].codes, ...countryRegions[1].codes]);
  assert.equal(result.label, "Europe · North America");
  assert.equal(result.count, countryRegions[0].codes.length + countryRegions[1].codes.length);
  assert.equal(result.groups.length, 2);
});
test("partial regions do not imply all countries qualify and duplicates do not inflate counts", () => {
  const result = summarizeCountries(["US", "CA", "US"]);
  assert.equal(result.count, 2);
  assert.ok(!result.label.includes("North America"));
  assert.ok(result.label.includes("United States"));
  assert.equal(result.groups[0].complete, false);
  assert.equal(summarizeCountries(countryRegions[0].codes.filter(code => code !== "FR")).groups[0].complete, false);
});
test("numeric and dollar summaries retain readable thresholds and booleans", () => {
  assert.equal(screeningValue(30000), "30,000");
  assert.equal(screeningValue(30000, {path:"spend", title:"Spend", type:"Number", required:true, numberFormat:"currency", currency:"USD"}), "$30,000.00");
  assert.equal(screeningValue(false), "No");
  assert.equal(screeningValue(true), "Yes");
  assert.equal(summarizeCountries([]).label, "No countries selected");
});

import assert from "node:assert/strict";
import test from "node:test";
import { summarizeClaim } from "../../lib/hub/claim-summary";

function summary(explanation: string) {
  return summarizeClaim({criterion:"Production ML experience", status:"needs_verification", explanation, citations:[]}, "Alex Example");
}

test("historical claim summaries keep ambiguous answers and distinct follow-up questions", () => {
  const text = summary('Resume summary claims 12+ years shipping production systems, while application answers list "Years of software or ML engineering" as "8p". Which is the correct total years and how many of those were on ML or marketing-data systems in production?');
  assert.match(text, /12\+/);
  assert.match(text, /"Years of software or ML engineering" as "8p"/);
  assert.match(text, /how many of those were on ML/i);
  assert.doesNotMatch(text, /8 years|Alex/);
});

test("source excerpts embedded inside a legacy explanation stay out of the summary", () => {
  assert.equal(summary('Confirm when the project began. Résumé excerpt: Alex Example • linkedin.com/in/example'), "Confirm when the project began.");
  assert.equal(summary('Alex Example reports two launches.\nApplication: {"question":"Desired pay","answer":"4000"}'), "The applicant reports two launches.");
});

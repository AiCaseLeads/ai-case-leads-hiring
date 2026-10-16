import test from "node:test";
import assert from "node:assert/strict";
import { applicationPdf, exportReportPdf, type ReadableApplication } from "../../lib/pdf/application";
import { readablePdf } from "./readable";

export const fixture: ReadableApplication = {
  id: "synthetic-readable-application", name: "María González - Алексей", email: "synthetic@example.invalid", jobId: "synthetic-job", jobTitle: "Creative Strategist", stage: "Screening", revision: 3, createdAt: 1760553600000,
  fields: [{ path: "years", title: "Years of experience", type: "Number", required: true }, { path: "ready", title: "Available for interviews?", type: "Boolean", required: true }, { path: "tools", title: "Tools used", type: "MultiValueSelect", required: true, options: [{ value: "figma", label: "Figma" }] }, { path: "resume", title: "Resume", type: "File", required: true }],
  answers: [{ path: "years", value: 7 }, { path: "ready", value: false }, { path: "tools", value: ["figma"] }, { path: "resume", value: "resume-file" }],
  files: [{ id: "resume-file", filename: "Original résumé.pdf", size: 400, contentType: "application/pdf", url: "/api/files/secret" }], qualification: "pass",
  aiMatch: { status: "ready", score: 88, model: "openai/gpt-5-mini", criteria: [{ criterion: "Direct response creative", status: "evidence_found", explanation: "Built twelve video briefs with measured conversion gains.", citations: [{ source: "resume", quote: "Created twelve video briefs for paid social campaigns." }] }], checks: [{ question: "Which campaigns improved conversion?", citations: [] }] },
  assessments: [{ status: "submitted", prompt: "Write a campaign brief", answer: "Original assessment answer", assessmentUrl: "/assessment/secret-link" }],
  interviews: [{ status: "booked", start: "2026-10-21T15:00:00Z", end: "2026-10-21T15:30:00Z", timeZone: "America/Bogota", attended: true, bookingUrl: "/interview/secret-link" }],
  history: [{ type: "note", text: "Human interview verification note", actor: "reviewer@example.invalid", createdAt: 1760553600000 }],
  communications: [{ subject: "Assessment follow-up", body: "Please complete the exercise.", status: "sent", createdAt: 1760553600000 }],
  jobDescription: { descriptionHtml: "<p><strong>Responsibilities</strong></p><ul><li>Build briefs &amp; test creative.</li></ul>", formVersion: 4 },
};

test("application PDFs preserve readable answers, evidence, submissions and history without exposing capability URLs", async () => {
  const bytes = await applicationPdf(fixture), parsed = await readablePdf(bytes);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), "%PDF-");
  for (const expected of [fixture.name, "Shortlisted", "Years of experience", "7", "Available for interviews?", "No", "Figma", "Original résumé.pdf", "88 / 100", "Built twelve video briefs", "Created twelve video briefs", "Original assessment answer", "Human interview verification note", "Please complete the exercise.", "Build briefs & test creative."]) assert.ok(parsed.text.includes(expected), expected);
  assert.ok(!parsed.text.includes("secret-link")); assert.ok(!parsed.text.includes("/api/files/secret"));
  assert.ok(!parsed.text.includes("application.json"));
  assert.ok(parsed.pages.length >= 2);
});
test("repeated application revisions produce identical PDF bytes and long text stays inside page bounds", async () => {
  const input = { ...fixture, name: "S".repeat(200), answers: [{ path: "long", value: ("Detailed project experience ".repeat(300) + "https://example.invalid/" + "a".repeat(250)) }] };
  const first = await applicationPdf(input), second = await applicationPdf(input);
  assert.deepEqual(first, second, "Idempotent Drive upload requires stable font subsets and metadata");
  const parsed = await readablePdf(first);
  assert.ok(parsed.pages.length > 3);
  for (const item of parsed.positions) {
    assert.ok(item.x >= 43 && item.x + item.width <= 570, `horizontal bounds on page ${item.page}: ${item.text}`);
    assert.ok(item.y >= 30 && item.y <= 759, `vertical bounds on page ${item.page}: ${item.text}`);
  }
});
test("unsupported international characters remain explicit and recoverable rather than disappearing", async () => {
  const parsed = await readablePdf(await applicationPdf({ ...fixture, name: "王 明" }));
  assert.ok(parsed.text.includes("[U+738B] [U+660E]"));
  assert.ok(parsed.text.includes("Unicode code points"));
});
test("bulk download report identifies missing originals in a readable PDF", async () => {
  const parsed = await readablePdf(await exportReportPdf({ jobId: "job", applicationCount: 2, includedFiles: 3, exportedAt: 1760553600000, missingFiles: [{ applicationId: "app", fileId: "file", filename: "Missing résumé.pdf", reason: "File missing from storage" }] }));
  for (const expected of ["Application download report", "Missing résumé.pdf", "File missing from storage", "Application ID: app"]) assert.ok(parsed.text.includes(expected));
});
test('AI audit events are readable and preserve older evidence without dumping JSON',async()=>{
 const saved={model:'openai/gpt-5-mini',version:3,score:88,review:{criteria:[{criterion:'Earlier creative requirement',status:'evidence_found',explanation:'Produced twelve earlier campaign briefs.',citations:[{source:'resume',quote:'Twelve earlier briefs.'}]}],checks:[{question:'Verify earlier campaign results.'}]}};
 const timestamp=1760553600000;
 const parsed=await readablePdf(await applicationPdf({...fixture,aiMatch:{...fixture.aiMatch as object,updatedAt:timestamp},history:[
  {type:'ai_match',text:JSON.stringify(saved),createdAt:timestamp-1000},
  {type:'ai_match',text:JSON.stringify(saved),createdAt:timestamp},
  {type:'note',text:'A plain recruiter note',createdAt:timestamp},
 ]}));
 for(const expected of ['AI review recorded.','Earlier creative requirement','Twelve earlier briefs.','Verify earlier campaign results.','See AI job match above','A plain recruiter note'])assert.ok(parsed.text.replace(/\s+/g,' ').includes(expected),expected);
 assert.ok(!parsed.text.includes('{"model"'));assert.ok(!parsed.text.includes('"sourceWarnings":'));
});

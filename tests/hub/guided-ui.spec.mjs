import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

const member = { email: "sales@aicaseleads.com", role: "admin", isOwner: true };
const fixture = {
  settingsVersion: 7,
  members: [member],
  google: { connected: true, sender: member.email, expectedSender: member.email, calendarId: "shared@example.invalid", driveRootId: "0AFEhbfGTJcYhUk9PVA" },
  queue: { pending: 0, failed: 0 },
  templates: { rejection: "Thank you for applying." },
  applicationsEnabled: true,
  scheduling: { timeZone: "America/Bogota", startHour: 10, endHour: 16, durationMinutes: 30, weekdays: [1, 2, 3, 4, 5], configured: true, remindersEnabled: false },
};
async function setup(t, configured = true, mode = "settings", aiEnabled = false) {
  const entry = mode === "settings"
    ? `import {HubSettings} from './components/hub/settings'; createRoot(document.getElementById('root')).render(<HubSettings member={${JSON.stringify(member)}} refresh={0} changed={()=>{}} />);`
    : mode === "candidate-draft"
      ? `import {CandidateEvidence, useEvidenceDraft} from './components/hub/ai-review'; function DetailHarness() { const draft=useEvidenceDraft(); const [loading,setLoading]=React.useState(false); const [revision,setRevision]=React.useState(9); return <><button onClick={()=>setLoading(true)}>Refresh detail</button>{loading ? <button onClick={()=>{setRevision(v=>v+1);setLoading(false);}}>Finish detail refresh</button> : <CandidateEvidence key="application-test" detail={{id:"application-test",revision}} draft={draft} saved={()=>setLoading(true)} />}</>; } createRoot(document.getElementById('root')).render(<DetailHarness />);`
      : `import {CandidateEvidence} from './components/hub/ai-review'; createRoot(document.getElementById('root')).render(<CandidateEvidence detail={{id:"application-test", revision:9}} saved={()=>{}} />);`;
  const { outputFiles } = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; ${entry}`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "iife", jsx: "automatic" });
  const server = createServer((req, res) => { res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html"); res.end(req.url === "/bundle.js" ? outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>'); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const localChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({ headless: true, ...(existsSync(localChrome) ? { executablePath: localChrome } : {}) });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const writes = [], aiWrites = [], actions = [], reviews = [];
  await page.route("**/api/hub/settings", async route => {
    if (route.request().method() === "PATCH") {
      writes.push(route.request().postDataJSON());
      await route.fulfill({ status: 409, json: { error: { message: "Settings changed. Refresh and try again." } } });
    } else await route.fulfill({ json: { data: fixture } });
  });
  await page.route("**/api/google/status", route => route.fulfill({ json: { data: { configured, hostingPlatform: "railway", backgroundEnabled: configured, credentialsManaged: true, expectedSender: member.email } } }));
  await page.route("**/api/ai/config", async route => {
    if (route.request().method() === "PATCH") aiWrites.push(route.request().postDataJSON());
    await route.fulfill({ json: { data: { enabled: aiEnabled, configured: true, model: "openai/gpt-5-mini", provider: "openrouter", reviewOnly: true } } });
  });
  await page.route("**/api/hub/applications/application-test/action", async route => { actions.push(route.request().postDataJSON()); await route.fulfill({ json: { data: { revision: 10 } } }); });
  await page.route("**/api/ai/review", async route => { reviews.push(route.request().postDataJSON()); await route.fulfill({ json: { data: { revision: 10 } } }); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  if(mode === "settings") await page.getByRole("button",{name:"Company setup",exact:true}).click();
  await page.getByRole("heading", { name: mode === "settings" ? "1. Company Drive & fallback calendar" : "Evidence & verification" }).waitFor();
  return { page, writes, aiWrites, actions, reviews };
}

test("guided connections save a pasted Drive folder and selected calendar without changing approved hours or revision", async t => {
  const { page, writes } = await setup(t);
  assert.deepEqual((await page.getByRole("heading", { level: 3 }).allTextContents()).filter(value => /^[123]\./.test(value)), ["1. Company Drive & fallback calendar", "2. Shared fallback interview calendar", "3. Choose the shared applicant folder"]);
  assert.equal(await page.getByText("Advanced admin setup", { exact: true }).evaluate(element => element.parentElement.open), false);
  assert.equal(await page.getByRole("link", { name: "Open saved folder" }).getAttribute("href"), "https://drive.google.com/drive/folders/0AFEhbfGTJcYhUk9PVA");
  await page.getByRole("button", { name: "Use sales@aicaseleads.com calendar" }).click();
  await page.getByLabel("Shared Google Drive folder", { exact: true }).fill("https://evil.example/drive/folders/0AFEhbfGTJcYhUk9PVA");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await page.getByText("Paste a Google Drive folder link", { exact: false }).waitFor();
  assert.equal(writes.length, 0);
  await page.getByLabel("Shared Google Drive folder", { exact: true }).fill("https://drive.google.com/drive/u/0/folders/0AFEhbfGTJcYhUk9PVA?usp=sharing");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await page.getByText("Settings changed. Refresh and try again.", { exact: true }).waitFor();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].settingsVersion, 7);
  assert.equal(writes[0].calendarId, member.email);
  assert.equal(writes[0].driveRootId, fixture.google.driveRootId);
  assert.equal(writes[0].interviewTimeZone, "America/Bogota");
  assert.deepEqual([writes[0].interviewStartHour, writes[0].interviewEndHour, writes[0].interviewDurationMinutes], [10, 16, 30]);
  assert.deepEqual(writes[0].interviewWeekdays, [1, 2, 3, 4, 5]);
  assert.equal(await page.getByLabel("Interview calendar", { exact: true }).inputValue(), member.email);
});

test("missing client and scheduler configuration remain visible outside collapsed advanced setup", async t => {
  const { page } = await setup(t, false);
  await page.getByText("Google client setup is missing.", { exact: false }).waitFor();
  await page.getByText("Automatic email, calendar, and file processing is disabled.", { exact: false }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Reconnect Google Workspace", exact: false }).isDisabled(), true);
  assert.equal(await page.getByText("Advanced admin setup", { exact: true }).evaluate(element => element.parentElement.open), false);
});


test("saved AI connection keeps its secret when key is left blank and uses a password input", async t => {
  const { page, aiWrites } = await setup(t);
  await page.locator("summary").filter({hasText:/^AI connection$/}).click();
  const key = page.getByLabel("Replace OpenRouter API key (optional)");
  await key.waitFor();
  assert.equal(await key.getAttribute("type"), "password");
  assert.equal(await key.inputValue(), "");
  assert.equal(await page.getByRole("button", { name: "Save AI connection", exact: true }).isDisabled(), false);
  await page.getByRole("button", { name: "Save AI connection", exact: true }).click();
  await page.getByText("AI review settings saved.", { exact: false }).waitFor();
  assert.deepEqual(aiWrites, [{ enabled: false }]);
});

test("manual verification records evidence with revision while inactive AI cannot submit a review", async t => {
  const { page, actions, reviews } = await setup(t, true, "candidate");
  await page.getByText("Compare résumé, profile and application with AI", { exact: true }).click();
  await page.getByText("AI review is off.", { exact: false }).waitFor();
  await page.getByLabel("Job requirements to check", { exact: true }).fill("Experience with TypeScript");
  await page.getByLabel("Share the selected résumé text, profile excerpts and application answers", { exact: false }).check();
  assert.equal(await page.getByRole("button", { name: "Generate evidence review" }).isDisabled(), true);
  await page.getByText("Record verification checks", { exact: true }).click();
  await page.getByLabel("Résumé and profile dates or roles compared", { exact: true }).selectOption("Needs candidate clarification");
  await page.getByLabel("Evidence and follow-up notes", { exact: true }).fill("Candidate confirmed the portfolio contribution in a live discussion; follow up on start date.");
  await page.getByRole("button", { name: "Save verification notes" }).click();
  await page.getByText("Verification notes saved", { exact: false }).waitFor();
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, "note");
  assert.equal(actions[0].expectedRevision, 9);
  assert.match(actions[0].text, /Needs candidate clarification/);
  assert.match(actions[0].text, /live discussion/);
  assert.equal(reviews.length, 0);
  assert.equal(actions[0].score, undefined);
});

test("AI review requires per-review sharing consent and sends evidence without a ranking mutation", async t => {
  const { page, actions, reviews } = await setup(t, true, "candidate", true);
  await page.getByText("Compare résumé, profile and application with AI", { exact: true }).click();
  await page.getByLabel("Résumé excerpts", { exact: true }).fill("Built TypeScript dashboards at Example Co.");
  await page.getByLabel("Candidate-supplied LinkedIn / experience excerpts (optional)", { exact: true }).fill("Engineer at Example Co.");
  await page.getByLabel("Job requirements to check", { exact: true }).fill("Experience with TypeScript");
  assert.equal(await page.getByRole("button", { name: "Generate evidence review" }).isDisabled(), true);
  await page.getByLabel("Share the selected résumé text, profile excerpts and application answers", { exact: false }).check();
  await page.getByRole("button", { name: "Generate evidence review" }).click();
  await page.getByText("AI evidence review saved", { exact: false }).waitFor();
  assert.deepEqual(reviews, [{ applicationId: "application-test", expectedRevision: 9, resumeText: "Built TypeScript dashboards at Example Co.", linkedinText: "Engineer at Example Co.", jobCriteria: "Experience with TypeScript", consent: true }]);
  assert.equal(actions.length, 0);
  assert.equal(await page.getByRole("button", { name: "Generate evidence review" }).isDisabled(), true);
});


test("candidate evidence draft survives detail unmount and revision refresh after a manual verification save", async t => {
  const { page, actions, reviews } = await setup(t, true, "candidate-draft", true);
  const aiSummary = page.getByText("Compare résumé, profile and application with AI", { exact: true });
  const manualSummary = page.getByText("Record verification checks", { exact: true });
  await aiSummary.click();
  await page.getByLabel("Résumé excerpts", { exact: true }).fill("Built TypeScript dashboards at Example Co.");
  await page.getByLabel("Candidate-supplied LinkedIn / experience excerpts (optional)", { exact: true }).fill("Engineer at Example Co.");
  await page.getByLabel("Job requirements to check", { exact: true }).fill("Experience with TypeScript");
  await page.getByLabel("Share the selected résumé text, profile excerpts and application answers", { exact: false }).check();
  await manualSummary.click();
  await page.getByLabel("Résumé and profile dates or roles compared", { exact: true }).selectOption("Needs candidate clarification");
  await page.getByLabel("Evidence and follow-up notes", { exact: true }).fill("Ask candidate to clarify the date.");
  await page.getByRole("button", { name: "Save verification notes" }).click();
  await page.getByRole("button", { name: "Finish detail refresh" }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Evidence & verification" }).count(), 0);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].expectedRevision, 9);
  await page.getByRole("button", { name: "Finish detail refresh" }).click();
  await aiSummary.click();
  assert.equal(await page.getByLabel("Résumé excerpts", { exact: true }).inputValue(), "Built TypeScript dashboards at Example Co.");
  assert.equal(await page.getByLabel("Candidate-supplied LinkedIn / experience excerpts (optional)", { exact: true }).inputValue(), "Engineer at Example Co.");
  assert.equal(await page.getByLabel("Job requirements to check", { exact: true }).inputValue(), "Experience with TypeScript");
  await manualSummary.click();
  assert.equal(await page.getByLabel("Evidence and follow-up notes", { exact: true }).inputValue(), "");
  assert.equal(await page.getByLabel("Résumé and profile dates or roles compared", { exact: true }).inputValue(), "Needs candidate clarification");
  await page.getByRole("button", { name: "Refresh detail", exact: true }).click();
  await page.getByRole("button", { name: "Finish detail refresh" }).click();
  await aiSummary.click();
  assert.equal(await page.getByLabel("Résumé excerpts", { exact: true }).inputValue(), "Built TypeScript dashboards at Example Co.");
  await page.getByRole("button", { name: "Generate evidence review" }).click();
  await page.getByRole("button", { name: "Finish detail refresh" }).waitFor();
  assert.deepEqual(reviews, [{ applicationId: "application-test", expectedRevision: 11, resumeText: "Built TypeScript dashboards at Example Co.", linkedinText: "Engineer at Example Co.", jobCriteria: "Experience with TypeScript", consent: true }]);
  await page.getByRole("button", { name: "Finish detail refresh" }).click();
  await aiSummary.click();
  assert.equal(await page.getByLabel("Share the selected résumé text, profile excerpts and application answers", { exact: false }).isChecked(), false);
  assert.equal(await page.getByRole("button", { name: "Generate evidence review" }).isDisabled(), true);
  assert.equal(await page.getByLabel("Résumé excerpts", { exact: true }).inputValue(), "Built TypeScript dashboards at Example Co.");
});

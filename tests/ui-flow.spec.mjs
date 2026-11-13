import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { chromium } from "playwright";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:5173";
const jobIds = {
  "full-stack-engineer": "11111111-1111-4111-8111-111111111111",
  "creative-strategist": "22222222-2222-4222-8222-222222222222",
};
const fieldHelp = "Include a link to work you can discuss in an interview. <script>window.__FORM_HELP_INJECTION__ = true</script>";
const fields = [
  { path: "_systemfield_name", title: "Full name", type: "String", required: true },
  { path: "_systemfield_email", title: "Email address", type: "Email", required: true },
  { path: "_systemfield_resume", title: "Resume", type: "File", required: true },
  { path: "portfolio", title: "Portfolio or work samples", type: "SocialLink", required: false, description: fieldHelp },
  { path: "availability", title: "Available for an interview?", type: "Boolean", required: true },
];
function job(slug) {
  return { id: jobIds[slug], slug, title: slug === "full-stack-engineer" ? "Full-stack Engineer" : "Creative Strategist", department: slug === "full-stack-engineer" ? "Engineering" : "Creative", descriptionHtml: "<p>Editable synthetic role details.</p>" };
}
const resume = { name: "sample-resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nSynthetic verification resume\n%%EOF") };

async function browserPage(viewport = { width: 1440, height: 1000 }) {
  const localChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(localChrome) ? localChrome : undefined);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  return { page, context, close: () => browser.close() };
}
async function mockLiveApi(page, slug, submissionResponse, formFields = fields) {
  const submissions = [], uploads = [];
  await page.route("**/api/jobs", route => route.fulfill({ json: { jobs: Object.keys(jobIds).map(job), mode: "live", submissionEnabled: true } }));
  await page.route("**/api/jobs/*", route => route.fulfill({ json: { job: job(slug), mode: "live", submissionEnabled: true } }));
  await page.route("**/api/jobs/*/form", route => route.fulfill({ json: { fields: formFields, formVersion: 1 } }));
  await page.route("**/api/application-verification", route => route.fulfill({ json: { required: false, configured: false } }));
  await page.route("**/api/uploads", async route => {
    uploads.push(route.request().postDataJSON());
    await route.fulfill({ json: { url: "https://upload.invalid/verification", fields: { key: "synthetic-resume" }, handle: "synthetic-upload-handle" } });
  });
  await page.route("https://upload.invalid/verification", route => route.fulfill({ status: 204, body: "" }));
  await page.route("**/api/applications", async route => {
    submissions.push(route.request().postDataJSON());
    await submissionResponse(route, submissions.length);
  });
  await page.route("**/api/applications/*", route => route.fulfill({ json: { status: "accepted" } }));
  return { submissions, uploads };
}
async function openApplication(page) {
  const open = page.getByRole("button", { name: "Continue to application", exact: true });
  if (await page.getByLabel("Full name", { exact: false }).count()) return;
  await open.waitFor();
  await open.click();
}
async function fillApplication(page) {
  await openApplication(page);
  await page.getByLabel("Full name", { exact: false }).fill("Synthetic Candidate");
  await page.getByLabel("Email address", { exact: false }).fill("candidate@example.test");
  await page.locator('input[type="file"]').setInputFiles(resume);
  await page.getByLabel("Portfolio or work samples", { exact: false }).fill("https://example.test/portfolio");
  await page.getByRole("radio", { name: "No", exact: true }).click();
}
async function assertFits(page) {
  const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
  assert.ok(dimensions.content <= dimensions.viewport + 1, `Horizontal overflow: ${JSON.stringify(dimensions)}`);
}

test("real custom API hides drafts and paused intake; public navigation and private sign-in work on desktop and mobile", async () => {
  const response = await fetch(`${baseUrl}/api/jobs`);
  assert.equal(response.status, 200, "Start the integrated local server before running UI tests.");
  const catalog = await response.json();
  assert.equal(catalog.mode, "live");
  assert.equal(catalog.submissionEnabled, false, "This suite's real API smoke check must use paused custom intake.");
  assert.deepEqual(catalog.jobs, [], "Draft jobs must not be advertised as open roles.");
  const disabledSubmission = await fetch(`${baseUrl}/api/applications`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: new URL(baseUrl).origin, Cookie: `hiring_session=${"a".repeat(64)}` },
    body: JSON.stringify({ jobPostingId: jobIds["full-stack-engineer"], submissionKey: crypto.randomUUID(), fieldSubmissions: [], utmData: {} }),
  });
  assert.equal(disabledSubmission.status, 503);
  assert.notEqual((await disabledSubmission.json()).status, "accepted");
  const closedRole = await fetch(`${baseUrl}/api/jobs/unpublished-or-closed-role`);
  assert.equal(closedRole.status, 404);
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 319, height: 844 }]) {
    const { page, close } = await browserPage(viewport);
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    try {
      await page.goto(baseUrl);
      await page.getByRole("heading", { name: "No openings right now", exact: true }).waitFor();
      for (const name of ["Opportunities", "Our process", "Hiring team"]) {
        assert.equal(await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name, exact: true }).isVisible(), true);
      }
      await page.getByRole("link", { name: "Explore opportunities", exact: true }).click();
      await page.waitForURL(`${baseUrl}/#positions`);
      await assertFits(page);
      await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Our process", exact: true }).click();
      await page.waitForURL(`${baseUrl}/#process`);
      await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Hiring team", exact: true }).click();
      await page.waitForURL(`${baseUrl}/team`);
      await page.getByRole("heading", { name: "Your team’s hiring hub.", exact: true }).waitFor();
      const railway = process.env.TEST_HOSTING_PLATFORM === "railway";
      if (railway) {
        const login = page.getByRole("button", { name: "Sign in with Google", exact: true });
        assert.equal(await login.isEnabled(), true);
        assert.equal(await page.locator('form.team-sign-in').getAttribute("action"), "/api/auth/google/start");
        assert.equal(await page.locator('input[name="return_to"]').inputValue(), "/team");
        assert.equal(await page.getByRole("checkbox", { name: "Keep me signed in for 30 days", exact: true }).isChecked(), false);
      } else {
        const login = page.getByRole("link", { name: "Sign in to the hiring hub", exact: true });
        assert.equal(await login.getAttribute("href"), "/signin-with-chatgpt?return_to=%2Fteam");
      }
      assert.equal(await page.getByRole("link", { name: "Request Ashby setup", exact: false }).count(), 0);
      await assertFits(page);
      await page.getByRole("link", { name: "Applicant privacy", exact: true }).click();
      await page.waitForURL(`${baseUrl}/privacy`);
      await page.getByRole("link", { name: "Careers home", exact: true }).click();
      await page.waitForURL(`${baseUrl}/`);
      await page.getByRole("heading", { name: "No openings right now", exact: true }).waitFor();
      assert.deepEqual(pageErrors, [], "All published navigation paths must work without client runtime errors.");
    } finally { await close(); }
  }
});

test("arbitrary receipt never displays a successful application against the real API", async () => {
  const { page, close } = await browserPage();
  try {
    await page.goto(`${baseUrl}/applications/forged-receipt-that-was-never-issued`);
    await page.getByRole("heading", { name: "We couldn’t confirm your application.", exact: true }).waitFor();
    assert.equal(await page.getByText("Application received securely", { exact: true }).count(), 0);
    const apiResponse = await fetch(`${baseUrl}/api/applications/forged-receipt-that-was-never-issued`);
    assert.ok([400, 404].includes(apiResponse.status));
    assert.notEqual((await apiResponse.json()).status, "accepted");
  } finally { await close(); }
});

test("production build assets and missing assets cannot persist in browser caches", async (t) => {
  if (process.env.TEST_PRODUCTION_ASSETS !== "true") {
    t.skip("Requires the built production Worker asset binding.");
    return;
  }
  const home = await fetch(baseUrl);
  assert.equal(home.status, 200);
  const html = await home.text();
  const assetPaths = [...html.matchAll(/(?:src|href)="([^"<>]*\/_next\/static\/[^"<>]+)"/g)].map(match => match[1]);
  assert.ok(assetPaths.some(path => path.includes(".js")), "The built page must reference JavaScript assets.");
  assert.ok(assetPaths.some(path => path.includes(".css")), "The built page must reference CSS assets.");
  for (const path of new Set(assetPaths)) {
    const asset = await fetch(new URL(path, baseUrl));
    assert.equal(asset.status, 200, path);
    assert.match(asset.headers.get("cache-control") ?? "", /no-store/i, path);
  }
  const missing = await fetch(`${baseUrl}/_next/static/nonexistent-deployment-asset.js`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("cache-control") ?? "", /no-store/i);
  assert.equal(missing.headers.get("etag"), null);
});

for (const slug of Object.keys(jobIds)) {
  test(`mocked live API ${slug}: required fields, upload contract, and confirmed redirect`, async () => {
    const { page, close } = await browserPage(slug === "creative-strategist" ? { width: 390, height: 844 } : undefined);
    try {
      const { submissions, uploads } = await mockLiveApi(page, slug, route => route.fulfill({ status: 201, json: { status: "accepted", receipt: "verified-receipt" } }));
      await page.goto(`${baseUrl}/jobs/${slug}?utm_source=verification&utm_campaign=role-test`);
      await openApplication(page);
      await page.getByText(fieldHelp, { exact: true }).waitFor();
      assert.equal(await page.locator('[id="portfolio-help"] script').count(), 0);
      assert.equal(await page.evaluate(() => window.__FORM_HELP_INJECTION__), undefined);
      assert.match(await page.getByLabel("Portfolio or work samples", { exact: false }).getAttribute("aria-describedby"), /portfolio-help/);
      await page.getByRole("button", { name: "Submit application", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Please check the highlighted fields." }).waitFor();
      assert.equal(submissions.length, 0);
      assert.equal(uploads.length, 0);
      await fillApplication(page);
      await assertFits(page);
      await page.getByRole("button", { name: "Submit application", exact: true }).click();
      await page.waitForURL("**/applications/verified-receipt");
      await page.getByRole("heading", { name: "You’re on our radar.", exact: true }).waitFor();
      assert.equal(submissions.length, 1);
      assert.equal(uploads.length, 1);
      assert.equal(uploads[0].fieldPath, "_systemfield_resume");
      assert.equal(uploads[0].contentType, "application/pdf");
      assert.equal(uploads[0].contentLength, resume.buffer.length);
      assert.equal(submissions[0].jobPostingId, jobIds[slug]);
      assert.equal(submissions[0].formVersion, 1);
      assert.deepEqual(submissions[0].utmData, { utm_source: "verification", utm_campaign: "role-test" });
      assert.equal(submissions[0].fieldSubmissions.find(field => field.path === "availability").value, false);
      assert.equal(submissions[0].fieldSubmissions.find(field => field.path === "_systemfield_resume").value, "synthetic-upload-handle");
      assert.match(submissions[0].submissionKey, /^[0-9a-f-]{36}$/i);
      assert.ok(!JSON.stringify(submissions).includes("apiKey"));
    } finally { await close(); }
  });
}

test("uncertain outcome freezes edits and rechecks the identical payload without a second upload", async () => {
  const { page, close } = await browserPage();
  try {
    const { submissions, uploads } = await mockLiveApi(page, "full-stack-engineer", (route, attempt) => attempt === 1
      ? route.fulfill({ status: 202, json: { status: "pending", message: "Pending provider confirmation" } })
      : route.fulfill({ status: 201, json: { status: "accepted", receipt: "same-submission-receipt" } }));
    await page.goto(`${baseUrl}/jobs/full-stack-engineer`);
    await fillApplication(page);
    await page.getByRole("button", { name: "Submit application", exact: true }).click();
    await page.getByRole("button", { name: "Check submission status", exact: true }).waitFor();
    assert.equal(await page.getByLabel("Full name", { exact: false }).isDisabled(), true);
    assert.equal(await page.getByRole("heading", { name: "You’re on our radar.", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Check submission status", exact: true }).click();
    await page.waitForURL("**/applications/same-submission-receipt");
    assert.equal(uploads.length, 1);
    assert.equal(submissions.length, 2);
    assert.deepEqual(submissions[1], submissions[0]);
  } finally { await close(); }
});

test("invalid files stay local and upload failures retain all entered answers", async () => {
  const { page, close } = await browserPage();
  try {
    const { submissions } = await mockLiveApi(page, "creative-strategist", route => route.fulfill({ status: 201, json: { status: "accepted", receipt: "unused" } }));
    await page.goto(`${baseUrl}/jobs/creative-strategist`);
    await openApplication(page);
    await page.getByLabel("Full name", { exact: false }).fill("Synthetic Candidate");
    await page.locator('input[type="file"]').setInputFiles({ name: "unsafe.exe", mimeType: "application/octet-stream", buffer: Buffer.from("synthetic") });
    await page.getByText("Please upload a PDF, DOC, or DOCX file.", { exact: true }).waitFor();
    await page.locator('input[type="file"]').setInputFiles({ name: "oversized.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
    await page.getByText("Please choose a file smaller than 10 MB.", { exact: true }).waitFor();
    await fillApplication(page);
    await page.route("https://upload.invalid/verification", route => route.fulfill({ status: 403, body: "Expired upload" }));
    await page.getByRole("button", { name: "Submit application", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Your file upload didn’t finish." }).waitFor();
    assert.equal(await page.getByLabel("Full name", { exact: false }).inputValue(), "Synthetic Candidate");
    assert.equal(await page.getByLabel("Email address", { exact: false }).inputValue(), "candidate@example.test");
    assert.equal(await page.getByLabel("Full name", { exact: false }).isDisabled(), false);
    assert.equal(submissions.length, 0);
    assert.equal(await page.locator(".chosen-file").filter({ hasText: "sample-resume.pdf" }).count(), 1);
  } finally { await close(); }
});

test("malformed response after a submitted write stays uncertain and cannot show success", async () => {
  const { page, close } = await browserPage();
  try {
    const { submissions, uploads } = await mockLiveApi(page, "full-stack-engineer", (route, attempt) => attempt === 1
      ? route.fulfill({ status: 502, contentType: "text/html", body: "<p>Lost upstream response</p>" })
      : route.fulfill({ status: 202, json: { status: "pending" } }));
    await page.goto(`${baseUrl}/jobs/full-stack-engineer`);
    await fillApplication(page);
    await page.getByRole("button", { name: "Submit application", exact: true }).click();
    await page.getByRole("button", { name: "Check submission status", exact: true }).waitFor();
    assert.equal(await page.getByLabel("Email address", { exact: false }).isDisabled(), true);
    assert.ok(!page.url().includes("/applications/"));
    await page.getByRole("button", { name: "Check submission status", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "We’re checking whether your application was received." }).waitFor();
    assert.equal(uploads.length, 1);
    assert.equal(submissions.length, 2);
    assert.deepEqual(submissions[1], submissions[0]);
  } finally { await close(); }
});

test("reload after an uncertain write restores the frozen payload and the same submission key", async () => {
  const { page, close } = await browserPage();
  try {
    const { submissions, uploads } = await mockLiveApi(page, "full-stack-engineer", (route, attempt) => attempt === 1
      ? route.fulfill({ status: 202, json: { status: "pending" } })
      : route.fulfill({ status: 201, json: { status: "accepted", receipt: "reload-recovery-receipt" } }));
    await page.goto(`${baseUrl}/jobs/full-stack-engineer`);
    await fillApplication(page);
    await page.getByRole("button", { name: "Submit application", exact: true }).click();
    await page.getByRole("button", { name: "Check submission status", exact: true }).waitFor();
    await page.reload();
    await openApplication(page);
    await page.getByRole("button", { name: "Check submission status", exact: true }).waitFor();
    assert.equal(await page.getByLabel("Full name", { exact: false }).isDisabled(), true);
    await page.getByRole("button", { name: "Check submission status", exact: true }).click();
    await page.waitForURL("**/applications/reload-recovery-receipt");
    assert.equal(uploads.length, 1);
    assert.equal(submissions.length, 2);
    assert.deepEqual(submissions[1], submissions[0]);
  } finally { await close(); }
});

test("confirmed validation rejection maps field errors and permits a corrected new attempt", async () => {
  const { page, close } = await browserPage();
  try {
    const { submissions } = await mockLiveApi(page, "full-stack-engineer", (route, attempt) => attempt === 1
      ? route.fulfill({ status: 422, json: { error: { code: "invalid_application", message: "Please check the highlighted answers.", fieldErrors: { _systemfield_email: "Check email address." } } } })
      : route.fulfill({ status: 201, json: { status: "accepted", receipt: "corrected-receipt" } }));
    await page.goto(`${baseUrl}/jobs/full-stack-engineer`);
    await fillApplication(page);
    await page.getByRole("button", { name: "Submit application", exact: true }).click();
    await page.getByText("Check email address.", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Email address", { exact: false }).getAttribute("aria-invalid"), "true");
    assert.equal(await page.getByLabel("Email address", { exact: false }).isDisabled(), false);
    await page.getByLabel("Email address", { exact: false }).fill("corrected@example.test");
    await page.getByRole("button", { name: "Submit application", exact: true }).click();
    await page.waitForURL("**/applications/corrected-receipt");
    assert.equal(submissions.length, 2);
    assert.notEqual(submissions[1].submissionKey, submissions[0].submissionKey);
    assert.equal(submissions[1].fieldSubmissions.find(field => field.path === "_systemfield_email").value, "corrected@example.test");
  } finally { await close(); }
});

test("paused intake still recovers an earlier uncertain write with its original payload", async () => {
  const { page, close } = await browserPage();
  try {
    const { submissions, uploads } = await mockLiveApi(page, "full-stack-engineer", (route, attempt) => attempt === 1
      ? route.fulfill({ status: 202, json: { status: "pending" } })
      : route.fulfill({ status: 201, json: { status: "accepted", receipt: "paused-recovery-receipt" } }));
    await page.goto(`${baseUrl}/jobs/full-stack-engineer`);
    await fillApplication(page);
    await page.getByRole("button", { name: "Submit application", exact: true }).click();
    await page.getByRole("button", { name: "Check submission status", exact: true }).waitFor();
    await page.route("**/api/jobs/*", route => route.fulfill({ json: { job: job("full-stack-engineer"), fields, formVersion:1, mode:"live", submissionEnabled:false } }));
    await page.reload();
    const check = page.getByRole("button", { name:"Check earlier application status",exact:true });
    await check.waitFor();
    assert.equal(await check.isEnabled(), true);
    assert.equal(await page.getByLabel("Full name", { exact:false }).count(), 0);
    await check.click();
    await page.waitForURL("**/applications/paused-recovery-receipt");
    assert.equal(uploads.length, 1); assert.equal(submissions.length, 2);
    assert.deepEqual(submissions[1], submissions[0]);
  } finally { await close(); }
});

test("paused intake never enables a new application when no recovery journal exists", async () => {
  const { page, close } = await browserPage();
  try {
    const { submissions, uploads } = await mockLiveApi(page, "full-stack-engineer", route => route.fulfill({json:{status:"accepted",receipt:"must-not-appear"}}));
    await page.route("**/api/jobs/*", route => route.fulfill({json:{job:job("full-stack-engineer"),fields,formVersion:1,mode:"live",submissionEnabled:false}}));
    await page.goto(`${baseUrl}/jobs/full-stack-engineer`);
    await page.getByText("Applications are currently closed.", {exact:true}).waitFor();
    assert.equal(await page.getByRole("button", {name:"Continue to application",exact:true}).count(), 0);
    assert.equal(submissions.length,0); assert.equal(uploads.length,0);
  } finally { await close(); }
});

test("a role closing after a lost application response still recovers the original accepted request", async()=>{
  const {page,close}=await browserPage();
  try {
    const {submissions,uploads}=await mockLiveApi(page,"full-stack-engineer",(route,attempt)=>attempt===1
      ? route.abort("failed")
      : route.fulfill({status:201,json:{status:"accepted",receipt:"closed-role-recovery-receipt"}}));
    await page.goto(`${baseUrl}/jobs/full-stack-engineer`); await fillApplication(page);
    await page.getByRole("button",{name:"Submit application",exact:true}).click();
    await page.getByRole("button",{name:"Check submission status",exact:true}).waitFor();
    await page.route("**/api/jobs/*",route=>route.fulfill({status:404,json:{error:{code:"job_not_found",message:"This role is no longer available."}}}));
    await page.reload();
    await page.getByRole("heading",{name:"Check an earlier submission",exact:true}).waitFor();
    assert.equal(await page.getByRole("button",{name:"Submit application",exact:true}).count(),0);
    await page.getByRole("button",{name:"Check earlier application status",exact:true}).click();
    await page.waitForURL("**/applications/closed-role-recovery-receipt");
    assert.equal(uploads.length,1);assert.equal(submissions.length,2);assert.deepEqual(submissions[1],submissions[0]);
  } finally {await close();}
});

test("closed-role recovery retains a legacy frozen journal through unreachable checks",async()=>{
  const {page,close}=await browserPage();
  try {
    let saved;
    const {submissions}=await mockLiveApi(page,"full-stack-engineer",route=>route.abort("failed"));
    await page.goto(`${baseUrl}/jobs/full-stack-engineer`);await fillApplication(page);
    await page.getByRole("button",{name:"Submit application",exact:true}).click();
    await page.getByRole("button",{name:"Check submission status",exact:true}).waitFor();
    saved=await page.evaluate(id=>{const key=`aicl:submission:${id}`, journal=JSON.parse(sessionStorage.getItem(key));delete journal.jobSlug;delete journal.jobTitle;sessionStorage.setItem(key,JSON.stringify(journal));return sessionStorage.getItem(key);},jobIds["full-stack-engineer"]);
    await page.route("**/api/jobs/*",route=>route.fulfill({status:404,json:{error:{message:"Closed"}}}));
    await page.reload();await page.getByText("legacy browser record",{exact:false}).waitFor();
    await page.getByRole("button",{name:"Check earlier application status",exact:true}).click();
    await page.getByText("Your earlier submission is still saved here.",{exact:false}).waitFor();
    assert.equal(await page.evaluate(id=>sessionStorage.getItem(`aicl:submission:${id}`),jobIds["full-stack-engineer"]),saved);
    assert.equal(submissions.length,2);assert.deepEqual(submissions[1],submissions[0]);
  } finally {await close();}
});

test("a confirmed server receipt remains usable if the browser cannot update its receipt journal",async()=>{
  const {page,close}=await browserPage();
  try {
    await page.addInitScript(()=>{
      const original=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){
        if(key.startsWith("aicl:submission:")&&JSON.parse(value).receipt) throw new DOMException("Synthetic receipt storage failure","QuotaExceededError");
        return original.call(this,key,value);
      };
    });
    const {submissions}=await mockLiveApi(page,"full-stack-engineer",route=>route.fulfill({status:201,json:{status:"accepted",receipt:"server-receipt-storage-failure"}}));
    await page.goto(`${baseUrl}/jobs/full-stack-engineer`);await fillApplication(page);
    await page.getByRole("button",{name:"Submit application",exact:true}).click();
    await page.waitForURL("**/applications/server-receipt-storage-failure");
    assert.equal(submissions.length,1);
    await page.getByRole("heading",{name:"You’re on our radar.",exact:true}).waitFor();
  } finally {await close();}
});

test("rating fields send the provider object contract rather than a bare number", async () => {
  const { page, close } = await browserPage();
  try {
    const { submissions } = await mockLiveApi(page, "creative-strategist", route => route.fulfill({ status: 201, json: { status: "accepted", receipt: "rating-receipt" } }), [...fields, { path: "rating", title: "Experience rating", type: "Score", required: true }]);
    await page.goto(`${baseUrl}/jobs/creative-strategist`);
    await fillApplication(page);
    await page.getByRole("combobox", { name: "Experience rating" }).click();
    await page.getByRole("option", { name: "3", exact: true }).click();
    await page.getByRole("button", { name: "Submit application", exact: true }).click();
    await page.waitForURL("**/applications/rating-receipt");
    assert.deepEqual(submissions[0].fieldSubmissions.find(field => field.path === "rating").value, { score: 3 });
  } finally { await close(); }
});

test("unsupported provider form is visible but cannot collect applications", async () => {
  const { page, close } = await browserPage();
  try {
    let submitted = false;
    await page.route("**/api/jobs/*", route => route.fulfill({ json: { job: job("full-stack-engineer"), fields: [], mode: "live", formUnavailable: "Conditional fields require additional configuration.", submissionEnabled: false } }));
    await page.route("**/api/applications", route => { submitted = true; return route.fulfill({ status: 503, json: { error: { code: "form_unavailable" } } }); });
    await page.goto(`${baseUrl}/jobs/full-stack-engineer`);
    await page.getByRole("heading", { name: "Full-stack Engineer", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Continue to application", exact: true }).count(), 0);
    assert.equal(submitted, false);
  } finally { await close(); }
});

test("two immediate submit events create one upload and one application write", async () => {
  const { page, close } = await browserPage();
  try {
    const { submissions, uploads } = await mockLiveApi(page, "full-stack-engineer", route => route.fulfill({ status: 201, json: { status: "accepted", receipt: "double-click-receipt" } }));
    await page.goto(`${baseUrl}/jobs/full-stack-engineer`);
    await fillApplication(page);
    await page.evaluate(() => { const form = document.querySelector("form.application-form"); form.requestSubmit(); form.requestSubmit(); });
    await page.waitForURL("**/applications/double-click-receipt");
    assert.equal(uploads.length, 1);
    assert.equal(submissions.length, 1);
  } finally { await close(); }
});

test("corrupted recovery journal fails closed instead of creating a fresh submission", async () => {
  const { page, close } = await browserPage();
  try {
    const { submissions, uploads } = await mockLiveApi(page, "full-stack-engineer", route => route.fulfill({ status: 201, json: { status: "accepted", receipt: "unused" } }));
    await page.addInitScript(({ id }) => sessionStorage.setItem(`aicl:submission:${id}`, "{corrupted"), { id: jobIds["full-stack-engineer"] });
    await page.goto(`${baseUrl}/jobs/full-stack-engineer`);
    await openApplication(page);
    await page.getByRole("alert").filter({ hasText: "Your browser couldn’t recover submission status." }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Submit application", exact: true }).isDisabled(), true);
    assert.equal(submissions.length, 0);
    assert.equal(uploads.length, 0);
  } finally { await close(); }
});

test("homepage referral parameters survive role navigation and reach the application", async () => {
  const { page, close } = await browserPage();
  try {
    const { submissions } = await mockLiveApi(page, "full-stack-engineer", route => route.fulfill({ status: 201, json: { status: "accepted", receipt: "source-tracking-receipt" } }));
    const source = { utm_source: "referral", utm_medium: "share", utm_campaign: "launch", utm_content: "header", utm_term: "engineer" };
    await page.goto(`${baseUrl}/?${new URLSearchParams(source)}`);
    await page.getByRole("link", { name: "Full-stack Engineer", exact: true }).click();
    await page.waitForURL("**/jobs/full-stack-engineer");
    assert.equal(new URL(page.url()).pathname, "/jobs/full-stack-engineer");
    await fillApplication(page);
    await page.getByRole("button", { name: "Submit application", exact: true }).click();
    try {
      await page.waitForURL("**/applications/source-tracking-receipt");
    } catch (error) {
      throw new Error(`${error.message}\nCurrent URL: ${page.url()}\nAlerts: ${await page.getByRole("alert").allTextContents()}\nSynthetic payloads: ${JSON.stringify(submissions)}`);
    }
    assert.deepEqual(submissions[0].utmData, source);
  } finally { await close(); }
});

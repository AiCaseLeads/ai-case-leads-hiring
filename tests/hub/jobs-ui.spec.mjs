import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

test("existing batches reopen safely and new batches retain entries after a failed save", async () => {
  const { outputFiles } = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {Jobs} from './components/hub/jobs'; createRoot(document.getElementById('root')).render(<Jobs admin={true} refresh={0} changed={()=>{}} />);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "iife", jsx: "automatic" });
  const server = createServer((req, res) => { res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html"); res.end(req.url === "/bundle.js" ? outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>'); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const localChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({ headless: true, ...(existsSync(localChrome) ? { executablePath: localChrome } : {}) });
  const page = await browser.newPage();
  const prior = { id: "existing-job", title: "Creative Strategist", slug: "creative-strategist-spain", department: "Creative", location: "Spain", status: "open", descriptionHtml: "Approved creative role description", fields: [{ path: "_systemfield_name", title: "Full name", type: "String", required: true }, { path: "_systemfield_email", title: "Email", type: "Email", required: true }], rules: [], autoReject: true, rejectionTemplate: "Thank you", assessmentPrompt: "Creative task", formVersion: 3, archiveProject: "Creative Strategist", archiveCountry: "Spain", hiringRound: "Previous round" };
  const other = {...prior, id: "usa-job", slug: "creative-strategist-usa", archiveCountry: "USA", hiringRound: "Previous round"};
  const original = structuredClone(prior), writes = [], updates = [];
  try {
    await page.route("**/api/hub/jobs", async route => {
      if (route.request().method() === "POST") { writes.push(route.request().postDataJSON()); if (writes.length === 1) await route.fulfill({ status: 503, json: { error: { message: "Temporary save failure. Retry." } } }); else await route.fulfill({ json: { data: { ...writes.at(-1), id: "new-job", formVersion: 1 } } }); }
      else await route.fulfill({ json: { data: [prior, other] } });
    });
    await page.route("**/api/hub/jobs/existing-job", async route => { updates.push(route.request().postDataJSON()); await route.fulfill({json: {data: prior}}); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByLabel("Choose job", {exact: true}).selectOption("Creative Strategist");
    await page.getByLabel("Choose location", {exact: true}).selectOption("Spain");
    assert.equal(await page.getByLabel("Choose existing batch", {exact: true}).locator("option").count(), 2);
    await page.getByLabel("Choose existing batch", {exact: true}).selectOption("existing-job");
    await page.getByRole("button", {name: "Open batch", exact: true}).click();
    assert.equal(await page.getByLabel("Batch name", {exact: true}).inputValue(), "Previous round");
    await page.getByLabel("Publication status").selectOption("draft");
    // Existing auto rejection needs explicit approval before a save, or turn it off.
    await page.getByText("Optional: qualification rules & rejection email", {exact: true}).click();
    await page.getByLabel("Automatically reject applications that fail enabled requirements").uncheck();
    await page.getByRole("button", {name: "Save draft batch", exact: true}).click();
    await page.getByText("Draft batch saved.", {exact: false}).waitFor();
    assert.equal(updates.length, 1);
    assert.equal(updates[0].slug, prior.slug);
    assert.equal(updates[0].hiringRound, "Previous round");
    assert.equal(updates[0].formVersion, 3);
    assert.equal(writes.length, 0, "using an existing batch must not create a duplicate posting");
    await page.getByRole("button", { name: "Create new batch" }).click();
    assert.equal(await page.getByLabel("Publication status").inputValue(), "draft");
    assert.equal(await page.getByLabel("Job description", { exact: true }).inputValue(), prior.descriptionHtml);
    assert.equal(await page.getByLabel("Hiring location", { exact: true }).inputValue(), "Spain");
    assert.equal(await page.getByLabel("Batch name", { exact: true }).inputValue(), "Batch 1");
    await page.getByLabel("Hiring location", { exact: true }).fill("USA");
    await page.getByLabel("Batch name", { exact: true }).fill("November 2026");
    await page.getByRole("button", { name: "Add experience & profile questions" }).click();
    await page.getByRole("button", { name: "Experience & profile questions added" }).waitFor();
    await page.getByRole("button", { name: /Save/ }).click();
    await page.getByText("Temporary save failure. Retry.").waitFor();
    assert.equal(await page.getByLabel("Batch name", {exact: true}).inputValue(), "November 2026");
    assert.equal(await page.getByLabel("Hiring location", {exact: true}).inputValue(), "USA");
    await page.getByRole("button", {name: "Experience & profile questions added"}).waitFor();
    await page.getByRole("button", { name: /Save/ }).click();
    await page.getByRole("button", { name: "Create new batch" }).waitFor();
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[0], writes[1]);
    assert.equal(writes[0].status, "draft");
    assert.equal(writes[0].autoReject, false);
    assert.equal(writes[0].archiveCountry, "USA");
    assert.equal(writes[0].hiringRound, "November 2026");
    assert.deepEqual(writes[0].fields.slice(0, prior.fields.length), prior.fields);
    assert.equal(writes[0].fields.find(field => field.path === "linkedin_profile").required, false);
    assert.equal(writes[0].fields.find(field => field.path === "accuracy_confirmation").required, true);
    assert.equal(writes[0].fields.length, prior.fields.length + 4);
    assert.equal(writes[0].assessmentPrompt, prior.assessmentPrompt);
    assert.notEqual(writes[0].slug, prior.slug);
    assert.equal(writes[0].id, undefined);
    assert.equal(writes[0].formVersion, undefined);
    assert.deepEqual(prior, original);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});

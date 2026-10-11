import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

test("reposting creates a distinct draft with editable archive grouping and preserves the prior job", async () => {
  const { outputFiles } = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {Jobs} from './components/hub/jobs'; createRoot(document.getElementById('root')).render(<Jobs admin={true} refresh={0} changed={()=>{}} />);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "iife", jsx: "automatic" });
  const server = createServer((req, res) => { res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html"); res.end(req.url === "/bundle.js" ? outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>'); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const localChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({ headless: true, ...(existsSync(localChrome) ? { executablePath: localChrome } : {}) });
  const page = await browser.newPage();
  const prior = { id: "existing-job", title: "Creative Strategist", slug: "creative-strategist-spain", department: "Creative", location: "Spain", status: "open", descriptionHtml: "Approved creative role description", fields: [{ path: "_systemfield_name", title: "Full name", type: "String", required: true }, { path: "_systemfield_email", title: "Email", type: "Email", required: true }], rules: [], autoReject: true, rejectionTemplate: "Thank you", assessmentPrompt: "Creative task", formVersion: 3, archiveProject: "Creative Strategist", archiveCountry: "Spain", hiringRound: "Previous round" };
  const original = structuredClone(prior), writes = [];
  try {
    await page.route("**/api/hub/jobs", async route => {
      if (route.request().method() === "POST") { writes.push(route.request().postDataJSON()); await route.fulfill({ json: { data: { ...writes.at(-1), id: "new-job", formVersion: 1 } } }); }
      else await route.fulfill({ json: { data: [prior] } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("button", { name: "Create new hiring round" }).click();
    assert.equal(await page.getByLabel("Publication status").inputValue(), "draft");
    assert.equal(await page.getByLabel("Job description", { exact: true }).inputValue(), prior.descriptionHtml);
    assert.equal(await page.getByLabel("Country or market", { exact: true }).inputValue(), "Spain");
    assert.equal(await page.getByLabel("Hiring round", { exact: true }).inputValue(), "");
    await page.getByLabel("Country or market", { exact: true }).fill("USA");
    await page.getByLabel("Hiring round", { exact: true }).fill("November 2026");
    await page.getByRole("button", { name: /Save/ }).click();
    await page.getByRole("button", { name: "Create new hiring round" }).waitFor();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].status, "draft");
    assert.equal(writes[0].autoReject, false);
    assert.equal(writes[0].archiveCountry, "USA");
    assert.equal(writes[0].hiringRound, "November 2026");
    assert.deepEqual(writes[0].fields, prior.fields);
    assert.equal(writes[0].assessmentPrompt, prior.assessmentPrompt);
    assert.notEqual(writes[0].slug, prior.slug);
    assert.equal(writes[0].id, undefined);
    assert.equal(writes[0].formVersion, undefined);
    assert.deepEqual(prior, original);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});

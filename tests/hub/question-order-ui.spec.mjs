import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";
import { installDraftFixture } from "./draft-ui-fixture.mjs";

const questions = [
  { path: "years", title: "Years of experience", type: "Number", required: true },
  { path: "portfolio", title: "Portfolio link", type: "Url", required: false, description: "Original portfolio instructions" },
  { path: "briefs", title: "Briefs completed", type: "Number", required: true },
  { path: "available", title: "Available now", type: "Boolean", required: true },
];
const rules = [{ fieldPath: "years", operator: "gte", value: 7, enabled: true, reason: "Minimum seven years" }];
const prior = { id: "synthetic-reorder-job", title: "Synthetic question sorting", slug: "synthetic-question-sorting", department: "", location: "Remote — Spain", status: "open", descriptionHtml: "Synthetic role description", fields: questions, rules, autoReject: false, rejectionTemplate: "Thank you", formVersion: 3, archiveProject: "Synthetic question sorting", archiveCountry: "Spain", hiringRound: "Original posting", lifecycle: { state: "active", revision: 3 } };

async function setup(t, { mobile = false, clock = false } = {}) {
  const { outputFiles } = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{Jobs}from'./components/hub/jobs';import{HUB_HISTORY_GUARD}from'./components/hub/history';(0,eval)(HUB_HISTORY_GUARD);createRoot(document.getElementById('root')).render(<main className="candidate-main" data-hiring-workspace><Jobs admin refresh={0} changed={()=>{}}/></main>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "iife", jsx: "automatic" });
  const css = readFileSync("components/hub/hub.css", "utf8");
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : req.url === "/hub.css" ? "text/css" : "text/html");
    res.end(req.url === "/bundle.js" ? outputFiles[0].text : req.url === "/hub.css" ? css : '<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/hub.css"><style>body{margin:0;font-family:Arial,sans-serif}*{box-sizing:border-box}main{padding:20px;min-height:100vh}.hub-question-drag-handle{min-width:44px;min-height:44px;margin-left:0!important;flex:0 0 auto}</style><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, ...(mobile ? { hasTouch: true, isMobile: true } : {}) });
  const page = await context.newPage(), writes = [], errors = [];
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.route("**/api/hub/jobs", route => route.fulfill({ json: { data: [prior] } }));
  await page.route("**/api/scorecards", route => route.fulfill({ json: { data: { revision: 0, templates: [], archived: [], bindings: {} } } }));
  await page.route("**/api/job-setup", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { data: { revision: 0, templates: [], requests: [], locations: { [prior.id]: { workModel: "remote", country: "Spain", city: "" } } } } });
    const input = route.request().postDataJSON(); writes.push(input);
    return route.fulfill({ json: { data: { ...input.job, id: input.jobId, formVersion: 4 } } });
  });
  const drafts = await installDraftFixture(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/?view=jobs`);
  if (clock) await page.clock.install();
  await page.getByRole("button", { name: "Edit job", exact: true }).click();
  await page.getByRole("list", { name: "Job setup progress" }).getByRole("button", { name: "Application questions", exact: true }).click();
  await page.getByRole("button", { name: "Reorder Years of experience", exact: true }).waitFor();
  return { page, context, writes, drafts, errors };
}
async function order(page) { return page.locator(".hub-editor-list > .hub-question").evaluateAll(nodes => nodes.map(node => node.dataset.questionPath)); }
function handle(page, title) { return page.getByRole("button", { name: `Reorder ${title}`, exact: true }); }
async function mouseReorder(page, from, to) {
  const source = handle(page, from); await source.scrollIntoViewIfNeeded();
  const start = await source.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 12, start.y + start.height / 2 + 12, { steps: 3 });
  await page.locator(".hub-question-drag-preview").waitFor();
  const target = page.locator(".hub-question").filter({ has: handle(page, to) });
  await target.scrollIntoViewIfNeeded(); const end = await target.boundingBox();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 10 }); await page.mouse.up();
  await page.locator(".hub-question-drag-preview").waitFor({ state: "hidden" });
}

test("mouse drag skips multiple positions and saves exact question identities, instructions and screening rules", async t => {
  const { page, writes, errors } = await setup(t);
  await mouseReorder(page, "Available now", "Years of experience");
  assert.deepEqual(await order(page), ["available", "years", "portfolio", "briefs"]);
  assert.equal(await page.getByLabel("Question 1 label", { exact: true }).inputValue(), "Available now");
  assert.equal(await page.getByLabel("Question 2 label", { exact: true }).inputValue(), "Years of experience");
  await page.getByLabel("Question 3 label", { exact: true }).fill("Edited portfolio link");
  await page.getByRole("list", { name: "Job setup progress" }).getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("button", { name: "Save published job", exact: true }).click();
  await page.getByText("Job published.", { exact: false }).waitFor();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].expectedLifecycleRevision, 3, "saving must not overwrite a newer pause/archive decision");
  assert.deepEqual(writes[0].job.fields.slice(4).map(field => field.path), ["available", "years", "portfolio", "briefs"]);
  const portfolio = writes[0].job.fields.find(field => field.path === "portfolio");
  assert.equal(portfolio.title, "Edited portfolio link"); assert.equal(portfolio.description, questions[1].description);
  assert.deepEqual(writes[0].job.rules, rules);
  assert.deepEqual(errors, []);
});

test("keyboard sorting announces positions, restores focus and Escape cancels without changing order", async t => {
  const { page, errors } = await setup(t);
  const source = handle(page, "Years of experience"); await source.focus();
  await page.keyboard.press("Space", { delay: 60 }); await page.locator(".hub-question-drag-preview").waitFor();
  await page.keyboard.press("ArrowDown");
  await page.getByText("Years of experience is at position 2 of 4.", { exact: true }).waitFor({ state: "attached" });
  await page.keyboard.press("ArrowDown");
  await page.getByText("Years of experience is at position 3 of 4.", { exact: true }).waitFor({ state: "attached" });
  await page.keyboard.press("Space");
  await page.locator(".hub-question-drag-preview").waitFor({ state: "hidden" });
  assert.deepEqual(await order(page), ["portfolio", "briefs", "years", "available"]);
  assert.equal(await source.evaluate(node => node === document.activeElement), true);
  assert.match(await page.locator('[role="status"][aria-live]').innerText(), /Years of experience moved to position 3/);
  await page.keyboard.press("Space", { delay: 60 }); await page.locator(".hub-question-drag-preview").waitFor(); await page.keyboard.press("ArrowUp");
  await page.getByText("Years of experience is at position 2 of 4.", { exact: true }).waitFor({ state: "attached" });
  await page.keyboard.press("Escape"); await page.locator(".hub-question-drag-preview").waitFor({ state: "hidden" });
  assert.deepEqual(await order(page), ["portfolio", "briefs", "years", "available"]);
  assert.equal(await source.evaluate(node => node === document.activeElement), true);
  assert.match(await page.locator('[role="status"][aria-live]').innerText(), /cancelled/);
  assert.deepEqual(errors, []);
});

test("editing and selecting question text never starts a drag; fixed contacts have no handles", async t => {
  const { page } = await setup(t);
  const input = page.getByLabel("Question 1 label", { exact: true }); await input.fill("Updated years question"); await input.selectText();
  await page.keyboard.press("ArrowRight");
  assert.deepEqual(await order(page), ["years", "portfolio", "briefs", "available"]);
  assert.equal(await page.locator(".hub-question-drag-preview").count(), 0);
  assert.equal(await page.locator(".hub-question-drag-handle").count(), 4);
  assert.equal(await page.getByRole("button", { name: /Reorder (First name|Last name|Email|Phone)/ }).count(), 0);
});

test("dragged order autosaves after one minute and draft reload keeps the same numbered questions and rules", async t => {
  const { page, writes, drafts, errors } = await setup(t, { clock: true });
  await mouseReorder(page, "Available now", "Portfolio link");
  const expected = ["years", "available", "portfolio", "briefs"];
  assert.deepEqual(await order(page), expected);
  const saved = page.waitForResponse(response => response.url().includes("/api/job-drafts") && response.request().method() === "PUT");
  await page.clock.fastForward(61000); await saved;
  assert.equal(writes.length, 0, "autosave must not change the live job");
  const draft = drafts.get(prior.id); assert.deepEqual(draft.state.fields.slice(4).map(field => field.path), expected); assert.deepEqual(draft.state.rules, rules);
  await page.reload(); await page.getByText(/Saved draft restored/).waitFor();
  assert.deepEqual(await order(page), expected);
  assert.equal(await page.getByLabel("Question 2 label", { exact: true }).inputValue(), "Available now");
  assert.equal(await page.getByLabel("Minimum accepted number for Years of experience", { exact: true }).inputValue(), "7");
  assert.deepEqual(errors, []);
});

test("native touch drag on a phone uses the handle and can scroll to another question", async t => {
  const { page, context, errors } = await setup(t, { mobile: true });
  const source = handle(page, "Years of experience"); await source.scrollIntoViewIfNeeded();
  const start = await source.boundingBox(), cdp = await context.newCDPSession(page);
  const x = Math.round(start.x + start.width / 2), y = Math.round(start.y + start.height / 2);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await page.waitForTimeout(250);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + 20 }] });
  await page.locator(".hub-question-drag-preview").waitFor();
  const target = page.locator('.hub-question[data-question-path="portfolio"]');
  await target.scrollIntoViewIfNeeded();
  const end = await target.boundingBox();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: Math.round(end.x + end.width / 2), y: Math.round(Math.min(790, end.y + end.height / 2)) }] });
  await page.getByText("Years of experience is at position 2 of 4.", { exact: true }).waitFor({ state: "attached" });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.locator(".hub-question-drag-preview").waitFor({ state: "hidden" });
  assert.deepEqual(await order(page), ["portfolio", "years", "briefs", "available"]);
  assert.equal(await page.getByLabel("Question 1 label", { exact: true }).inputValue(), "Portfolio link");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []);
});

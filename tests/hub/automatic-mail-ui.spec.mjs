import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

const initial = { provider: "sendgrid", sender: "no-reply@aicaseleads.com", replyTo: "no-reply@notify.aicaseleads.com", configured: false, ready: false, error: "transactional_mail_key_required", checkedAt: null, dailyLimit: 300, setupUrl: "https://app.sendgrid.com" };
async function setup(t, { mode = "setup", taskError = "transactional_mail_domain_not_verified", taskStatus = "failed", mailStatus = initial } = {}) {
  const render = mode === "tasks" ? "<Tasks admin={true} refresh={0} changed={()=>{}}/>" : "<AutomaticMailSetup/>";
  const { outputFiles } = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{AutomaticMailSetup}from'./components/hub/automatic-mail';import{Tasks}from'./components/hub/settings';createRoot(document.getElementById('root')).render(${render});`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "iife", jsx: "automatic" });
  const server = createServer((req, res) => { res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html"); res.end(req.url === "/bundle.js" ? outputFiles[0].text : `<meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}${readFileSync("components/hub/hub.css", "utf8")}</style><div class="hub-main"><div id="root"></div></div><script src="/bundle.js"></script>`); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), reads = [], writes = [], errors = [];
  let status = mailStatus, fail = false;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") { writes.push(path); return route.fulfill({ status: 503, json: { error: { message: "Not connected" } } }); }
    reads.push(path);
    if (path === "/api/transactional-mail") return route.fulfill(fail ? { status: 503, json: { error: { message: "Sender check is temporarily unavailable." } } } : { json: { data: status } });
    if (path === "/api/hub/tasks") return route.fulfill({ json: { data: [{ id: "gmail:synthetic:confirmation", kind: "gmail", applicationId: "synthetic", status: taskStatus, attempts: 1, updatedAt: Date.now(), runAfter: Date.now() + 3600_000, lastError: taskError }] } });
    return route.fulfill({ json: { data: {} } });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`); page.setDefaultTimeout(3000);
  return { page, reads, writes, errors, setStatus: value => { status = value; }, setFailure: value => { fail = value; } };
}

test("automatic mail setup stays compact, hides keys and separates provider readiness from delivery", async t => {
  const { page, reads, writes, errors, setStatus } = await setup(t);
  await page.getByText("Not connected", { exact: true }).waitFor();
  assert.equal(await page.locator("details").evaluate(element => element.open), false);
  const senderDescription = await page.locator("p.hub-muted").first().innerText();
  assert.match(senderDescription, /Sender: no-reply@aicaseleads\.com/);
  assert.match(senderDescription, /Reply-To: no-reply@notify\.aicaseleads\.com/);
  assert.equal(await page.locator("input,textarea").count(), 0);
  assert.equal(await page.getByRole("link", { name: "Open SendGrid", exact: true }).getAttribute("href"), "https://app.sendgrid.com");
  await page.getByText("Connect automatic email · one-time setup", { exact: true }).click();
  await page.getByText("SENDGRID_API_KEY", { exact: true }).waitFor();
  await page.getByText(/Open your existing SendGrid account/).waitFor();
  await page.getByText(/App sending budget:/).waitFor();
  assert.equal(await page.getByText(/Create a company-owned/).count(), 0);
  assert.equal(await page.getByText(/Send mail as/).count(), 0);
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const metrics = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, controls: [...document.querySelectorAll("button,a")].map(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right })) }));
    assert.ok(metrics.scroll <= width + 1, `${width}px overflow: ${JSON.stringify(metrics)}`);
    for (const control of metrics.controls) assert.ok(control.left >= 0 && control.right <= width + 1);
  }
  setStatus({ ...initial, configured: true, ready: true, error: null, checkedAt: 1792128000000 });
  await page.getByRole("button", { name: "Check automatic email", exact: true }).click();
  await page.getByText("Sender verified", { exact: true }).waitFor();
  await page.getByText(/controlled test confirms delivery/).waitFor();
  assert.equal(reads.every(path => path === "/api/transactional-mail"), true);
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
});

test("failed automatic sender checks can be refreshed and never display a stale ready badge", async t => {
  const { page, setStatus, setFailure, errors } = await setup(t);
  await page.getByText("Not connected", { exact: true }).waitFor();
  setStatus({ ...initial, configured: true, ready: true, error: null });
  await page.getByRole("button", { name: "Check automatic email", exact: true }).click();
  await page.getByText("Sender verified", { exact: true }).waitFor();
  setFailure(true);
  await page.getByRole("button", { name: "Check automatic email", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Sender check is temporarily unavailable." }).waitFor();
  assert.equal(await page.getByText("Sender verified", { exact: true }).count(), 0);
  setFailure(false); setStatus({ ...initial, configured: true, error: "transactional_mail_sender_not_verified" });
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByText("Authenticate the aicaseleads.com sending domain in SendGrid for no-reply@aicaseleads.com.", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
});

test("delivery activity explains transactional sender failures without sending users into Gmail aliases", async t => {
  const { page, reads, writes, errors } = await setup(t, { mode: "tasks" });
  await page.getByRole("cell", { name: "Setup required", exact: true }).waitFor();
  await page.getByText(/Authenticate aicaseleads.com in SendGrid using the DNS records it provides/).waitFor();
  assert.equal(await page.getByText(/Send mail as/).count(), 0);
  assert.equal(await page.getByRole("link", { name: "Open email settings", exact: true }).getAttribute("href"), "/team?view=settings&section=company");
  assert.equal(reads.includes("/api/personal-mail"), false);
  assert.equal(await page.getByRole("button", { name: "Review and retry held message", exact: true }).count(), 1);
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
});


test("legacy automatic Gmail failures direct users to SendGrid, while private template failures remain explicit", async t => {
  const { page, errors } = await setup(t, { mode: "tasks", taskError: "candidate_mail_account_connection_required" });
  await page.getByText(/This earlier automatic applicant email now uses SendGrid/).waitFor();
  assert.equal(await page.getByText(/Connect the assigned recruiter’s Gmail for recruiter conversations/).count(), 0);
  assert.equal(await page.getByRole("link", { name: "Open email settings", exact: true }).getAttribute("href"), "/team?view=settings&section=company");
  assert.deepEqual(errors, []);
  const privacy = await setup(t, { mode: "tasks", taskError: "candidate_mail_exposes_staff_address" });
  await privacy.page.getByText(/Update the email template to remove the private staff address before sending/).waitFor();
  assert.equal(await privacy.page.getByText(/This earlier automatic applicant email now uses SendGrid/).count(), 0);
  assert.deepEqual(privacy.errors, []);
});

for (const taskError of ["transactional_mail_daily_limit", "transactional_mail_rate_limited", "transactional_mail_quota_exhausted"]) test(`${taskError} shows an automatic capacity retry rather than broken sender setup`, async t => {
  const { page, writes, errors } = await setup(t, { mode: "tasks", taskError, taskStatus: "pending", mailStatus: { ...initial, configured: true, ready: true, error: null } });
  await page.getByRole("cell", { name: "Waiting for email capacity", exact: true }).waitFor();
  await page.getByText("Queued for automatic retry", { exact: true }).waitFor();
  await page.getByText(/This email remains queued and will retry automatically/).waitFor();
  await page.getByText(/Next check:/).waitFor();
  assert.equal(await page.getByText("Setup required", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("link", { name: "Open email settings", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Review and retry held message", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Retry safely", exact: true }).count(), 0);
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
});


test("missing Null MX explains DNS isolation before the generic sending-domain hint", async t => {
  const { page, errors } = await setup(t, { mailStatus: { ...initial, configured: true, error: "transactional_mail_reply_domain_not_verified" } });
  await page.getByRole("alert").filter({ hasText: "Add and verify a Null MX record (priority 0, target .)" }).waitFor();
  assert.equal(await page.getByText("Authenticate aicaseleads.com in SendGrid using the DNS records it provides.", { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
});

test("uncertain SendGrid delivery retains reconciliation-only status rather than reporting broken setup", async t => {
  const { page, writes, errors } = await setup(t, { mode: "tasks", taskStatus: "uncertain", taskError: "transactional_mail_outcome_unknown", mailStatus: { ...initial, configured: true, ready: true, error: null } });
  await page.getByRole("cell", { name: "uncertain", exact: true }).waitFor();
  await page.getByText(/Resending is blocked while the result is uncertain/).waitFor();
  assert.equal(await page.getByText("Setup required", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Retry safely", exact: true }).count(), 0);
  assert.equal(await page.getByRole("link", { name: "Open email settings", exact: true }).count(), 0);
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
});

test("temporary DNS failures remain pending with automatic retry and no setup action", async t => {
  const mailStatus = { ...initial, configured: true, ready: false, error: "transactional_mail_dns_check_failed" };
  const { page, writes, errors } = await setup(t, { mode: "tasks", taskStatus: "pending", taskError: mailStatus.error, mailStatus });
  await page.getByRole("cell", { name: "Waiting for DNS check", exact: true }).waitFor();
  await page.getByText(/This email remains queued and retries automatically; the application remains saved/).waitFor();
  await page.getByText("Queued for automatic retry", { exact: true }).waitFor();
  assert.equal(await page.getByText("Setup required", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("link", { name: /email setup|email settings/ }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Retry safely", exact: true }).count(), 0);
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  const settings = await setup(t, { mailStatus });
  await settings.page.getByText("Verification unavailable", { exact: true }).waitFor();
  await settings.page.getByRole("alert").filter({ hasText: "Emails stay queued and retry automatically" }).waitFor();
  assert.equal(await settings.page.getByText("Setup incomplete", { exact: true }).count(), 0);
  assert.deepEqual(settings.errors, []);
});

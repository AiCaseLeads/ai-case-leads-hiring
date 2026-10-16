import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

const plan = { planId: "a".repeat(64), digest: "b".repeat(64), expiresAt: Date.now() + 600000, eligible: 2, remaining: 12, scanned: 17, counts: { "Application receipt": 2 }, skipped: [{ reason: "Delivery uncertain; checking sent mail, never resend blindly", count: 3 }], automaticSender: "no-reply@aicaseleads.com", messages: [{ id: "message1", applicant: "Synthetic Applicant", job: "Engineer", kind: "Application receipt", sender: "no-reply@aicaseleads.com", replyTo: ["no-reply@notify.aicaseleads.com"], subject: "Application received" }], privacy: "" };
async function setup(t, { blocked = false } = {}) {
  const { outputFiles } = await build({ stdin: { contents: "import React from 'react';import{createRoot}from'react-dom/client';import{MailRecovery}from'./components/hub/mail-recovery';createRoot(document.getElementById('root')).render(<MailRecovery changed={()=>document.body.dataset.changed='true'}/>);", resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "iife", jsx: "automatic" });
  const server = createServer((req, res) => { res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html"); res.end(req.url === "/bundle.js" ? outputFiles[0].text : `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${readFileSync("components/hub/hub.css", "utf8")}</style><div class="hub-main"><div id="root"></div></div><script src="/bundle.js"></script>`); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), writes = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/hub/mail-recovery/**", async route => {
    writes.push({ path: new URL(route.request().url()).pathname, input: route.request().postDataJSON() });
    if (route.request().url().endsWith("/preview")) return route.fulfill({ json: { data: blocked ? { ...plan, eligible: 0, planId: null, digest: null, messages: [], counts: {}, skipped: [{ reason: "The no-reply sender is not verified in SendGrid", count: 17 }] } : plan } });
    await new Promise(resolve => setTimeout(resolve, 200));
    return route.fulfill({ json: { data: { queued: 2, alreadyQueued: false } } });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`); page.setDefaultTimeout(3000);
  return { page, writes, errors };
}
test("admin recovery previews the chosen Bogotá day and queues only the exact plan once", async t => {
  const { page, writes, errors } = await setup(t);
  await page.getByLabel("Email date · Bogotá time").fill("2026-10-15");
  await page.getByRole("button", { name: "Preview failed emails" }).click();
  await page.getByText("2 emails ready to retry.", { exact: true }).waitFor();
  assert.deepEqual(writes[0].input, { from: Date.parse("2026-10-15T00:00:00-05:00"), to: Date.parse("2026-10-16T00:00:00-05:00") });
  assert.equal(writes.length, 1);
  await page.getByText("Why some emails are excluded", { exact: true }).click();
  await page.getByText(/Delivery uncertain; checking sent mail/).waitFor();
  await page.getByRole("button", { name: "Retry 2 reviewed emails" }).click();
  await page.getByText("Reviewed emails queued. Delivery status updates as the worker sends them.", { exact: true }).waitFor();
  assert.deepEqual(writes[1].input, { planId: plan.planId, digest: plan.digest });
  assert.equal(writes.length, 2); assert.equal(await page.locator("body").getAttribute("data-changed"), "true");
  assert.deepEqual(errors, []);
});
test("changing the day cancels its old recovery plan; an unverified automatic sender exposes no retry button", async t => {
  const { page, writes, errors } = await setup(t, { blocked: true });
  await page.getByRole("button", { name: "Preview failed emails" }).click();
  await page.getByText("0 emails ready to retry.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /reviewed emails/ }).count(), 0);
  await page.getByText("Why some emails are excluded", { exact: true }).click();
  await page.getByText(/no-reply sender is not verified/).waitFor();
  await page.getByLabel("Email date · Bogotá time").fill("2026-10-14");
  assert.equal(await page.getByText("0 emails ready to retry.", { exact: true }).count(), 0); assert.equal(writes.length, 1); assert.deepEqual(errors, []);
});
test("recovery fields, actions and expanded preview stay inside the page at 320, 390 and 1280px", async t => {
  const { page, errors } = await setup(t);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole("button", { name: "Preview failed emails" }).click();
    await page.getByText("2 emails ready to retry.", { exact: true }).waitFor();
    await page.getByText("Review the 1 message in this batch", { exact: true }).click();
    await page.getByRole("cell", { name: "Synthetic Applicant", exact: true }).waitFor();
    const metrics = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, buttons: [...document.querySelectorAll("button,input")].map(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width })) }));
    assert.ok(metrics.scrollWidth <= metrics.width + 1, `page overflows at ${width}px`);
    for (const box of metrics.buttons) assert.ok(box.left >= 0 && box.right <= width + 1 && box.width >= 40, `control exceeds ${width}px viewport: ${JSON.stringify(box)}`);
    await page.getByRole("button", { name: "Cancel preview" }).click();
  }
  assert.deepEqual(errors, []);
});

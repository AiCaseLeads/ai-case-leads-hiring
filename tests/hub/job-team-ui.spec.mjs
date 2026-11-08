import {installDraftFixture} from "./draft-ui-fixture.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

const staff = [{ email: "manager@example.invalid", role: "admin" }, { email: "maria@example.invalid", role: "recruiter" }, { email: "alex@example.invalid", role: "recruiter" }];
const config = { revision: 2, members: [staff[1].email], replyTo: staff[1].email, notifyNewApplications: true, notifyAssessmentSubmissions: true, notifyReplies: true, notifyOverdueReviews: true };
const job = { id: "job-creative", title: "Creative Strategist", slug: "creative", location: "Remote · Worldwide", status: "open", formVersion: 1, descriptionHtml: "Approved role description", fields: [{ path: "_systemfield_name", title: "Full name", type: "String", required: true }, { path: "_systemfield_email", title: "Email", type: "Email", required: true }], rules: [], autoReject: false, rejectionTemplate: "Thank you" };

async function setup(t, { mode = "panel", failFirst = false, admin = true } = {}) {
  const entry = mode === "panel"
    ? `import {JobTeamPanel} from './components/hub/job-team';createRoot(document.getElementById('root')).render(<JobTeamPanel jobId="job-creative" title="Creative Strategist" admin={${admin}} close={()=>{}}/>);`
    : `import {Jobs} from './components/hub/jobs';createRoot(document.getElementById('root')).render(<Jobs admin refresh={0} changed={()=>{}}/>);`;
  const { outputFiles } = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';${entry}`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "iife", jsx: "automatic" });
  const server = createServer((req, res) => { res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html"); res.end(req.url === "/bundle.js" ? outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>'); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let saved = structuredClone(config);
  const writes = [], jobWrites = [];
  await page.route("**/api/job-team**", async route => {
    if (route.request().method() === "PUT") {
      const input = route.request().postDataJSON(); writes.push(input);
      if (failFirst && writes.length === 1) return route.fulfill({ status: 503, json: { error: { message: "Temporary connection problem. Try again." } } });
      assert.equal(input.expectedRevision, saved.revision);
      const { jobId: _, expectedRevision, ...values } = input;
      void _;
      saved = { ...values, revision: expectedRevision + 1 };
    }
    await route.fulfill({ json: { data: { config: new URL(route.request().url()).searchParams.has("jobId") || route.request().method() === "PUT" ? saved : null, staff, sender: "shared@example.invalid" } } });
  });
  await page.route("**/api/hub/jobs", route => route.fulfill({ json: { data: [job] } }));
  await page.route("**/api/scorecards", route => route.fulfill({ json: { data: { revision: 0, templates: [], archived: [], bindings: {} } } }));
  await page.route("**/api/job-setup", async route => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON(); jobWrites.push(input);
      return route.fulfill({ json: { data: { ...input.job, id: input.creationId, formVersion: 1 } } });
    }
    await route.fulfill({ json: { data: { revision: 0, templates: [], requests: [], locations: {} } } });
  });
  await installDraftFixture(page, {team: false});
  await page.goto(`http://127.0.0.1:${server.address().port}/team?view=jobs`);
  return { page, writes, jobWrites };
}

test("job team saves private recruiter recipients with a clear candidate reply recruiter, preserves failed saves and revision", async t => {
  const { page, writes } = await setup(t, { failFirst: true });
  await page.getByRole("checkbox", { name: /alex@example.invalid/ }).check();
  assert.equal(await page.getByLabel("Default reply contact", { exact: true }).count(), 1);
  await page.getByLabel("Default reply contact",{exact:true}).selectOption(staff[2].email);
  await page.getByText("Email notification settings", {exact:true}).click();
  await page.getByRole("checkbox", { name: "Submitted assessments", exact: true }).uncheck();
  await page.getByRole("button", { name: "Save hiring team", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Temporary connection" }).waitFor();
  assert.equal(await page.getByRole("checkbox", { name: /alex@example.invalid/ }).isChecked(), true);
  await page.getByRole("button", { name: "Save hiring team", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Hiring team saved" }).waitFor();
  assert.deepEqual(writes[1].members, [staff[1].email, staff[2].email]);
  assert.equal(writes[1].replyTo, staff[2].email);
  assert.equal(writes[1].notifyAssessmentSubmissions, false);
  await page.getByRole("checkbox", { name: /alex@example.invalid/ }).uncheck();
  assert.equal(await page.getByLabel("Default reply contact", { exact: true }).count(), 1);
  await page.getByRole("button", { name: "Save hiring team", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Hiring team saved" }).waitFor();
  assert.equal(writes[2].replyTo, null);
  assert.equal(writes[2].expectedRevision, 3);
  assert.deepEqual(writes[2].members, [staff[1].email]);
});

test("recruiter can inspect their job team but cannot change recipients", async t => {
  const { page, writes } = await setup(t, { admin: false });
  await page.getByRole("checkbox", { name: /maria@example.invalid/ }).waitFor();
  assert.equal(await page.getByRole("checkbox", { name: /maria@example.invalid/ }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Save hiring team" }).count(), 0);
  assert.equal(writes.length, 0);
});

test("new blank job saves selected team atomically with the job and wizard Back preserves it", async t => {
  const { page, jobWrites } = await setup(t, { mode: "jobs" });
  await page.getByRole("button", { name: "Create job", exact: true }).click();
  await page.getByRole("button", { name: "Create blank job", exact: true }).click();
  await page.getByLabel("Job title", { exact: true }).fill("Engineer Spain");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator('.hub-review-team > summary').click();
  await page.getByRole("checkbox", { name: /maria@example.invalid/ }).check();
  await page.getByRole("checkbox", { name: /alex@example.invalid/ }).check();
  assert.equal(await page.getByLabel("Default reply contact", { exact: true }).count(), 1);
  await page.getByLabel("Default reply contact",{exact:true}).selectOption(staff[1].email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.goBack();
  await page.locator('.hub-review-team > summary').waitFor();
  await page.locator('.hub-review-team > summary').click();
  assert.equal(await page.getByRole("checkbox", { name: /alex@example.invalid/ }).isChecked(), true);
  await page.getByRole("button", { name: "Save draft job", exact: true }).click();
  await page.getByText("Draft saved.", { exact: false }).waitFor();
  assert.equal(jobWrites.length, 1);
  assert.deepEqual(jobWrites[0].hiringTeam.members, [staff[1].email, staff[2].email]);
  assert.equal(jobWrites[0].hiringTeam.replyTo, staff[1].email);
  assert.equal(jobWrites[0].expectedTeamRevision, 0);
});

test("duplicating a posting starts with an empty team; editing loads the existing team's revision", async t => {
  const { page, jobWrites } = await setup(t, { mode: "jobs" });
  await page.getByLabel(`Actions for ${job.title}`, {exact:true}).click();
  await page.getByRole("button", { name: "Duplicate job", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator('.hub-review-team > summary').click();
  await page.getByRole("checkbox", { name: /maria@example.invalid/ }).waitFor();
  assert.equal(await page.getByRole("checkbox", { name: /maria@example.invalid/ }).isChecked(), false);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  if(await page.getByRole("button", {name:"Leave without saving",exact:true}).count()) await page.getByRole("button", {name:"Leave without saving",exact:true}).click();
  await page.getByRole("button", { name: "Edit job", exact: true }).click();
  await page.getByRole("list",{name:"Job setup progress"}).getByRole("button",{name:"Review setup",exact:true}).click();
  await page.locator('.hub-review-team > summary').click();
  await page.getByRole("checkbox", { name: /maria@example.invalid/ }).waitFor();
  assert.equal(await page.getByRole("checkbox", { name: /maria@example.invalid/ }).isChecked(), true);
  await page.getByRole("button",{name:"Continue",exact:true}).click();
  await page.getByRole("button", { name: "Unpublish job", exact: true }).click();
  await page.getByText("Draft saved.", { exact: false }).waitFor();
  assert.equal(jobWrites[0].expectedTeamRevision, 2);
  assert.deepEqual(jobWrites[0].hiringTeam.members, [staff[1].email]);
});

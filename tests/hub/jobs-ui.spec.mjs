async function addQuestion(page,kind="custom"){await page.getByLabel("Add a question",{exact:true}).selectOption(kind);await page.getByRole("button",{name:"Add question",exact:true}).click();}
import {installDraftFixture} from "./draft-ui-fixture.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";
const prior = {
  id: "existing-job",
  title: "Creative Strategist",
  slug: "creative-strategist-spain",
  department: "Creative",
  location: "Spain — approved location",
  status: "open",
  descriptionHtml: "Approved creative role description",
  fields: [
    {
      path: "_systemfield_name",
      title: "Full name",
      type: "String",
      required: true,
    },
    {
      path: "_systemfield_email",
      title: "Email",
      type: "Email",
      required: true,
    },
    {
      path: "_systemfield_resume",
      title: "Resume",
      type: "File",
      required: false,
    },
  ],
  rules: [],
  autoReject: false,
  rejectionTemplate: "Thank you",
  assessmentPrompt: "Creative task",
  formVersion: 3,
  archiveProject: "Creative Strategist",
  archiveCountry: "Spain",
  hiringRound: "Previous round",
};
const anchors = [
  "No evidence",
  "Limited evidence",
  "Meets criterion",
  "Strong evidence",
  "Exceptional evidence",
];
const scores = {
  revision: 0,
  templates: [
    {
      id: "a9e065f9-1e11-49bd-8b5c-882e057e49b2",
      name: "Approved portfolio review",
      version: 1,
      criteria: [{ label: "Personal contribution", weight: 1, anchors }],
      createdAt: 1,
      createdBy: "manager@example.invalid",
    },
  ],
  archived: [],
  bindings: {
    "existing-job": {
      templateId: "a9e065f9-1e11-49bd-8b5c-882e057e49b2",
      version: 1,
    },
  },
};
const savedTemplate = {
  id: "e06b3a35-806b-4ab6-bd9a-07d183fb87a8",
  name: "Creative template",
  sourceJobId: prior.id,
  job: prior,
  location: { workModel: "remote", country: "Spain", city: "" },
  scorecard: scores.bindings[prior.id],
  createdAt: 1,
};
async function setup(
  t,
  {
    mobile = false,
    startCreating = false,
    jobs = [prior],
    catalog = {
      revision: 0,
      templates: [savedTemplate],
      requests: [],
      locations: {},
    },
    scoreCatalog = scores,
    failFirst = false,
    holdTemplateSave = null,
    failLifecycle = false,
  } = {},
) {
  const { outputFiles } = await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{Jobs}from'./components/hub/jobs';import{HUB_HISTORY_GUARD}from'./components/hub/history';(0,eval)(HUB_HISTORY_GUARD);createRoot(document.getElementById('root')).render(<main data-hiring-workspace><Jobs admin refresh={0} changed={()=>{}} startCreating={${startCreating}}/></main>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
  });
  const server = createServer((req, res) => {
    res.setHeader(
      "Content-Type",
      req.url === "/bundle.js" ? "text/javascript" : "text/html",
    );
    res.end(
      req.url === "/bundle.js"
        ? outputFiles[0].text
        : '<div id="root"></div><script src="/bundle.js"></script>',
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    browser = await chromium.launch({
      headless: true,
      ...(existsSync(chrome) ? { executablePath: chrome } : {}),
    });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const page = await browser.newPage({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 900 },
    }),
    writes = [],
    catalogWrites = [], lifecycleWrites = [];
  await page.route("**/api/hub/jobs", (route) =>
    route.fulfill({ json: { data: jobs } }),
  );
  await page.route("**/api/hub/jobs/*/lifecycle", async route => {
    const input = route.request().postDataJSON();
    lifecycleWrites.push(input);
    if (failLifecycle && lifecycleWrites.length === 1) return route.fulfill({ status: 409, json: { error: { message: "This job changed. Refresh the job list before trying again." } } });
    const id = new URL(route.request().url()).pathname.split("/").at(-2), index = jobs.findIndex(job => job.id === id), current = jobs[index];
    jobs = [...jobs];
    const state = input.action === "archive" ? "archived" : input.action === "delete" ? "deleted" : "active";
    jobs[index] = { ...current, status: input.action === "resume" ? "open" : "closed", lifecycle: { state, revision: (current.lifecycle?.revision || 0) + 1, changedAt: Date.now(), changedBy: "recruiter@example.invalid" } };
    return route.fulfill({ json: { data: jobs[index] } });
  });
  await page.route("**/api/scorecards", (route) =>
    route.fulfill({ json: { data: scoreCatalog } }),
  );
  await page.route("**/api/job-setup", async (route) => {
    const req = route.request();
    if (req.method() === "GET")
      return route.fulfill({ json: { data: catalog } });
    const input = req.postDataJSON();
    if (req.method() === "PATCH") {
      catalogWrites.push(input);
      if(input.action === "template" && holdTemplateSave) await holdTemplateSave;
      catalog = { ...catalog, revision: catalog.revision + 1 };
      if (input.action === "request")
        catalog.requests = [
          ...catalog.requests,
          {
            ...input,
            id: "d7e206b0-20e8-46ac-b55f-7787803f2b96",
            createdAt: 1,
            createdBy: "manager@example.invalid",
            status: "pending",
          },
        ];
      if (input.action === "template")
        catalog.templates = [
          ...catalog.templates,
          { ...savedTemplate, name: input.name },
        ];
      return route.fulfill({ json: { data: catalog } });
    }
    writes.push(input);
    if (failFirst && writes.length === 1)
      return route.fulfill({
        status: 422,
        json: {
          error: {
            message: "Temporary save failure. Your draft is still here.",
          },
        },
      });
    return route.fulfill({
      json: {
        data: {
          ...input.job,
          id: input.jobId || input.creationId,
          formVersion: 4,
        },
      },
    });
  });
  page.setDefaultTimeout(10000);
  await installDraftFixture(page, {team: true});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page
    .getByRole("heading", {
      name: startCreating ? "Create a job" : "Jobs",
      exact: true,
    })
    .waitFor();
  return { page, writes, catalogWrites, lifecycleWrites };
}
async function next(page) {
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}
test("mobile blank job follows real steps, required questions and scorecard; failed publication retains every entry and retry ID", async (t) => {
  const { page, writes } = await setup(t, {
    mobile: true,
    jobs: [],
    failFirst: true,
  });
  await page.getByRole("button", { name: "Create job", exact: true }).click();
  await page.getByRole("button", { name: "Create blank job" }).click();
  assert.equal(
    await page
      .getByText("What should applicants send?", { exact: true })
      .count(),
    0,
  );
  await page.getByRole("list",{name:"Job setup progress"}).getByRole("button",{name:"Preview & publish",exact:true}).click();
  await page.getByRole("button",{name:"Publish job",exact:true}).click();
  await page
    .getByText("Add a job title, then choose a work arrangement", {
      exact: false,
    })
    .waitFor();
  await page
    .getByLabel("Job title", { exact: true })
    .fill("Synthetic Creative Strategist");
  await page.getByLabel("Work arrangement").selectOption("onsite");
  await page.getByLabel("Country", { exact: true }).selectOption("Spain");
  await page.getByRole("list",{name:"Job setup progress"}).getByRole("button",{name:"Preview & publish",exact:true}).click();
  await page.getByRole("button",{name:"Publish job",exact:true}).click();
  await page
    .getByText("Office-based jobs need a country and city", { exact: false })
    .waitFor();
  await page.getByLabel("City", { exact: true }).fill("Madrid");
  await page
    .getByLabel("Job description", { exact: true })
    .fill("Approved synthetic responsibilities");
  await next(page);
  assert.equal(await page.getByLabel("Question 1 requirement").count(),0);
  await addQuestion(page,"linkedin_profile");
  assert.equal(
    await page.getByLabel("Question 3 requirement").inputValue(),
    "optional",
  );
  await addQuestion(page,"custom");
  await page
    .getByLabel("Question 4 label")
    .fill("What did you personally contribute?");
  await page.getByLabel("Question 4 requirement").selectOption("required");
  await next(page);
  await page.getByText("Optional: manual reviewer scorecard", {exact:true}).click();
  await page
    .getByLabel("Review scorecard", { exact: true })
    .selectOption("new");
  await page
    .getByLabel("Scorecard name", { exact: true })
    .fill("Synthetic work review");
  await page
    .getByLabel("Review criterion 1", { exact: true })
    .fill("Personal contribution to the work");
  await next(page);
  assert.equal(await page.getByRole("checkbox", {name: /I have reviewed|I approve/}).count(), 0);
  await page.getByRole("button", { name: "Publish job", exact: true }).click();
  await page
    .getByText("Temporary save failure. Your draft is still here.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page
      .getByRole("heading", {
        name: "Synthetic Creative Strategist",
        exact: true,
      })
      .count(),
    1,
  );
  await page.getByRole("button", { name: "Publish job", exact: true }).click();
  await page.getByText("Job published.", { exact: false }).waitFor();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[0].job.status, "open");
  assert.equal(writes[0].job.autoReject, false);
  assert.equal(writes[0].location.city, "Madrid");
  assert.equal(writes[0].rubric.criteria[0].weight, 1);
  assert.ok(writes[0].job.fields.slice(0, 4).every(field => field.required));
  assert.equal(writes[0].job.fields[4].required, true);
  assert.equal(writes[0].job.fields[5].required, false);
  assert.equal(writes[0].job.fields[6].required, false);
  assert.equal(writes[0].job.fields[7].required, true);
  assert.doesNotMatch(writes[0].job.hiringRound, /Batch/);
});
test("editing a legacy posting preserves its address, archive labels, form revision and unset location", async (t) => {
  const { page, writes } = await setup(t);
  await page.getByRole("button", { name: "Edit job", exact: true }).click();
  assert.equal(await page.getByLabel("Work arrangement").inputValue(), "");
  await next(page);await next(page);await next(page);
  await page
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await page.getByText("Changes saved.", { exact: false }).waitFor();
  assert.equal(writes[0].job.status,"open");
  assert.equal(writes[0].jobId, prior.id);
  assert.equal(writes[0].formVersion, 3);
  assert.equal(writes[0].job.slug, prior.slug);
  assert.equal(writes[0].job.hiringRound, prior.hiringRound);
  assert.equal(writes[0].job.archiveCountry, prior.archiveCountry);
  assert.equal(writes[0].location, null);
  assert.deepEqual(writes[0].scorecard, scores.bindings[prior.id]);
});
test("duplicate and saved-template entry points create a separate posting with preserved criteria", async (t) => {
  const { page, writes } = await setup(t);
  const original = structuredClone(prior);
  await page.getByLabel(`Actions for ${prior.title}`, { exact: true }).click();
  await page
    .getByRole("button", { name: "Duplicate job", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Job title", { exact: true }).inputValue(),
    prior.title,
  );
  assert.equal(await page.getByLabel("Work arrangement").inputValue(), "");
  await page.getByLabel("Work arrangement").selectOption("remote");
  await page
    .getByLabel("Where can applicants work from?")
    .selectOption("United States");
  await page.getByRole("button", { name: "Save draft job", exact: true }).click();
  await page.getByText("Draft saved.", { exact: false }).waitFor();
  assert.equal(writes[0].jobId, undefined);
  assert.equal(writes[0].job.autoReject, false);
  assert.notEqual(writes[0].job.slug, prior.slug);
  assert.notEqual(writes[0].job.hiringRound, prior.hiringRound);
  assert.deepEqual(writes[0].scorecard, scores.bindings[prior.id]);
  assert.deepEqual(prior, original);
  await page.getByRole("button", { name: "Create job", exact: true }).click();
  await page
    .getByRole("button", { name: "Choose template", exact: true })
    .click();
  await page
    .getByLabel("Job template", { exact: true })
    .selectOption(savedTemplate.id);
  await page
    .getByRole("button", { name: "Use this template", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Where can applicants work from?").inputValue(),
    "Spain",
  );
  await page.getByRole("button", { name: "Save draft job", exact: true }).click();
  await page.getByText("Draft saved.", { exact: false }).waitFor();
  assert.equal(writes[1].job.descriptionHtml, prior.descriptionHtml);
  assert.deepEqual(writes[1].scorecard, scores.bindings[prior.id]);
});
test("home shortcut opens creation and a saved form request becomes an editable draft", async (t) => {
  const { page, writes, catalogWrites } = await setup(t, {
    startCreating: true,
  });
  await page
    .getByRole("button", { name: "Open hiring requests", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create a hiring request", exact: true })
    .click();
  await page
    .getByLabel("Requested job title", { exact: true })
    .fill("Requested Engineer");
  await page.getByLabel("Work arrangement").selectOption("hybrid");
  await page.getByLabel("Country", { exact: true }).selectOption("Colombia");
  await page.getByLabel("City", { exact: true }).fill("Bogotá");
  await page
    .getByLabel("Why do we need this hire?", { exact: true })
    .fill("Approved growth request");
  await page
    .getByLabel("Draft responsibilities (optional)")
    .fill("Approved request responsibilities");
  await page
    .getByRole("button", { name: "Save hiring request", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create job from request", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Job title", { exact: true }).inputValue(),
    "Requested Engineer",
  );
  assert.equal(
    await page.getByLabel("City", { exact: true }).inputValue(),
    "Bogotá",
  );
  await page.getByRole("button", { name: "Save draft job", exact: true }).click();
  await page.getByText("Draft saved.", { exact: false }).waitFor();
  assert.equal(catalogWrites.length, 1);
  assert.equal(catalogWrites[0].action, "request");
  assert.equal(writes[0].requestId, "d7e206b0-20e8-46ac-b55f-7787803f2b96");
  assert.equal(writes[0].job.status, "draft");
  assert.equal(
    writes[0].job.descriptionHtml,
    "Approved request responsibilities",
  );
});
test("duplicating a posting visibly preserves its pinned rubric instead of silently using a newer version", async (t) => {
  const upgraded = {
    ...scores.templates[0],
    version: 2,
    criteria: [{ label: "New criteria", weight: 1, anchors }],
  };
  const { page, writes } = await setup(t, {
    scoreCatalog: { ...scores, templates: [...scores.templates, upgraded] },
  });
  await page.getByLabel(`Actions for ${prior.title}`, { exact: true }).click();
  await page
    .getByRole("button", { name: "Duplicate job", exact: true })
    .click();
  await page.getByLabel("Work arrangement").selectOption("remote");
  await next(page);
  await next(page);
  await page.getByText("Optional: manual reviewer scorecard", {exact:true}).click();
  const select = page.getByLabel("Review scorecard", { exact: true });
  assert.equal(await select.inputValue(), scores.templates[0].id + ":1");
  assert.match(
    await select.locator("option:checked").textContent(),
    /copied version 1/,
  );
  assert.equal(
    await page
      .getByText("Personal contribution · weight 1", { exact: true })
      .count(),
    1,
  );
  await page.getByRole("button", { name: "Save draft job", exact: true }).click();
  await page.getByText("Draft saved.", { exact: false }).waitFor();
  assert.equal(writes[0].scorecard.version, 1);
});

test("pending template saves lock every job flow action and preserve the selected source",async t=>{
 let release;const held=new Promise(resolve=>release=resolve);t.after(()=>release());
 const {page,catalogWrites}=await setup(t,{jobs:[prior,{...prior,id:"other-job",title:"Engineer",slug:"engineer"}],holdTemplateSave:held});
 await page.getByLabel(`Actions for ${prior.title}`,{exact:true}).click();await page.getByRole("button",{name:"Save as template",exact:true}).first().click();await page.getByLabel("Template name",{exact:true}).fill("Approved first template");
 const request=page.waitForRequest(r=>r.method()==="PATCH");await page.getByRole("button",{name:"Save template",exact:true}).click();await request;
 assert.equal(await page.getByLabel("Template name",{exact:true}).isDisabled(),true);
 for(const name of ["Create job","Edit job","Duplicate job","Save as template","Save template","Cancel"]){
   const actions=page.getByRole("button",{name,exact:true,includeHidden:true});assert.ok(await actions.count(),name);for(const action of await actions.all())assert.equal(await action.isDisabled(),true,name);
 }
 assert.equal(await page.getByLabel("Template name",{exact:true}).inputValue(),"Approved first template");release();
 await page.getByText("Job template saved. Choose it next time you create a job.",{exact:true}).waitFor();
 assert.equal(catalogWrites[0].sourceJobId,prior.id);assert.equal(catalogWrites[0].name,"Approved first template");assert.equal(await page.getByLabel("Template name",{exact:true}).count(),0);
 assert.equal(await page.getByRole("button",{name:"Create job",exact:true}).isDisabled(),false);
});

test("browser Back and Forward navigate wizard steps while retaining the unsaved job",async t=>{
 const {page,writes}=await setup(t,{mobile:true,jobs:[]});
 await page.getByRole('button',{name:'Create job',exact:true}).click();
 await page.getByRole('button',{name:'Create blank job',exact:true}).click();
 await page.getByLabel('Job title',{exact:true}).fill('Unpublished navigation draft');
 await page.getByLabel('Where can applicants work from?',{exact:true}).selectOption('Spain');
 await next(page);await page.getByRole('heading',{name:'What should applicants send?',exact:true}).waitFor();
 await page.goBack();await page.getByRole('heading',{name:'Tell applicants about the job',exact:true}).waitFor();
 assert.equal(await page.getByLabel('Job title',{exact:true}).inputValue(),'Unpublished navigation draft');
 await page.goBack();await page.getByRole('button',{name:'Save draft & leave',exact:true}).click();await page.getByRole('heading',{name:'Create a job',exact:true}).waitFor();
 await page.goForward();await page.getByText(/Saved draft restored/).waitFor();
 assert.equal(await page.getByLabel('Job title',{exact:true}).inputValue(),'Unpublished navigation draft');
 assert.equal(await page.getByLabel('Where can applicants work from?',{exact:true}).inputValue(),'Spain');
 await page.goForward();await page.getByRole('heading',{name:'What should applicants send?',exact:true}).waitFor();
 // Historical section navigation restores the target without requiring sequential validation.
 await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('heading',{name:'Tell applicants about the job',exact:true}).waitFor();
 assert.equal(await page.getByLabel('Job title',{exact:true}).inputValue(),'Unpublished navigation draft');
 assert.equal(writes.length,0);
});

test('pending save must not close a newer draft after browser history',async t=>{
 const {page}=await setup(t,{jobs:[]});
 let release;const held=new Promise(resolve=>release=resolve);t.after(()=>release());
 await page.route('**/api/job-setup',async route=>{if(route.request().method()!=='POST')return route.fallback();await held;return route.fulfill({json:{data:{id:'saved-first',...route.request().postDataJSON().job}}});});
 await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('button',{name:'Create blank job',exact:true}).click();await page.getByLabel('Job title',{exact:true}).fill('First pending draft');
 const req=page.waitForRequest(r=>r.method()==='POST');await page.getByRole('button',{name:'Save draft job',exact:true}).click();await req;
 await page.goBack();await page.getByRole('button',{name:'Save draft & leave',exact:true}).click();await page.getByRole('heading',{name:'Create a job',exact:true}).waitFor();
 await page.goBack();await page.getByRole('heading',{name:'Jobs',exact:true}).waitFor();
 await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('button',{name:'Create blank job',exact:true}).click();await page.getByLabel('Job title',{exact:true}).fill('Second independent draft');
 release();await page.waitForResponse(r=>r.request().method()==='POST');await page.waitForTimeout(200);
 assert.equal(await page.getByLabel('Job title',{exact:true}).count(),1,'first completion must not close second draft');assert.equal(await page.getByLabel('Job title',{exact:true}).inputValue(),'Second independent draft');
});

test('direct draft URL opens preview but publishing still validates details',async t=>{
 const {page,writes}=await setup(t,{jobs:[]});await page.goto(new URL('/?view=jobs&jobEditor=new&jobStart=blank&jobStep=3',page.url()).href);await page.getByRole('button',{name:'Publish job',exact:true}).click();assert.equal(writes.length,0);await page.getByRole('heading',{name:'Tell applicants about the job',exact:true}).waitFor({timeout:2500});
});
test('completed save history never revives a duplicate submission, fresh creation and cancellation still work',async t=>{const{page,writes}=await setup(t,{jobs:[]});await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('button',{name:'Create blank job',exact:true}).click();await page.getByLabel('Job title',{exact:true}).fill('Completed posting');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Save draft job',exact:true}).click();await page.getByText('Draft saved.',{exact:false}).waitFor();await page.goBack();await page.getByRole('heading',{name:'Jobs',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.has('jobEditor'),false);assert.equal(writes.length,1);await page.goForward();await page.getByRole('heading',{name:'Jobs',exact:true}).waitFor();await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('button',{name:'Create blank job',exact:true}).click();assert.equal(await page.getByLabel('Job title',{exact:true}).inputValue(),'');await page.getByLabel('Job title',{exact:true}).fill('Fresh cancelled draft');await page.getByRole('button',{name:'Back to jobs',exact:true}).click();await page.getByRole('button',{name:'Save draft & leave',exact:true}).click();await page.getByRole('heading',{name:'Jobs',exact:true}).waitFor();await page.goBack();await page.getByText(/Saved draft restored/).waitFor();assert.equal(await page.getByLabel('Job title',{exact:true}).inputValue(),'Fresh cancelled draft');assert.equal(writes.length,1);});
test('fractional and nonfinite direct wizard steps normalize to validated Details',async t=>{const{page}=await setup(t,{jobs:[]});for(const step of ['1.5','Infinity','NaN','-2']){await page.goto(new URL('/?view=jobs&jobEditor=new&jobStart=blank&jobStep='+step,page.url()).href);await page.getByRole('heading',{name:'Tell applicants about the job',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('jobStep'),'0');}});
test('pending save must not close a newly chosen template in the same chooser history',async t=>{const{page}=await setup(t);let release;const held=new Promise(resolve=>release=resolve);t.after(()=>release());await page.route('**/api/job-setup',async route=>{if(route.request().method()!=='POST')return route.fallback();await held;return route.fulfill({json:{data:{id:'saved-first',...route.request().postDataJSON().job}}});});await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('button',{name:'Create blank job',exact:true}).click();await page.getByLabel('Job title',{exact:true}).fill('First pending draft');const req=page.waitForRequest(r=>r.method()==='POST');await page.getByRole('button',{name:'Save draft job',exact:true}).click();await req;await page.goBack();await page.getByRole('button',{name:'Save draft & leave',exact:true}).click();await page.getByRole('heading',{name:'Create a job',exact:true}).waitFor();await page.getByRole('button',{name:'Choose template',exact:true}).click();await page.getByLabel('Job template',{exact:true}).selectOption(savedTemplate.id);await page.getByRole('button',{name:'Use this template',exact:true}).click();await page.getByLabel('Job title',{exact:true}).fill('Second template draft');release();await page.waitForResponse(r=>r.request().method()==='POST');await page.waitForTimeout(200);assert.equal(await page.getByLabel('Job title',{exact:true}).count(),1);assert.equal(await page.getByLabel('Job title',{exact:true}).inputValue(),'Second template draft');});

test("published job sections can be opened directly without Continue or saving", async (t) => {
  const { page, writes } = await setup(t);
  await page.getByRole("button", { name: "Edit job", exact: true }).click();
  const steps = page.getByRole("list", { name: "Job setup progress" });
  await steps.getByRole("button", { name: "Application questions", exact: true }).click();
  await page.getByRole("heading", { name: "What should applicants send?", exact: true }).waitFor();
  await steps.getByRole("button", { name: "Preview & publish", exact: true }).click();
  await page.getByRole("heading", { name: "Ready to share?", exact: true }).waitFor();
  await steps.getByRole("button", { name: "Job details", exact: true }).click();
  await page.getByRole("heading", { name: "Tell applicants about the job", exact: true }).waitFor();
  await page.goBack();
  await page.getByRole("heading", { name: "Ready to share?", exact: true }).waitFor();
  assert.equal(writes.length, 0);
});

test("contact fields are fixed and remaining application questions can be reordered", async (t) => {
 const {page}=await setup(t,{jobs:[{...prior,fields:[...prior.fields,{path:"portfolio",title:"Portfolio",type:"Url",required:false}]}]});
 await page.getByRole('button',{name:'Edit job',exact:true}).click();
 await page.getByRole('list',{name:'Job setup progress'}).getByRole('button',{name:'Application questions',exact:true}).click();
 const questions=page.locator('.hub-question');
 assert.match(await page.locator('.hub-required-contacts').innerText(),/First name · Last name · Email · Phone number/);
 assert.equal(await questions.locator('.hub-question-row-title > strong').getByText('Phone number',{exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Remove Phone number',exact:true}).count(),0);
 const down=page.getByRole('button',{name:/^Move .* down$/}).first();
 assert.equal(await down.isEnabled(),true);
 {
  const before=await questions.locator('.hub-question-row-title > strong').allTextContents();
  await down.click();
  const after=await questions.locator('.hub-question-row-title > strong').allTextContents();
  assert.equal(after[0],before[1]); assert.equal(after[1],before[0]);
 }
});

test("question instructions are collapsed by default and publish needs no approval checklist", async (t) => {
 const {page,writes}=await setup(t,{jobs:[{...prior,fields:[...prior.fields,{path:'portfolio',title:'Portfolio',type:'Url',required:false,description:'Existing helper text'}]}]});
 await page.getByRole('button',{name:'Edit job',exact:true}).click();const steps=page.getByRole('list',{name:'Job setup progress'});await steps.getByRole('button',{name:'Application questions',exact:true}).click();
 const instructions=page.getByLabel('Question 2 instructions (optional)',{exact:true});assert.equal(await instructions.isVisible(),false);
 await openQuestion(page,'Portfolio');await page.getByText('Edit instructions (optional)',{exact:true}).click();assert.equal(await instructions.inputValue(),'Existing helper text');await instructions.fill('Updated helper text');
 await steps.getByRole('button',{name:'Review settings',exact:true}).click();assert.equal(await page.getByRole('checkbox',{name:/Rank applicants with AI/}).isChecked(),false);
 await steps.getByRole('button',{name:'Preview & publish',exact:true}).click();assert.equal(await page.getByRole('checkbox',{name:/I have reviewed|I approve/}).count(),0);
 if(process.env.JOB_WIZARD_SCREENSHOT)await page.screenshot({path:process.env.JOB_WIZARD_SCREENSHOT,fullPage:true});
 await page.getByRole('button',{name:'Save changes',exact:true}).first().click();await page.getByText('Changes saved. This job is still open.',{exact:false}).waitFor();assert.equal(writes.length,1);assert.equal(writes[0].job.fields.find(field=>field.path==='portfolio').description,'Updated helper text');assert.equal(writes[0].job.aiMatchEnabled,false);assert.equal(writes[0].job.autoReject,false);
});

test("jobs keep daily actions visible and move secondary tools into a compact menu", async t => {
 const {page,writes,catalogWrites}=await setup(t);
 assert.equal(await page.locator('.hub-job-row').count(),1);
 assert.equal(await page.locator('.hub-role-card').count(),0);
 assert.equal(await page.getByRole('link',{name:`View applicants for ${prior.title}`,exact:true}).getAttribute('href'),'/team?view=applications&jobId='+prior.id);
 assert.equal(await page.getByRole('button',{name:'Edit job',exact:true}).isVisible(),true);
 assert.equal(await page.getByRole('button',{name:'Duplicate job',exact:true}).isVisible(),false);
 assert.equal(await page.getByRole('button',{name:'Save as template',exact:true}).isVisible(),false);
 const menu=page.getByLabel(`Actions for ${prior.title}`,{exact:true});
 await menu.focus();await page.keyboard.press('Enter');
 assert.equal(await page.getByRole('button',{name:'Duplicate job',exact:true}).isVisible(),true);
 assert.equal(await page.getByRole('link',{name:'View public job',exact:true}).getAttribute('href'),'/jobs/'+prior.slug);
 await page.getByRole('button',{name:'Save as template',exact:true}).click();
 assert.equal(await page.locator('.hub-job-menu').getAttribute('open'),null);
 assert.equal(await page.getByLabel('Template name',{exact:true}).inputValue(),prior.title);
 assert.equal(writes.length,0);assert.equal(catalogWrites.length,0);
});

test("new job setup presents four clear steps and publishes without manual scorecards or approval checklists", async t => {
 const {page,writes}=await setup(t,{jobs:[]});
 await page.getByRole('button',{name:'Create job',exact:true}).click();
 assert.equal(await page.locator('.hub-start-option').count(),4);
 await page.getByRole('button',{name:'Create blank job',exact:true}).click();
 const progress=page.getByRole('list',{name:'Job setup progress'});
 assert.deepEqual(await progress.getByRole('button').allTextContents(),['Job details','Application questions','Review settings','Preview & publish']);
 await page.getByLabel('Job title',{exact:true}).fill('Synthetic streamlined engineer');
 await page.getByLabel('Job description',{exact:true}).fill('Build reliable TypeScript services and own deployment.');
 await next(page);await next(page);
 assert.equal(await page.getByLabel('Review scorecard',{exact:true}).isVisible(),false);
 assert.equal(await page.getByLabel('Recruiter who handles candidate replies',{exact:true}).isVisible(),false);
 await page.getByRole('checkbox',{name:/Rank applicants with AI/}).check();
 await next(page);
 assert.equal(await page.getByRole('checkbox',{name:/I have reviewed|I approve/}).count(),0);
 assert.equal(await page.getByText('First name — Required',{exact:true}).isVisible(),false);
 await page.getByRole('button',{name:'Publish job',exact:true}).click();
 await page.getByText('Job published.',{exact:false}).waitFor();
 assert.equal(writes.length,1);assert.equal(writes[0].job.aiMatchEnabled,true);assert.equal(writes[0].scorecard,null);
 assert.equal(writes[0].job.fields.find(f=>f.path==='_systemfield_phone').required,true);
 assert.equal(writes[0].job.autoReject,false);
});

test("Actions closes with Escape and jobs can be paused and resumed from Actions without opening setup", async t => {
 const {page,writes,lifecycleWrites}=await setup(t);
 const menu=page.getByLabel(`Actions for ${prior.title}`,{exact:true});
 await menu.click();
 await page.getByRole('button',{name:'Archive job',exact:true}).focus();
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('.hub-job-menu').getAttribute('open'),null);
 assert.equal(await menu.evaluate(element=>element===document.activeElement),true);
 await page.getByLabel(`Actions for ${prior.title}`,{exact:true}).click();
 await page.getByRole('button',{name:'Pause job',exact:true}).click();
 await page.getByText('Paused',{exact:true}).waitFor();
 await menu.click();
 await page.getByRole('button',{name:'Resume job',exact:true}).waitFor();
 assert.equal(await page.getByText('Paused',{exact:true}).isVisible(),true);
 assert.deepEqual(lifecycleWrites[0],{action:'pause',formVersion:3,lifecycleRevision:0});
 await page.getByRole('button',{name:'Resume job',exact:true}).click();
 await page.getByText('Open',{exact:true}).waitFor();
 assert.deepEqual(lifecycleWrites[1],{action:'resume',formVersion:3,lifecycleRevision:1});
 assert.equal(await page.getByRole('heading',{name:'Ready to share?',exact:true}).count(),0);
 assert.equal(writes.length,0);
});

test("Archived and Trash are visible lists; archive, safe deletion and restore preserve applicant access on mobile", async t => {
 const {page,writes,lifecycleWrites}=await setup(t,{mobile:true});
 const menu=()=>page.getByLabel(`Actions for ${prior.title}`,{exact:true});
 await menu().click();await page.getByRole('button',{name:'Archive job',exact:true}).click();
 await page.getByRole('heading',{name:'No matching jobs',exact:true}).waitFor();
 await page.getByRole('button',{name:/^Archived \(1\)$/}).click();
 await page.getByRole('link',{name:`View applicants for ${prior.title}`,exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Edit job',exact:true}).count(),0);
 await menu().click();await page.getByRole('button',{name:'Delete job',exact:true}).click();
 assert.equal(lifecycleWrites.length,1);
 assert.equal(await page.getByRole('dialog',{name:`Move “${prior.title}” to Trash?`,exact:true}).isVisible(),true);
 assert.equal(await page.getByRole('button',{name:'Cancel deletion',exact:true}).evaluate(element=>element===document.activeElement),true);
 await page.keyboard.press('Tab');
 assert.equal(await page.getByRole('button',{name:'Move job to Trash',exact:true}).evaluate(element=>element===document.activeElement),true);
 await page.keyboard.press('Shift+Tab');
 assert.equal(await page.getByRole('button',{name:'Cancel deletion',exact:true}).evaluate(element=>element===document.activeElement),true);
 await page.getByRole('button',{name:'Cancel deletion',exact:true}).click();
 assert.equal(await menu().evaluate(element=>element===document.activeElement),true);
 assert.equal(lifecycleWrites.length,1);
 await menu().click();await page.getByRole('button',{name:'Delete job',exact:true}).click();
 await page.getByText(/Existing applicants, PDFs and Drive files stay saved/).waitFor();
 await page.getByRole('button',{name:'Move job to Trash',exact:true}).click();
 await page.getByRole('heading',{name:'No archived jobs',exact:true}).waitFor();
 await page.getByRole('button',{name:/^Trash \(1\)$/}).click();
 await page.getByRole('link',{name:`View applicants for ${prior.title}`,exact:true}).waitFor();
 await page.getByRole('button',{name:'Restore job',exact:true}).click();
 await page.getByRole('heading',{name:'Trash is empty',exact:true}).waitFor();
 await page.getByRole('button',{name:/^Current jobs \(1\)$/}).click();
 await page.getByText('Paused',{exact:true}).waitFor();
 assert.deepEqual(lifecycleWrites.map(input=>input.action),['archive','delete','restore']);
 assert.equal(writes.length,0);
});

test("a failed lifecycle action preserves the row and explains that it must be refreshed", async t => {
 const {page,lifecycleWrites}=await setup(t,{failLifecycle:true});
 await page.getByLabel(`Actions for ${prior.title}`,{exact:true}).click();
 await page.getByRole('button',{name:'Pause job',exact:true}).click();
 await page.getByText('This job changed. Refresh the job list before trying again.',{exact:true}).waitFor();
 await page.getByLabel(`Actions for ${prior.title}`,{exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Pause job',exact:true}).isVisible(),true);
 assert.equal(await page.getByRole('button',{name:'Resume job',exact:true}).count(),0);
 assert.equal(lifecycleWrites.length,1);
});

for(const status of ['open','closed','draft'])test(`existing ${status} job saves directly from details without changing availability`,async t=>{
 const{page,writes}=await setup(t,{jobs:[{...prior,status}]});await page.getByRole('button',{name:'Edit job',exact:true}).click();await page.getByLabel('Job title',{exact:true}).fill('Updated directly');await page.getByRole('button',{name:'Save changes',exact:true}).first().click();await page.getByText(`Changes saved. This job is still ${status==='open'?'open':status==='closed'?'paused':'a draft'}.`,{exact:false}).waitFor();assert.equal(writes.length,1);assert.equal(writes[0].job.status,status);assert.equal(writes[0].job.title,'Updated directly');assert.equal(writes[0].formVersion,3);assert.equal(writes[0].job.autoReject,false);
});
test('direct save validates hidden sections and returns to the unfinished question',async t=>{
 const{page,writes}=await setup(t,{jobs:[{...prior,fields:[...prior.fields,{path:'broken',type:'String',title:'',required:false}]}]});await page.getByRole('button',{name:'Edit job',exact:true}).click();await page.getByRole('button',{name:'Save changes',exact:true}).first().click();await page.getByText('Give each question a label and add choices to any choice question.',{exact:true}).waitFor();assert.equal(writes.length,0);assert.equal(new URL(page.url()).searchParams.get('jobStep'),'1');
});
test('country requirement saves directly from Questions without publishing or enabling automatic rejection',async t=>{
 const{page,writes}=await setup(t,{jobs:[{...prior,status:'closed'}]});await page.getByRole('button',{name:'Edit job',exact:true}).click();await page.getByRole('list',{name:'Job setup progress'}).getByRole('button',{name:'Application questions',exact:true}).click();await addQuestion(page,"country");await page.getByLabel('Eligible countries',{exact:true}).selectOption('in');await page.getByLabel('Find countries',{exact:true}).fill('Spain');await page.getByLabel('Spain',{exact:true}).check();await page.getByRole('button',{name:'Save changes',exact:true}).first().click();await page.getByText('Changes saved. This job is still paused.',{exact:false}).waitFor();assert.equal(writes.length,1);assert.equal(writes[0].job.status,'closed');assert.equal(writes[0].job.autoReject,false);assert.equal(writes[0].job.fields.find(f=>f.path==='country_of_residence').options.length,249);assert.deepEqual(writes[0].job.rules.find(r=>r.fieldPath==='country_of_residence').value,['ES']);
});
test('numeric question supports USD display and comma minimum while resume remains mandatory',async t=>{
 const{page,writes}=await setup(t,{jobs:[{...prior,fields:[...prior.fields,{path:'budget',title:'Managed monthly budget',type:'Number',required:false}]}]});await page.getByRole('button',{name:'Edit job',exact:true}).click();await page.getByRole('list',{name:'Job setup progress'}).getByRole('button',{name:'Application questions',exact:true}).click();assert.equal(await page.getByLabel('Question 1 requirement',{exact:true}).count(),0);assert.equal(await page.getByLabel('Question 1 answer format',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Remove Résumé / CV',exact:true}).count(),0);assert.equal(await page.locator('.hub-question').first().innerText().then(text=>text.includes('Required')),true);await openQuestion(page,'Managed monthly budget');assert.deepEqual(await page.getByLabel('Question 2 number display',{exact:true}).locator('option').allTextContents(),['Number','Currency (USD)']);await page.getByLabel('Question 2 number display',{exact:true}).selectOption('currency');await page.getByRole('region',{name:'Screening for Managed monthly budget',exact:true}).getByRole('checkbox',{name:'Set a qualifying answer'}).check();const minimum=page.getByLabel('Minimum accepted number for Managed monthly budget',{exact:true});await minimum.fill('30,000');await page.getByRole('heading',{name:prior.title,exact:true}).click();assert.equal(await minimum.inputValue(),'$30,000.00');await page.getByRole('button',{name:'Save changes',exact:true}).first().click();await page.getByText('Changes saved.',{exact:false}).waitFor();const field=writes[0].job.fields.find(f=>f.path==='budget');assert.equal(field.numberFormat,'currency');assert.equal(field.currency,'USD');assert.equal(writes[0].job.rules.find(r=>r.fieldPath==='budget').value,30000);assert.equal(writes[0].job.fields.find(f=>f.path==='_systemfield_resume').required,true);
});
test('changing an existing fractional threshold to currency does not silently round it',async t=>{
 const{page,writes}=await setup(t,{jobs:[{...prior,fields:[...prior.fields,{path:'budget',title:'Budget',type:'Number',required:true}],rules:[{fieldPath:'budget',operator:'gte',value:1.234,enabled:true,reason:'Minimum budget'}]}]});await page.getByRole('button',{name:'Edit job',exact:true}).click();await page.getByRole('list',{name:'Job setup progress'}).getByRole('button',{name:'Application questions',exact:true}).click();await openQuestion(page,'Budget');await page.getByLabel('Question 2 number display',{exact:true}).selectOption('currency');const amount=page.getByLabel('Minimum accepted number for Budget',{exact:true});assert.equal(await amount.inputValue(),'1.234');await page.getByRole('button',{name:'Save changes',exact:true}).first().click();await page.getByText('Enter a number for every numeric screening rule, or remove the unfinished rule in Advanced rules.',{exact:true}).waitFor();assert.equal(writes.length,0);await amount.fill('1.23');await page.getByRole('button',{name:'Save changes',exact:true}).first().click();await page.getByText('Changes saved.',{exact:false}).waitFor();assert.equal(writes[0].job.rules[0].value,1.23);
});

for(const status of ['draft','open'])test(`existing ${status} editor separates saving from section navigation and permits direct jumps`,async t=>{
 const{page,writes}=await setup(t,{jobs:[{...prior,status}]});await page.getByRole('button',{name:'Edit job',exact:true}).click();
 const save=page.getByRole('group',{name:'Job save actions',exact:true}),nav=page.getByRole('navigation',{name:'Job section navigation',exact:true}),steps=page.getByRole('list',{name:'Job setup progress'});
 for(const name of ['Review settings','Application questions','Preview & publish','Job details']){await steps.getByRole('button',{name,exact:true}).click();assert.equal(await save.getByRole('button',{name:'Save changes',exact:true}).count(),1);assert.equal(await nav.getByRole('button',{name:/Save|Publish|Cancel/}).count(),0);assert.equal(await page.getByRole('button',{name:'Save changes',exact:true}).count(),1);}
 assert.equal(await nav.getByRole('button',{name:'Back',exact:true}).isDisabled(),true);assert.equal(writes.length,0);
});
test('jumping a new draft directly to review cannot bypass full publication validation',async t=>{
 const{page,writes}=await setup(t,{jobs:[]});await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('button',{name:'Create blank job',exact:true}).click();
 await page.getByRole('textbox',{name:'Job description',exact:true}).fill('A valid role description');
 const steps=page.getByRole('list',{name:'Job setup progress'});await steps.getByRole('button',{name:'Review settings',exact:true}).click();await steps.getByRole('button',{name:'Preview & publish',exact:true}).click();await page.getByRole('button',{name:'Publish job',exact:true}).click();await page.getByText('Add a job title, then choose a work arrangement and location.',{exact:false}).waitFor();assert.equal(writes.length,0);await page.getByLabel('Job title',{exact:true}).waitFor();
});

async function openQuestion(page,title){const edit=page.getByRole("button",{name:`Edit ${title}`,exact:true});if(await edit.count())await edit.click();const close=page.getByRole("button",{name:`Close ${title}`,exact:true});await close.waitFor();return page.locator(".hub-question").filter({has:close}).first();}

test('question rows start compact, keep one editor open and preserve edits across collapse and reorder',async t=>{
 const {page,writes}=await setup(t,{jobs:[{...prior,fields:[...prior.fields,{path:'years',title:'Years of experience',type:'Number',required:true},{path:'portfolio',title:'Portfolio link',type:'Url',required:false}]}]});
 await page.getByRole('button',{name:'Edit job',exact:true}).click();await page.getByRole('list',{name:'Job setup progress'}).getByRole('button',{name:'Application questions',exact:true}).click();
 assert.equal(await page.locator('.hub-question button[aria-expanded="true"]').count(),0);
 await openQuestion(page,'Years of experience');await page.getByLabel('Question 2 label',{exact:true}).fill('Relevant experience');await page.getByRole('region',{name:'Screening for Relevant experience',exact:true}).getByRole('checkbox',{name:'Set a qualifying answer'}).check();await page.getByLabel('Minimum accepted number for Relevant experience',{exact:true}).fill('7');
 await openQuestion(page,'Portfolio link');assert.equal(await page.locator('.hub-question button[aria-expanded="true"]').count(),1);assert.equal(await page.getByLabel('Minimum accepted number for Relevant experience',{exact:true}).evaluate(e=>e.closest('.hub-question-editor').hidden),true,await page.locator('.hub-question-row-heading').allTextContents());
 await openQuestion(page,'Relevant experience');assert.equal(await page.getByLabel('Minimum accepted number for Relevant experience',{exact:true}).inputValue(),'7');
 await page.getByRole('button',{name:'Move Relevant experience down',exact:true}).click();assert.equal(await page.getByLabel('Question 3 label',{exact:true}).inputValue(),'Relevant experience');assert.equal(await page.getByLabel('Minimum accepted number for Relevant experience',{exact:true}).inputValue(),'7');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('Changes saved.',{exact:false}).waitFor();assert.equal(writes[0].job.fields.filter(f=>!f.path.startsWith('_systemfield')).at(-1).path,'years');assert.equal(writes[0].job.rules.find(r=>r.fieldPath==='years').value,7);
});
test('adding a question opens its editor and hidden invalid questions are revealed on save',async t=>{
 const {page,writes}=await setup(t);await page.getByRole('button',{name:'Edit job',exact:true}).click();const steps=page.getByRole('list',{name:'Job setup progress'});await steps.getByRole('button',{name:'Application questions',exact:true}).click();await addQuestion(page,"custom");await page.getByLabel('Question 2 label',{exact:true}).waitFor();assert.equal(await page.locator('.hub-question button[aria-expanded="true"]').count(),1);const requirement=page.getByLabel('Question 2 requirement',{exact:true});assert.equal(await requirement.inputValue(),'required');await requirement.selectOption('optional');assert.equal(await requirement.inputValue(),'optional');await page.getByLabel('Question 2 label',{exact:true}).fill('');await page.locator('.hub-question button[aria-expanded="true"]').click();await steps.getByRole('button',{name:'Review settings',exact:true}).click();await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByLabel('Question 2 label',{exact:true}).waitFor();assert.equal(await page.locator('.hub-question button[aria-expanded="true"]').count(),1);assert.equal(writes.length,0);
});

for(const existing of [false,true])test(`inherited rejection default is visible without dirtying ${existing?'an existing':'a new'} job`,async t=>{
 const message='Thank you for applying. We will not be moving forward for this role.';const {page,writes}=await setup(t,{jobs:existing?[{...prior,rejectionTemplate:''}]:[],catalog:{revision:0,templates:[],requests:[],locations:{},defaultRejectionTemplate:message}});
 const outgoing=[];page.on('request',request=>{if(request.method()!=='GET')outgoing.push(new URL(request.url()).pathname);});
 if(existing)await page.getByRole('button',{name:'Edit job',exact:true}).click();else{await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('button',{name:'Create blank job',exact:true}).click();}
 await page.getByRole('list',{name:'Job setup progress'}).getByRole('button',{name:'Application questions',exact:true}).click();assert.equal(await page.getByLabel('Rejection email',{exact:true}).isVisible(),false);await page.locator('.hub-rejection-template > summary').click();const email=page.getByLabel('Rejection email',{exact:true});assert.equal(await email.inputValue(),message);await email.focus();await email.blur();assert.equal(await email.inputValue(),message);await email.fill('');await email.blur();assert.equal(await email.inputValue(),message);assert.equal(await page.getByRole('button',{name:'Use default rejection message',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('heading',{name:'Jobs',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);assert.equal(writes.length,0);assert.ok(outgoing.every(path=>!/(mail|messages|tasks|actions)/.test(path)),outgoing.join(','));
});
test('custom rejection text is preserved until explicitly restored to the team default',async t=>{
 const message='Default hiring response.';const {page,writes}=await setup(t,{jobs:[{...prior,rejectionTemplate:'Custom role-specific response.'}],catalog:{revision:0,templates:[],requests:[],locations:{},defaultRejectionTemplate:message}});
 await page.getByRole('button',{name:'Edit job',exact:true}).click();await page.getByRole('list',{name:'Job setup progress'}).getByRole('button',{name:'Application questions',exact:true}).click();assert.equal(await page.getByLabel('Rejection email',{exact:true}).isVisible(),false);await page.locator('.hub-rejection-template > summary').click();const email=page.getByLabel('Rejection email',{exact:true});assert.equal(await email.inputValue(),'Custom role-specific response.');await email.fill('Edited role-specific response.');await page.locator('.hub-rejection-template > summary').click();assert.equal(await email.isVisible(),false);await page.locator('.hub-rejection-template > summary').click();assert.equal(await email.inputValue(),'Edited role-specific response.');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('Changes saved.',{exact:false}).waitFor();assert.equal(writes[0].job.rejectionTemplate,'Edited role-specific response.');
 await page.getByRole('button',{name:'Edit job',exact:true}).click();await page.getByRole('list',{name:'Job setup progress'}).getByRole('button',{name:'Application questions',exact:true}).click();await page.locator('.hub-rejection-template > summary').click();await page.getByRole('button',{name:'Use default rejection message',exact:true}).click();assert.equal(await email.inputValue(),message);await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('Changes saved.',{exact:false}).waitFor();assert.equal(writes[1].job.rejectionTemplate,message);assert.equal(writes[1].job.autoReject,false);
});

test('interrupted job save shows one busy retry and recovers with the identical payload',async t=>{
 const {page}=await setup(t,{jobs:[]});const requests=[];let releaseFirst,releaseSecond,secondStarted;const secondRequest=new Promise(resolve=>secondStarted=resolve);const firstGate=new Promise(resolve=>releaseFirst=resolve),secondGate=new Promise(resolve=>releaseSecond=resolve);t.after(()=>{releaseFirst();releaseSecond();});
 await page.route('**/api/job-setup',async route=>{if(route.request().method()!=='POST')return route.fallback();const input=route.request().postDataJSON();requests.push(input);if(requests.length===1){await firstGate;return route.fulfill({status:502,contentType:'text/html',body:'Synthetic temporary gateway failure'});}secondStarted();await secondGate;return route.fulfill({json:{data:{...input.job,id:'recovered-job'}}});});
 await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('button',{name:'Create blank job',exact:true}).click();await page.getByLabel('Job title',{exact:true}).fill('Retry recovery posting');await page.getByRole('button',{name:'Save draft job',exact:true}).click();await page.getByRole('button',{name:'Saving…',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Saving…',exact:true}).isDisabled(),true);releaseFirst();await page.getByText('Connection interrupted. Retrying save…',{exact:true}).waitFor();await page.getByRole('button',{name:'Saving…',exact:true}).evaluate(button=>button.click());await secondRequest;assert.equal(requests.length,2);assert.deepEqual(requests[1],requests[0]);assert.match(requests[0].creationId,/^[a-f0-9-]{36}$/i);assert.equal(await page.getByRole('button',{name:'Saving…',exact:true}).isDisabled(),true);releaseSecond();await page.getByText('Draft saved.',{exact:false}).waitFor();assert.equal(requests.length,2);assert.equal(await page.getByText('Connection interrupted. Retrying save…',{exact:true}).count(),0);
});
test('job save conflict is surfaced without an automatic retry and retains editor values',async t=>{
 const {page}=await setup(t);await page.clock.install();const requests=[];await page.route('**/api/job-setup',async route=>{if(route.request().method()!=='POST')return route.fallback();requests.push(route.request().postDataJSON());return route.fulfill({status:409,json:{error:{message:'This job changed elsewhere. Refresh before saving.'}}});});
 await page.getByRole('button',{name:'Edit job',exact:true}).click();await page.getByLabel('Job title',{exact:true}).fill('Keep my conflicting edits');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('This job changed elsewhere. Refresh before saving.',{exact:true}).waitFor();await page.clock.fastForward(2500);assert.equal(requests.length,1);assert.equal(await page.getByLabel('Job title',{exact:true}).inputValue(),'Keep my conflicting edits');assert.equal(await page.getByRole('button',{name:'Save changes',exact:true}).isEnabled(),true);assert.equal(await page.getByText('Connection interrupted. Retrying save…',{exact:true}).count(),0);
});

for(const enabled of [false,true])test(`new job defaults screening preference on and saves effective rejection ${enabled}`,async t=>{
 const{page,writes}=await setup(t,{jobs:[]});await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('button',{name:'Create blank job',exact:true}).click();await page.getByLabel('Job title',{exact:true}).fill('Synthetic default screening');
 await page.getByRole('list',{name:'Job setup progress'}).getByRole('button',{name:'Application questions',exact:true}).click();const toggle=page.getByRole('checkbox',{name:'Automatically reject applicants who fail enabled requirements',exact:true});assert.equal(await toggle.isChecked(),true);
 if(enabled){await addQuestion(page,"custom");await page.locator('.hub-question-editor:not([hidden])').getByLabel(/^Question \d+ label$/).fill('Years of experience');await page.locator('.hub-question-editor:not([hidden])').getByLabel(/^Question \d+ answer format$/).selectOption('Number');await page.getByRole('region',{name:'Screening for Years of experience',exact:true}).getByRole('checkbox',{name:'Set a qualifying answer',exact:true}).check();await page.getByLabel('Minimum accepted number for Years of experience',{exact:true}).fill('7');}
 else{await page.getByText('Inactive until you add and save an enabled screening requirement.',{exact:false}).waitFor();await page.getByRole('list',{name:'Job setup progress'}).getByRole('button',{name:'Preview & publish',exact:true}).click();await page.getByText('Inactive — no screening requirements are enabled.',{exact:false}).waitFor();}
 await page.getByRole('button',{name:'Save draft job',exact:true}).click();await page.getByText('Draft saved.',{exact:false}).waitFor();assert.equal(writes.length,1);assert.equal(writes[0].job.autoReject,enabled);assert.equal(writes[0].job.rules.filter(rule=>rule.enabled).length,enabled?1:0);
});
test('restored new private draft preserves an explicitly disabled rejection preference',async t=>{
 const{page,writes}=await setup(t,{jobs:[]});await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('button',{name:'Create blank job',exact:true}).click();await page.getByLabel('Job title',{exact:true}).fill('Recovered screening preference');await page.getByRole('list',{name:'Job setup progress'}).getByRole('button',{name:'Application questions',exact:true}).click();const toggle=page.getByRole('checkbox',{name:'Automatically reject applicants who fail enabled requirements',exact:true});await toggle.uncheck();await page.getByRole('button',{name:'Save progress now',exact:true}).click();await page.getByText(/Draft saved at/).waitFor();await page.reload();await page.getByText(/Saved draft restored/).waitFor();assert.equal(await toggle.isChecked(),false);assert.equal(writes.length,0);
});

test('English preset saves a B2 minimum while keeping a paused job and automatic rejection unchanged',async t=>{
 const{page,writes}=await setup(t,{jobs:[{...prior,status:'closed'}]});await page.getByRole('button',{name:'Edit job',exact:true}).click();await page.getByRole('list',{name:'Job setup progress'}).getByRole('button',{name:'Application questions',exact:true}).click();await addQuestion(page,"english");const minimum=page.getByLabel('Minimum English level',{exact:true});await minimum.waitFor();assert.equal(await minimum.inputValue(),'');await minimum.selectOption('B2');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('Changes saved. This job is still paused.',{exact:false}).waitFor();assert.equal(writes.length,1);const job=writes[0].job;assert.equal(job.status,'closed');assert.equal(job.autoReject,false);const field=job.fields.find(f=>f.path==='english_proficiency_cefr');assert.equal(field.required,true);assert.equal(field.type,'ValueSelect');assert.deepEqual(field.options.map(o=>o.value),['A1','A2','B1','B2','C1','C2']);assert.deepEqual(job.rules.find(r=>r.fieldPath===field.path).value,['B2','C1','C2']);
});

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
    catalogWrites = [];
  await page.route("**/api/hub/jobs", (route) =>
    route.fulfill({ json: { data: jobs } }),
  );
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
        status: 503,
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
  return { page, writes, catalogWrites };
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
  await next(page);
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
  await next(page);
  await page
    .getByText("Office-based jobs need a country and city", { exact: false })
    .waitFor();
  await page.getByLabel("City", { exact: true }).fill("Madrid");
  await page
    .getByLabel("Job description", { exact: true })
    .fill("Approved synthetic responsibilities");
  await next(page);
  await page.getByLabel("Question 1 requirement").selectOption("required");
  await page
    .getByLabel("Add from the question library")
    .selectOption("linkedin_profile");
  await page.getByRole("button", { name: "Add selected question" }).click();
  assert.equal(
    await page.getByLabel("Question 3 requirement").inputValue(),
    "optional",
  );
  await page.getByRole("button", { name: "Add custom question" }).click();
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
  assert.equal(
    await page
      .getByText(
        "Previous applicants remain saved when you duplicate or close a job.",
        { exact: false },
      )
      .count(),
    1,
  );
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
    .getByRole("button", { name: "Unpublish job", exact: true })
    .click();
  await page.getByText("Draft saved.", { exact: false }).waitFor();
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
 await page.goForward();await page.getByRole('heading',{name:'Tell applicants about the job',exact:true}).waitFor();
 // Recovery restores the saved step; later historical steps must be validated again.
 await next(page);await page.getByRole('heading',{name:'What should applicants send?',exact:true}).waitFor();
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

test('invalid step must not enter Publish before validation',async t=>{
 const {page}=await setup(t,{jobs:[]});await page.goto(new URL('/?view=jobs&jobEditor=new&jobStart=blank&jobStep=3',page.url()).href);await page.getByRole('heading',{name:'Tell applicants about the job',exact:true}).waitFor({timeout:2500});
});
test('completed save history never revives a duplicate submission, fresh creation and cancellation still work',async t=>{const{page,writes}=await setup(t,{jobs:[]});await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('button',{name:'Create blank job',exact:true}).click();await page.getByLabel('Job title',{exact:true}).fill('Completed posting');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Save draft job',exact:true}).click();await page.getByText('Draft saved.',{exact:false}).waitFor();await page.goBack();await page.getByRole('heading',{name:'Jobs',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.has('jobEditor'),false);assert.equal(writes.length,1);await page.goForward();await page.getByRole('heading',{name:'Jobs',exact:true}).waitFor();await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('button',{name:'Create blank job',exact:true}).click();assert.equal(await page.getByLabel('Job title',{exact:true}).inputValue(),'');await page.getByLabel('Job title',{exact:true}).fill('Fresh cancelled draft');await page.getByRole('button',{name:'Back to jobs',exact:true}).click();await page.getByRole('button',{name:'Save draft & leave',exact:true}).click();await page.getByRole('heading',{name:'Jobs',exact:true}).waitFor();await page.goBack();await page.getByText(/Saved draft restored/).waitFor();assert.equal(await page.getByLabel('Job title',{exact:true}).inputValue(),'Fresh cancelled draft');assert.equal(writes.length,1);});
test('fractional and nonfinite direct wizard steps normalize to validated Details',async t=>{const{page}=await setup(t,{jobs:[]});for(const step of ['1.5','Infinity','NaN','-2','999']){await page.goto(new URL('/?view=jobs&jobEditor=new&jobStart=blank&jobStep='+step,page.url()).href);await page.getByRole('heading',{name:'Tell applicants about the job',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('jobStep'),'0');}});
test('pending save must not close a newly chosen template in the same chooser history',async t=>{const{page}=await setup(t);let release;const held=new Promise(resolve=>release=resolve);t.after(()=>release());await page.route('**/api/job-setup',async route=>{if(route.request().method()!=='POST')return route.fallback();await held;return route.fulfill({json:{data:{id:'saved-first',...route.request().postDataJSON().job}}});});await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('button',{name:'Create blank job',exact:true}).click();await page.getByLabel('Job title',{exact:true}).fill('First pending draft');const req=page.waitForRequest(r=>r.method()==='POST');await page.getByRole('button',{name:'Save draft job',exact:true}).click();await req;await page.goBack();await page.getByRole('button',{name:'Save draft & leave',exact:true}).click();await page.getByRole('heading',{name:'Create a job',exact:true}).waitFor();await page.getByRole('button',{name:'Choose template',exact:true}).click();await page.getByLabel('Job template',{exact:true}).selectOption(savedTemplate.id);await page.getByRole('button',{name:'Use this template',exact:true}).click();await page.getByLabel('Job title',{exact:true}).fill('Second template draft');release();await page.waitForResponse(r=>r.request().method()==='POST');await page.waitForTimeout(200);assert.equal(await page.getByLabel('Job title',{exact:true}).count(),1);assert.equal(await page.getByLabel('Job title',{exact:true}).inputValue(),'Second template draft');});

test("published job sections can be opened directly without Continue or saving", async (t) => {
  const { page, writes } = await setup(t);
  await page.getByRole("button", { name: "Edit job", exact: true }).click();
  const steps = page.getByRole("list", { name: "Job setup progress" });
  await steps.getByRole("button", { name: "Application questions", exact: true }).click();
  await page.getByRole("heading", { name: "What should applicants send?", exact: true }).waitFor();
  await steps.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("button", { name: "Unpublish job", exact: true }).waitFor();
  await steps.getByRole("button", { name: "Job details", exact: true }).click();
  await page.getByRole("heading", { name: "Tell applicants about the job", exact: true }).waitFor();
  await page.goBack();
  await page.getByRole("button", { name: "Unpublish job", exact: true }).waitFor();
  assert.equal(writes.length, 0);
});

test("contact fields are fixed and remaining application questions can be reordered", async (t) => {
 const {page}=await setup(t,{jobs:[{...prior,fields:[...prior.fields,{path:"portfolio",title:"Portfolio",type:"Url",required:false}]}]});
 await page.getByRole('button',{name:'Edit job',exact:true}).click();
 await page.getByRole('list',{name:'Job setup progress'}).getByRole('button',{name:'Application questions',exact:true}).click();
 const questions=page.locator('.hub-question');
 assert.match(await page.locator('.hub-required-contacts').innerText(),/First name · Last name · Email · Phone number/);
 assert.equal(await questions.locator('.hub-question-heading > strong').getByText('Phone number',{exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Remove Phone number',exact:true}).count(),0);
 const down=page.getByRole('button',{name:/^Move .* down$/}).first();
 assert.equal(await down.isEnabled(),true);
 {
  const before=await questions.locator('.hub-question-heading > strong').allTextContents();
  await down.click();
  const after=await questions.locator('.hub-question-heading > strong').allTextContents();
  assert.equal(after[0],before[1]); assert.equal(after[1],before[0]);
 }
});

test("question instructions are collapsed by default and publish needs no approval checklist", async (t) => {
 const {page,writes}=await setup(t,{jobs:[{...prior,fields:[...prior.fields,{path:'portfolio',title:'Portfolio',type:'Url',required:false,description:'Existing helper text'}]}]});
 await page.getByRole('button',{name:'Edit job',exact:true}).click();const steps=page.getByRole('list',{name:'Job setup progress'});await steps.getByRole('button',{name:'Application questions',exact:true}).click();
 const instructions=page.getByLabel('Question 2 instructions (optional)',{exact:true});assert.equal(await instructions.isVisible(),false);
 await page.getByText('Edit instructions (optional)',{exact:true}).click();assert.equal(await instructions.inputValue(),'Existing helper text');await instructions.fill('Updated helper text');
 await steps.getByRole('button',{name:'Review setup',exact:true}).click();assert.equal(await page.getByRole('checkbox',{name:/Rank applicants with AI/}).isChecked(),false);
 await steps.getByRole('button',{name:'Publish',exact:true}).click();assert.equal(await page.getByRole('checkbox',{name:/I have reviewed|I approve/}).count(),0);
 if(process.env.JOB_WIZARD_SCREENSHOT)await page.screenshot({path:process.env.JOB_WIZARD_SCREENSHOT,fullPage:true});
 await page.getByRole('button',{name:'Save published job',exact:true}).click();await page.getByText('Job published.',{exact:false}).waitFor();assert.equal(writes.length,1);assert.equal(writes[0].job.fields.find(field=>field.path==='portfolio').description,'Updated helper text');assert.equal(writes[0].job.aiMatchEnabled,false);assert.equal(writes[0].job.autoReject,false);
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
 assert.deepEqual(await progress.getByRole('button').allTextContents(),['Job details','Application questions','Review setup','Publish']);
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

test("Actions closes with Escape and Posting status opens the existing job without changing it", async t => {
 const {page,writes}=await setup(t);
 const menu=page.getByLabel(`Actions for ${prior.title}`,{exact:true});
 await menu.click();
 await page.getByRole('button',{name:'Posting status',exact:true}).focus();
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('.hub-job-menu').getAttribute('open'),null);
 assert.equal(await menu.evaluate(element=>element===document.activeElement),true);
 await menu.click();
 await page.getByRole('button',{name:'Posting status',exact:true}).click();
 await page.getByRole('heading',{name:'Ready to share?',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Save published job',exact:true}).isVisible(),true);
 assert.equal(await page.getByRole('button',{name:'Close job',exact:true}).isVisible(),true);
 assert.equal(writes.length,0);
});

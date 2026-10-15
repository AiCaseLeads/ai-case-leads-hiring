import {installDraftFixture} from "./draft-ui-fixture.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { build } from "esbuild";
import { chromium } from "playwright";
const prior = {
  id: "existing-job",
  title: "Creative Strategist",
  slug: "creative-strategist-spain",
  department: "Creative",
  location: "Spain — approved location",
  status: "draft",
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
    holdJobSave = null,
  } = {},
) {
  const { outputFiles } = await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{Jobs}from'./components/hub/jobs';import{CareerDetail}from'./components/careers/experience';createRoot(document.getElementById('root')).render(location.search.includes('public')?<CareerDetail slug='creative-strategist-spain'/>:<Jobs admin refresh={0} changed={()=>{}} startCreating={${startCreating}}/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
  });
  const css=(await postcss([tailwind()]).process(readFileSync("app/globals.css","utf8"),{from:"app/globals.css"})).css+"\n"+readFileSync("components/hub/hub.css","utf8");
  const server = createServer((req, res) => {
    res.setHeader(
      "Content-Type",
      req.url === "/bundle.js" ? "text/javascript" : req.url === "/style.css" ? "text/css" : "text/html",
    );
    res.end(
      req.url === "/bundle.js"
        ? outputFiles[0].text
        : req.url === "/style.css" ? css : '<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><div class="hiring-hub"><aside class="hub-sidebar"><strong>Hiring workspace</strong><nav>Jobs</nav></aside><main class="hub-main"><div id="root"></div></main></div><script src="/bundle.js"></script>',
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
  page.setDefaultTimeout(5000);
  await page.route("**/api/hub/jobs", (route) =>
    route.fulfill({ json: { data: jobs } }),
  );
  await page.route("**/api/jobs/*", route=>route.fulfill({json:{job:jobs[0],fields:[],submissionEnabled:false}}));
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
    if(holdJobSave)await holdJobSave;
    if (failFirst && writes.length === 1)
      return route.fulfill({
        status: 503,
        json: {
          error: {
            message: "Temporary save failure. Your draft is still here.",
          },
        },
      });
    jobs = jobs.map(job=>job.id===input.jobId?{...job,...input.job}:job);
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

async function edit(page) {
 await page.getByRole('button',{name:'Edit job',exact:true}).click();
 return page.getByRole('textbox',{name:'Job description',exact:true});
}
async function selectAll(page,box){await box.focus();await page.keyboard.press('ControlOrMeta+A');}
const screeningFields = [...prior.fields, {path:'years',title:'Years of experience',type:'Number',required:true}, {path:'briefs',title:'Creative briefs',type:'Number',required:true}, {path:'available',title:'Available for interviews',type:'Boolean',required:true}];
const screenedJob={...prior,fields:screeningFields};
async function questions(page){await edit(page);await next(page);await page.getByRole('heading',{name:'What should applicants send?'}).waitFor();}
const autoLabel='Automatically reject applicants who fail enabled requirements';
const approvalLabel='I approve these requirements and the rejection email for automatic decisions.';
async function enable(page,title){await page.getByRole('region',{name:`Screening for ${title}`,exact:true}).getByRole('checkbox',{name:'Set a qualifying answer'}).check();}
async function save(page){await page.getByRole('button',{name:'Save draft job',exact:true}).click();}
test('AI review is simple by default, preserves manual bindings and saves explicit opt-in',async t=>{
 const {page,writes}=await setup(t);await edit(page);await next(page);await next(page);
 await page.getByRole('heading',{name:'Find the strongest matches for this job'}).waitFor();
 assert.equal(await page.getByLabel('Review scorecard',{exact:true}).isVisible(),false);
 await page.getByRole('checkbox',{name:'Use AI to score and rank applicants for this job'}).check();
 await save(page);assert.equal(writes[0].job.aiMatchEnabled,true);assert.deepEqual(writes[0].scorecard,scores.bindings[prior.id]);
});
test('collapsed scorecard fields do not create blank scroll space at mobile or desktop widths',async t=>{
 const {page}=await setup(t);await edit(page);await next(page);await next(page);
 const outer=page.getByText('Optional: manual reviewer scorecard',{exact:true});await outer.click();
 await page.getByLabel('Review scorecard',{exact:true}).selectOption('new');
 for(const width of [320,390,768,1280]){
  await page.setViewportSize({width,height:900});
  for(const expanded of [false,true,false]){
   const details=page.getByText('Customize weight and rating descriptions',{exact:true});
   if(await details.evaluate(e=>e.parentElement.open)!==expanded)await details.click();
   const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,hubBottom:document.querySelector('.hiring-hub').getBoundingClientRect().bottom+scrollY,closed:[...document.querySelectorAll('.hiring-hub details:not([open]) > :not(summary)')].map(e=>({display:getComputedStyle(e).display,height:e.getBoundingClientRect().height}))}));
   assert.ok(metrics.scroll<=width+1,JSON.stringify(metrics));assert.ok(metrics.height-metrics.hubBottom<=1,JSON.stringify(metrics));
   for(const item of metrics.closed){assert.equal(item.display,'none');assert.equal(item.height,0);}
  }
 }
 await outer.click();assert.equal(await page.getByLabel('Scorecard name',{exact:true}).isVisible(),false);
});

test('all job wizard steps contain long descriptions, question labels and navigation on narrow screens',async t=>{
 const longJob={...screenedJob,title:'Creative Strategist for International Marketing and Creative Production',descriptionHtml:'<p>'+('Detailed responsibilities and qualifications. '.repeat(100))+'</p>',fields:screeningFields.map(f=>f.path==='years'?{...f,title:'DescribeYourRelevantExperience'.repeat(5)}:f)};
 const {page}=await setup(t,{jobs:[longJob]});
 for(const width of [320,390,768,1280,1728]){
  await page.setViewportSize({width,height:900});await edit(page);
  for(let step=0;step<4;step++){
   if(step===3)await page.getByText('Preview description',{exact:true}).click();
   const m=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,outside:[...document.querySelectorAll('.hub-main button,.hub-main input,.hub-main select,.hub-main textarea,[contenteditable=true]')].filter(e=>e.getClientRects().length).filter(e=>{const r=e.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1;}).map(e=>e.tagName+':'+e.textContent.slice(0,60))}));
   assert.ok(m.scroll<=width+1,`step ${step} at ${width}: ${JSON.stringify(m)}`);assert.deepEqual(m.outside,[],`step ${step} at ${width}`);
   if(step<3)await next(page);
  }
  await page.getByRole('heading',{name:'Ready to share?',exact:true}).waitFor();
  await page.getByRole('button',{name:'Back to jobs',exact:true}).click();
 }
});

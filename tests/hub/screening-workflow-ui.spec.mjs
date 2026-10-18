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
test('numeric and yes/no qualifying values persist with one intentional automatic rejection toggle',async t=>{
 const {page,writes}=await setup(t,{jobs:[screenedJob]});await questions(page);
 await enable(page,'Years of experience');await page.getByLabel('Minimum accepted number for Years of experience',{exact:true}).fill('7');
 await enable(page,'Creative briefs');await page.getByLabel('Minimum accepted number for Creative briefs',{exact:true}).fill('20');
 await enable(page,'Available for interviews');await page.getByLabel('Qualifying answer for Available for interviews',{exact:true}).selectOption('false');
 await page.getByRole('checkbox',{name:autoLabel,exact:true}).check();
 assert.equal(await page.getByRole('checkbox',{name:approvalLabel,exact:true}).count(),0);
 await page.getByLabel('Minimum accepted number for Creative briefs',{exact:true}).fill('21');
 await save(page);await page.getByText('Draft saved.',{exact:false}).waitFor();
 assert.deepEqual(writes[0].job.rules.map(({fieldPath,operator,value,enabled})=>({fieldPath,operator,value,enabled})),[{fieldPath:'years',operator:'gte',value:7,enabled:true},{fieldPath:'briefs',operator:'gte',value:21,enabled:true},{fieldPath:'available',operator:'equals',value:false,enabled:true}]);assert.equal(writes[0].job.autoReject,true);
 await page.reload();await questions(page);assert.equal(await page.getByLabel('Minimum accepted number for Years of experience',{exact:true}).inputValue(),'7');assert.equal(await page.getByLabel('Qualifying answer for Available for interviews',{exact:true}).inputValue(),'false');
 await page.getByLabel('Qualifying answer for Available for interviews',{exact:true}).selectOption('true');await page.getByRole('button',{name:'Save draft job',exact:true}).click();await page.getByText('Draft saved.',{exact:false}).waitFor();assert.equal(writes[1].job.rules.find(r=>r.fieldPath==='available').value,true);
});
test('cleared minimum never becomes zero and rules must be explicitly removed before format changes',async t=>{
 const {page,writes}=await setup(t,{jobs:[screenedJob]});await questions(page);await enable(page,'Years of experience');const minimum=page.getByLabel('Minimum accepted number for Years of experience',{exact:true});await minimum.fill('7');await minimum.fill('');await save(page);await page.getByText('Enter a number for every numeric screening rule, or remove the unfinished rule in Advanced rules.',{exact:true}).waitFor();assert.equal(writes.length,0);assert.equal(await minimum.inputValue(),'');
 const format=page.getByLabel('Question 2 answer format',{exact:true});assert.equal(await format.isDisabled(),true);await page.getByText('Advanced rules (1)',{exact:true}).click();await page.getByRole('button',{name:'Remove requirement',exact:true}).click();assert.equal(await format.isDisabled(),false);await format.selectOption('Boolean');await enable(page,'Years of experience');assert.equal(await page.getByLabel('Qualifying answer for Years of experience',{exact:true}).inputValue(),'true');
});
test('optional screening explains missing answers and disabled rule survives reopening',async t=>{
 const job={...screenedJob,fields:screeningFields.map(f=>f.path==='years'?{...f,required:false}:f),rules:[{fieldPath:'years',operator:'gte',value:7,enabled:true,reason:'Experience'}]};const {page,writes}=await setup(t,{jobs:[job]});await questions(page);await page.getByText(/This question is optional: a missing answer goes to human review/).waitFor();await page.getByRole('region',{name:'Screening for Years of experience',exact:true}).getByRole('checkbox',{name:'Set a qualifying answer'}).uncheck();await save(page);await page.getByText('Draft saved.',{exact:false}).waitFor();assert.equal(writes[0].job.rules[0].enabled,false);await page.reload();await questions(page);assert.equal(await page.getByRole('region',{name:'Screening for Years of experience',exact:true}).getByRole('checkbox',{name:'Set a qualifying answer'}).isChecked(),false);
});
test('footer never overlaps content and screening controls fit desktop/tablet/phone',async t=>{
 const {page}=await setup(t,{jobs:[screenedJob]});await edit(page);assert.equal(await page.getByRole('button',{name:'Back',exact:true}).count(),0);await next(page);await enable(page,'Years of experience');await page.getByLabel('Minimum accepted number for Years of experience',{exact:true}).fill('7');
 for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});const metrics=await page.evaluate(()=>{const footer=document.querySelector('.hub-sticky-save'),r=footer.getBoundingClientRect();return{width:innerWidth,scroll:document.documentElement.scrollWidth,position:getComputedStyle(footer).position,top:r.top,previousBottom:footer.previousElementSibling.getBoundingClientRect().bottom,offenders:[...document.querySelectorAll('.hub-sticky-save button,.hub-screening-question input,.hub-screening-question select')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&(b.left<0||b.right>innerWidth+1)}).map(e=>e.textContent),buttons:[...footer.querySelectorAll('button')].map(e=>({wordBreak:getComputedStyle(e).wordBreak,height:e.getBoundingClientRect().height}))}});assert.ok(metrics.scroll<=width+1,JSON.stringify(metrics));assert.equal(metrics.position,'static');assert.ok(metrics.top>=metrics.previousBottom-1,JSON.stringify(metrics));assert.deepEqual(metrics.offenders,[]);for(const b of metrics.buttons){assert.ok(b.height>=44);assert.notEqual(b.wordBreak,'break-all');}}
});

test('new qualifying answers become required and turning off an unfinished minimum permits saving',async t=>{
 const job={...screenedJob,fields:screeningFields.map(f=>f.path==='years'?{...f,required:false}:f)};const {page,writes}=await setup(t,{jobs:[job]});await questions(page);const requirement=page.getByLabel('Question 2 requirement',{exact:true});assert.equal(await requirement.inputValue(),'optional');await enable(page,'Years of experience');assert.equal(await requirement.inputValue(),'required');assert.equal(await requirement.isDisabled(),true);await page.getByRole('region',{name:'Screening for Years of experience',exact:true}).getByRole('checkbox',{name:'Set a qualifying answer'}).uncheck();assert.equal(await requirement.isDisabled(),false);await save(page);await page.getByText('Draft saved.',{exact:false}).waitFor();assert.deepEqual(writes[0].job.rules,[]);assert.equal(writes[0].job.autoReject,false);
});
test('legacy optional screening can become required and a blank minimum blocks Continue',async t=>{
 const job={...screenedJob,fields:screeningFields.map(f=>f.path==='years'?{...f,required:false}:f),rules:[{fieldPath:'years',operator:'gte',value:7,enabled:true,reason:'Experience'}]};const {page,writes}=await setup(t,{jobs:[job]});await questions(page);
 const requirement=page.getByLabel('Question 2 requirement',{exact:true});assert.equal(await requirement.inputValue(),'optional');assert.equal(await requirement.isDisabled(),false);await requirement.selectOption('required');assert.equal(await requirement.inputValue(),'required');
 await page.getByLabel('Minimum accepted number for Years of experience',{exact:true}).fill('');await next(page);await page.getByText('Enter a number for every numeric screening rule, or remove the unfinished rule in Advanced rules.',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'What should applicants send?'}).isVisible(),true);assert.equal(await page.getByRole('heading',{name:'Find the strongest matches for this job'}).count(),0);assert.equal(writes.length,0);
 await page.getByLabel('Minimum accepted number for Years of experience',{exact:true}).fill('7');await next(page);await page.getByRole('heading',{name:'Find the strongest matches for this job'}).waitFor();
});

test('country preset creates full choices, saves selected eligibility, and reopens without manual option editing',async t=>{
 const {page,writes}=await setup(t,{jobs:[structuredClone(prior)]});await questions(page);
 await page.getByRole('button',{name:'Add country of residence question',exact:true}).click();
 const country=page.locator('.hub-question').filter({has:page.getByRole('region',{name:'Country of residence screening',exact:true})});
 assert.equal(await country.count(),1);assert.equal(await country.locator('textarea').count(),1); // optional instructions only; no manual choices editor
 assert.equal(await page.getByRole('button',{name:'Add country of residence question',exact:true}).isDisabled(),true);
 await page.getByLabel('Eligible countries',{exact:true}).selectOption('in');
 await page.getByLabel('Find countries',{exact:true}).fill('Spain');await page.getByLabel('Spain',{exact:true}).check();
 await page.getByLabel('Find countries',{exact:true}).fill('United States');await page.getByLabel('United States',{exact:true}).check();
 await page.getByRole('checkbox',{name:autoLabel,exact:true}).check();await save(page);await page.getByText('Draft saved.',{exact:false}).waitFor();
 const field=writes[0].job.fields.find(field=>field.path==='country_of_residence');assert.equal(field.type,'ValueSelect');assert.equal(field.options.length,249);assert.equal(field.required,true);assert.deepEqual(writes[0].job.rules.find(rule=>rule.fieldPath===field.path).value,['ES','US']);assert.equal(writes[0].job.autoReject,true);
 await page.reload();await questions(page);assert.equal(await page.getByLabel('Eligible countries',{exact:true}).inputValue(),'in');await page.getByLabel('Find countries',{exact:true}).fill('Spain');assert.equal(await page.getByLabel('Spain',{exact:true}).isChecked(),true);
 await page.getByLabel('Eligible countries',{exact:true}).selectOption('not_in');await save(page);await page.getByText('Draft saved.',{exact:false}).waitFor();assert.equal(writes[1].job.rules.find(rule=>rule.fieldPath===field.path).operator,'not_in');assert.equal(writes[1].job.fields.find(item=>item.path===field.path).options.length,249);
});

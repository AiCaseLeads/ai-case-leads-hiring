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
        : req.url === "/style.css" ? css : '<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><div class="hiring-hub"><main class="hub-main"><div id="root"></div></main></div><script src="/bundle.js"></script>',
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
 await page.getByRole('link',{name:'Edit job',exact:true}).click();
 return page.getByRole('textbox',{name:'Job description',exact:true});
}
async function selectAll(page,box){await box.focus();await page.keyboard.press('ControlOrMeta+A');}
test('formatted job survives save, edit, duplicate and applicant preview without exposing markup',async t=>{
 const html='<h2>Responsibilities &amp; impact</h2><p>Build <strong>great</strong> things.</p><ol><li>Review work</li><li>Share results</li></ol><ul><li>Collaborate</li></ul>';
 const {page,writes}=await setup(t,{jobs:[{...prior,descriptionHtml:html}]});
 const box=await edit(page);
 assert.equal(await box.locator('strong').textContent(),'great');assert.equal(await box.locator('ol li').count(),2);
 await page.getByRole('button',{name:'Preview',exact:true}).click();
 const preview=page.getByLabel('Job description preview',{exact:true});
 assert.equal(await preview.locator('strong').textContent(),'great');assert.equal(await preview.locator('ol li').count(),2);
 await page.getByRole('button',{name:'Back to editing',exact:true}).click();
 await box.press('End');await page.keyboard.type(' Updated');
 await page.getByRole('button',{name:'Save draft job',exact:true}).click();
 await page.getByText('Draft saved.',{exact:false}).waitFor();
 assert.match(writes[0].job.descriptionHtml,/Updated/);assert.match(writes[0].job.descriptionHtml,/<strong>great<\/strong>/);
 await page.reload();await edit(page);assert.equal(await page.getByRole('textbox',{name:'Job description',exact:true}).locator('ol li').count(),2);
 await page.getByRole('button',{name:'Back to jobs',exact:true}).click();
 await page.getByLabel(`Actions for ${prior.title}`,{exact:true}).click();await page.getByRole('button',{name:'Duplicate job',exact:true}).click();
 assert.equal(await page.getByRole('textbox',{name:'Job description',exact:true}).locator('strong').textContent(),'great');
 await page.goto(new URL('/?public=1',page.url()).href);await page.getByRole('heading',{name:prior.title,exact:true}).waitFor();
 assert.equal(await page.locator('.job-description strong').textContent(),'great');assert.equal(await page.locator('.job-description ol li').count(),2);assert.match(await page.locator('.job-description').innerText(),/Updated/);
});
test('keyboard formatting and numbered/bulleted lists are real markup, spacing cleanup has undo',async t=>{
 const {page}=await setup(t);const box=await edit(page);
 await box.fill('Meaningful responsibility');await selectAll(page,box);
 await page.getByRole('button',{name:'Bold',exact:true}).focus();await page.keyboard.press('Enter');
 assert.equal(await box.locator('b,strong').textContent(),'Meaningful responsibility');
 await page.getByRole('button',{name:'Numbered list',exact:true}).click();assert.equal(await box.locator('ol li').count(),1);
 await page.getByRole('button',{name:'Bulleted list',exact:true}).click();assert.equal(await box.locator('ul li').count(),1);
 await box.fill('Several    spaces');
 await page.getByRole('button',{name:'Clean up spacing',exact:true}).click();assert.equal((await box.innerText()).trim(),'Several spaces');
 await page.getByRole('button',{name:'Undo',exact:true}).click();assert.match(await box.innerText(),/Several[ \u00a0]{4}spaces/);
});
test('paste discards unsafe HTML and preview never creates executable elements',async t=>{
 const unsafe='<p onclick="window.hacked=1">Safe <strong>bold</strong></p><img src=x onerror="window.hacked=1"><script>window.hacked=1</script><svg onload="window.hacked=1"></svg>';
 const {page}=await setup(t,{jobs:[{...prior,descriptionHtml:unsafe}]});const box=await edit(page);
 assert.equal(await box.locator('img,script,svg,[onclick]').count(),0);assert.equal(await page.evaluate(()=>window.hacked),undefined);
 await box.fill('');await box.focus();
 await box.evaluate(el=>{const data=new DataTransfer();data.setData('text/plain','Pasted responsibilities\nSecond line');data.setData('text/html','<img src=x onerror="window.hacked=1"><b>Unexpected HTML</b>');el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
 assert.match(await box.innerText(),/Pasted responsibilities/);assert.equal(await box.locator('img,b').count(),0);
 await page.getByRole('button',{name:'Preview',exact:true}).click();assert.match(await page.getByLabel('Job description preview').innerText(),/Second line/);
 assert.equal(await page.evaluate(()=>window.hacked),undefined);
});
test('cleanup preserves spaces around bold text and legacy paragraphs remain visible',async t=>{
 const {page}=await setup(t,{jobs:[{...prior,descriptionHtml:'<p>Build   <strong>great</strong>   things.</p><p><br></p><p>Second paragraph.</p>'}]});const box=await edit(page);
 await page.getByRole('button',{name:'Clean up spacing',exact:true}).click();
 assert.match(await box.innerText(),/Build great things\./);
 await page.getByRole('button',{name:'Preview',exact:true}).click();assert.match(await page.getByLabel('Job description preview').innerText(),/Build great things\./);
});
test('toolbar and long pasted text fit phone/tablet/desktop without clipping controls',async t=>{
 const {page}=await setup(t,{jobs:[{...prior,descriptionHtml:'<p>'+ 'LongUnbrokenWord'.repeat(50)+'</p>'}]});await edit(page);
 for(const width of [320,390,768,1280]){
 await page.setViewportSize({width,height:900});
 const result=await page.evaluate(()=>({w:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('.description-editor button,.description-editable')].filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1||r.left<0;}).map(e=>e.textContent)}));
 assert.ok(result.scroll<=result.w+1,JSON.stringify(result));assert.deepEqual(result.offenders,[]);
 }
});
test('HTML drop becomes plain text and legacy line breaks survive preview',async t=>{
 const {page}=await setup(t,{jobs:[{...prior,descriptionHtml:'First paragraph\n\nSecond paragraph & benefits'}]});const box=await edit(page);
 assert.equal(await box.evaluate(el=>getComputedStyle(el).whiteSpace),'pre-wrap');
 await page.getByRole('button',{name:'Preview',exact:true}).click();assert.match(await page.getByLabel('Job description preview').innerText(),/First paragraph\n\nSecond paragraph & benefits/);
 await page.getByRole('button',{name:'Back to editing',exact:true}).click();await box.fill('');await box.focus();
 await box.evaluate(el=>{const data=new DataTransfer();data.setData('text/plain','Dropped text');data.setData('text/html','<img src=x onerror="window.hacked=1"><iframe srcdoc="bad"></iframe>');el.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));});
 assert.equal(await box.innerText(),'Dropped text');assert.equal(await box.locator('img,iframe').count(),0);assert.equal(await page.evaluate(()=>window.hacked),undefined);
});
test('deleting all content can be undone without losing the draft',async t=>{
 const {page}=await setup(t);const box=await edit(page);
 await box.fill('Keep this draft');await selectAll(page,box);await page.keyboard.press('Backspace');
 assert.equal((await box.innerText()).trim(),'');await page.getByRole('button',{name:'Undo',exact:true}).click();
 assert.equal((await box.innerText()).trim(),'Keep this draft');
});

test('pending job save locks the editor and formatting until the request completes',async t=>{
 let release;const held=new Promise(resolve=>release=resolve);t.after(()=>release());
 const {page}=await setup(t,{holdJobSave:held});const box=await edit(page);
 const requested=page.waitForRequest(r=>r.method()==='POST');await page.getByRole('button',{name:'Save draft job',exact:true}).click();await requested;
 assert.equal(await box.getAttribute('contenteditable'),'false');assert.equal(await page.getByRole('button',{name:'Bold',exact:true}).isDisabled(),true);
 release();await page.getByText('Draft saved.',{exact:false}).waitFor();
});
test('cleaning formatted numbered paragraphs removes empty numbered rows and Undo restores them',async t=>{
 const {page}=await setup(t);const box=await edit(page);
 await box.fill('Clear   responsibilities\n\nApproved   requirements\n\nHow   to   apply');
 await selectAll(page,box);await page.getByRole('button',{name:'Bold',exact:true}).click();
 await page.getByRole('button',{name:'Numbered list',exact:true}).click();
 assert.equal(await box.locator('ol > li').count(),5);
 await page.getByRole('button',{name:'Clean up spacing',exact:true}).click();
 assert.deepEqual(await box.locator('ol > li').allTextContents(),['Clear responsibilities','Approved requirements','How to apply']);
 assert.equal(await box.locator('ol > li').count(),3);
 await page.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await box.locator('ol > li').count(),5);
});

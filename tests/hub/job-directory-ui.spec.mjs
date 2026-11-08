import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('role organization and public country selection remain operable on narrow and wide screens',async t=>{
  const india={id:"posting-in",slug:"buyer-india",title:"Buyer — India",location:"Remote · India",department:"Marketing",status:"open",fields:[],rules:[]};
  const pk={...india,id:"posting-pk",slug:"buyer-pakistan",title:"Buyer — Pakistan",location:"Remote · Pakistan"};
  const worldwide={...india,id:"posting-ww",slug:"lead",title:"Media Lead",location:"Remote · Worldwide",eligibleCountries:"worldwide"};
  const jobs=[india,pk,worldwide];
  const {outputFiles}=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {Jobs} from './components/hub/jobs';import {CareersHome} from './components/careers/experience';
    createRoot(document.querySelector('main')).render(location.pathname==='/public'?<CareersHome/>:<Jobs admin refresh={0} changed={()=>{}}/>);
  `},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty'}});
  const css=(await Promise.all(['app/globals.css','components/hub/hub.css','components/hub/workspace-v3.css','components/hub/workspace-surfaces.css','components/hub/job-directory.css'].map(path=>readFile(path,'utf8')))).join('\n').replace(/^@import[^;]*;/gm,'');
  const server=createServer((req,res)=>{
    if(req.url==='/script.js'){res.setHeader('content-type','text/javascript; charset=utf-8');res.end(outputFiles[0].text);return;}
    res.setHeader('content-type','text/html');res.end('<meta charset=utf-8><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}'+css+'</style><main data-hiring-workspace></main><script src="/script.js"></script>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await new Promise(r=>server.close(r));});
  for (const width of [320,1280]) {
    const page=await browser.newPage({viewport:{width,height:850}});
    page.setDefaultTimeout(6000);
    const url='http://127.0.0.1:'+server.address().port;
    let catalog={revision:0,groups:[]};const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path==='/api/jobs'){await route.fulfill({json:{jobs,submissionEnabled:true,mode:'live'}});return;}
      if(path==='/api/hub/job-groups' && route.request().method()==='POST'){
        const {name,kind,jobIds,id,expectedRevision,action}=route.request().postDataJSON();
        assert.equal(catalog.revision,expectedRevision);
        catalog={revision:catalog.revision+1,groups:catalog.groups.filter(g=>g.id!==id)};
        if(action==='save')catalog.groups.push({id:id||'00000000-0000-4000-8000-000000000001',kind,name,jobIds,revision:catalog.revision});
      }
      const data=path==='/api/hub/job-groups'?catalog:path==='/api/hub/jobs'?jobs:path==='/api/hub/application-counts'?{items:[{jobId:india.id,total:2},{jobId:pk.id,total:3}]}:path==='/api/job-drafts'?[]:{revision:1,templates:[],requests:[],rubrics:[],locations:{}};
      await route.fulfill({json:{data}});
    });
    await page.goto(url+'/jobs');
    await page.getByRole('button',{name:'Organize postings'}).click();
    await page.getByText('Suggested role groups (1)').click();
    await page.getByRole('button',{name:'Review group'}).click();
    assert.equal(await page.getByLabel('Role group name').inputValue(),'Buyer');
    await page.getByRole('button',{name:'Save group'}).click();
    const group=page.locator('.role-family');
    await group.getByRole('link',{name:'View all applicants for Buyer'}).waitFor();
    assert.match(await group.getByRole('link').first().innerText(),/5 applicants/);
    assert.match(await group.getByRole('link').first().getAttribute('href'),/active=false&jobGroupId=/);
    await group.locator('summary').first().click();
    await group.getByRole('link',{name:'View applicants for Buyer — India'}).waitFor();
    if(process.env.HIRING_REDESIGN_IMAGES) await page.screenshot({path:process.env.HIRING_REDESIGN_IMAGES+'/jobs-'+width+'.png',fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.getByRole('button',{name:'Organize postings'}).click();
    await page.getByRole('button',{name:'Buyer',exact:true}).click();
    await page.getByLabel('Role group name').fill('Paid media');
    await page.getByRole('button',{name:'Save group'}).click();
    await page.getByRole('link',{name:'View all applicants for Paid media'}).waitFor();
    await page.goto(url+'/public');
    await page.getByRole('link',{name:'Buyer — India',exact:true}).waitFor();
    await page.getByLabel('Where do you live?').selectOption('PK');
    await page.getByRole('link',{name:'Buyer — India',exact:true}).waitFor({state:'hidden'});
    assert.equal(await page.getByRole('link',{name:'Buyer — Pakistan',exact:true}).isVisible(),true);
    assert.equal(await page.getByRole('link',{name:'Media Lead',exact:true}).isVisible(),true);
    if(process.env.HIRING_REDESIGN_IMAGES) await page.locator('#positions').screenshot({path:process.env.HIRING_REDESIGN_IMAGES+'/country-'+width+'.png'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    assert.deepEqual(errors,[]);
    await page.close();
  }
});

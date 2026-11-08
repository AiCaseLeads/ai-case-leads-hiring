import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync, existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {tsImport} from 'tsx/esm/api';

const {createStore,jobInput,applicationInput,MANAGER,RECRUITER,currentAction} = await tsImport('./fixtures.ts',import.meta.url);
const {handleHubRequest} = await tsImport('../../lib/hub/http.ts',import.meta.url);
const {saveRecruiterReview} = await tsImport('../../lib/hub/recruiting-workflow.ts',import.meta.url);

test('mobile founder queue opens the recorded handoff, returns it to the recruiter, and keeps the queue scope',async t=>{
 const {store,database}=createStore();
 const job=await store.saveJob(jobInput());
 const {id}=await store.acceptApplication(applicationInput(job.id));
 await store.stmt("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES(?,?,'recruiter',1,0,0)",RECRUITER.userId,RECRUITER.email).run();
 await saveRecruiterReview(store,id,{expectedVersion:0,recommendation:'advance',summary:'Strong paid search results.',notes:'Reviewed client history.',recordingUrl:'https://example.invalid/recording',salaryExpectation:'USD 3,000 monthly',availability:'Two weeks',concerns:'Verify monthly spend.'},RECRUITER);
 await currentAction(store,id,{action:'stage',stage:'Awaiting Founder Review'},RECRUITER);
 const {outputFiles}=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {HiringDashboard} from './components/hub/dashboard';createRoot(document.getElementById('root')).render(<HiringDashboard member={${JSON.stringify(MANAGER)}} signOutHref="/"/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty'}});
 const styles=['app/globals.css','components/hub/hub.css','components/hub/workspace-v3.css','components/hub/workspace-surfaces.css','components/hub/global-search.css','components/hub/applicant-queue.css','components/hub/job-directory.css'];
 const globals=await postcss([tailwind()]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'});
 const css=globals.css+'\n'+styles.slice(1).map(file=>readFileSync(file,'utf8')).join('\n');
 const server=createServer(async(req,res)=>{
   try{
     if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(outputFiles[0].text);return;}
     const origin='http://'+req.headers.host;
     const url=new URL(req.url,origin);
     if(url.pathname.startsWith('/api/hub/')){
       const parts=[];for await(const chunk of req)parts.push(chunk);
       const response=await handleHubRequest(new Request(url,{method:req.method,headers:{'content-type':'application/json',origin},...(parts.length?{body:Buffer.concat(parts)}:{})}),url.pathname.slice('/api/hub/'.length).split('/'),MANAGER,store);
       res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());return;
     }
     if(url.pathname.startsWith('/api/')){res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'Optional integration unavailable'}}));return;}
     res.setHeader('Content-Type','text/html');res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}${css}</style><div id="root"></div><script src="/bundle.js"></script>`);
   }catch(error){res.writeHead(500);res.end(String(error));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const executable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 const browser=await chromium.launch({headless:true,...(existsSync(executable)?{executablePath:executable}:{})});
 t.after(async()=>{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});database.close();});
 const page=await browser.newPage({viewport:{width:320,height:760},isMobile:true,hasTouch:true});page.setDefaultTimeout(4500);
 const errors=[];page.on('pageerror',err=>errors.push(err.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/team');
 await page.getByRole('link',{name:'Synthetic Applicant',exact:true}).first().click();
 await page.getByRole('link',{name:'Open call recording'}).waitFor();
 if(process.env.WORKSPACE_SCREENSHOTS)await page.screenshot({path:process.env.WORKSPACE_SCREENSHOTS+'/handoff-mobile.png',fullPage:true});
 assert.equal(await page.getByRole('tab',{name:'Interviews & notes'}).getAttribute('aria-selected'),'true');
 assert.ok(await page.getByText('Verify monthly spend.',{exact:false}).first().isVisible());
 await page.getByRole('button',{name:'Return to recruiter',exact:true}).click();
 const question='What part of the spend did they personally manage?';
 await page.getByLabel('What should the recruiter clarify?').fill(question);
 await page.getByRole('button',{name:'Send question to recruiter'}).click();
 await page.waitForURL(url=>!url.searchParams.has('application'));
 assert.equal((await store.applicationRow(id)).stage,'Interview');
 assert.ok((await store.getApplication(id)).notes.some(note=>note.text.includes(question)));
 await page.goto('http://127.0.0.1:'+server.address().port+'/team?view=home');
 await page.getByRole('navigation',{name:'Applicant queues'}).getByRole('link',{name:/Returned to recruiters/}).click();
 await page.waitForURL(url=>url.searchParams.get('handoffReturned')==='true');
 await page.getByRole('link',{name:'Synthetic Applicant',exact:true}).first().waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);
 if(process.env.WORKSPACE_SCREENSHOTS)await page.screenshot({path:process.env.WORKSPACE_SCREENSHOTS+'/queue-mobile.png'});
 assert.deepEqual(errors,[]);
});

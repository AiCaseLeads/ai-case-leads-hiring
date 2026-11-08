import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const job={id:'job-1',title:'Synthetic Engineer',slug:'synthetic-engineer',location:'Remote · Spain',status:'open',fields:[],rules:[],formVersion:1,archiveCountry:'Spain',hiringRound:'Batch 2'};
const detail={id:'app-1',revision:1,name:'Synthetic Applicant',email:'synthetic@example.invalid',jobId:job.id,jobTitle:job.title,stage:'Application Review',qualification:'review',assignee:null,createdAt:Date.now(),updatedAt:Date.now(),source:'test',fields:[{path:'experience',title:'Experience',type:'LongText',required:false}],answers:[{path:'experience',value:'Synthetic role evidence'}],files:[{id:'file-1',filename:'synthetic-resume.pdf',url:'/api/files/file-1',contentType:'application/pdf',size:500}],history:[],notes:[],communications:[],scorecards:[],qualificationEvidence:[]};
async function setup(t,mode,application=detail){
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{CandidateDetail,Candidates}from'./components/hub/candidates';createRoot(document.getElementById('root')).render(${mode==='detail'?`<CandidateDetail id='app-1' changed={()=>{}} back={()=>{}}/>`:`<Candidates jobs={${JSON.stringify([job])}} refresh={0} changed={()=>{}} reviewerEmail='sales@example.invalid'/>`});`;
 const {outputFiles}=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,loader:{'.css':'empty'},format:'iife',jsx:'automatic'});
 const css=['hub.css','applicant-queue.css','workspace-v3.css','workspace-surfaces.css','share-applicant.css'].map(name=>readFileSync('components/hub/'+name,'utf8')).join('\n');
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?outputFiles[0].text:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}${css}</style><div class="hiring-hub"><aside class="hub-sidebar"></aside><div class="hub-workspace"><main class="hub-main"><div id="root"></div></main></div></div><script src="/bundle.js"></script>`);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(5000);const queries=[];
 t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  const mocks={'/api/hub/meetgeek/meetings':[],'/api/hub/interview-recordings':[],'/api/hub/job-groups':{groups:[]},'/api/job-team':{staff:[]},'/api/hub/collections':{views:[],lists:[]}};
  return route.fulfill({json:{data:mocks[path]||{}}});
 });
 await page.route('**/api/hub/applications**',route=>{queries.push(new URL(route.request().url()).search);return route.fulfill({json:{data:mode==='detail'?application:{items:[detail],total:1,page:1,pageSize:50}}});});
 await page.route('**/api/hub/applications/*/response-checks*',route=>{queries.push(route.request().url());return route.fulfill({json:{data:{status:"ready",entry:null,answers:[{path:"experience",title:"Experience",words:3,status:"ready",classification:"MIXED",confidence:null,matches:[{applicationId:"peer",jobTitle:"Similar posting",passage:"A shared passage"}]}]}}});});
 await page.route('**/api/scorecards*',route=>route.fulfill({json:{data:{template:null,revision:1}}}));
 await page.route('**/api/ai/match*',route=>route.fulfill({json:{data:{enabled:false,status:'disabled',score:null,criteria:[]}}}));
 await page.route('**/api/ai/config',route=>route.fulfill({json:{data:{configured:true,enabled:true,model:'synthetic',provider:'test',reviewOnly:true}}}));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('heading',{name:mode==='detail'?'Synthetic Applicant':'Applicants',exact:true}).waitFor();return {page,queries};
}
test('applicant record separates source files, review and activity without losing review drafts',async t=>{
 const {page}=await setup(t,'detail');
 assert.equal(await page.getByRole('heading',{name:'Application answers',exact:true}).isVisible(),true);
 assert.equal(await page.getByRole('heading',{name:'Evidence & verification',exact:true}).isVisible(),false);
 assert.equal(await page.getByRole('link',{name:/synthetic-resume\.pdf.*Download/}).getAttribute('href'),'/api/files/file-1');
 await page.getByRole('tab',{name:'Application & files',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('tab',{name:'Interviews & notes',exact:true}).getAttribute('aria-selected'),'true');await page.keyboard.press('Home');
 await page.getByRole('tab',{name:'Interviews & notes',exact:true}).click();await page.getByText('Advanced: evidence and verification tools',{exact:true}).click();await page.getByText('Record verification checks',{exact:true}).click();await page.getByLabel('Evidence and follow-up notes',{exact:true}).fill('Unsaved synthetic follow-up');
 await page.getByRole('tab',{name:'Activity & messages',exact:true}).click();assert.equal(await page.getByRole('heading',{name:'Messages',exact:true}).isVisible(),true);assert.equal(await page.getByRole('heading',{name:'Application answers',exact:true}).isVisible(),false);
 await page.getByRole('tab',{name:'Interviews & notes',exact:true}).click();assert.equal(await page.getByLabel('Evidence and follow-up notes',{exact:true}).inputValue(),'Unsaved synthetic follow-up');
 await page.getByLabel('More applicant actions',{exact:true}).click();await page.getByRole('button',{name:'Other applicant actions',exact:true}).click();await page.getByLabel('Action',{exact:true}).selectOption('scorecard');assert.equal(await page.getByRole('tab',{name:'Interviews & notes',exact:true}).getAttribute('aria-selected'),'true');
});
test('application filters compare a single posting and can clear filters independently of the posting',async t=>{
 const {page}=await setup(t,'list');
 const posting=page.getByLabel('Role or posting',{exact:true});
 const order=page.getByLabel('Order',{exact:true});
 const grades=page.getByLabel('Reviewer grades',{exact:true});
 const screening=page.getByLabel('Screening',{exact:true});
 const waitForApplicants=matches=>page.waitForResponse(response=>{
  const url=new URL(response.url());
  return url.pathname==='/api/hub/applications' && matches(url.searchParams);
 });
 assert.ok(!(await posting.locator('option').allTextContents()).some(label=>label.includes('Batch')));
 await page.getByRole('button',{name:'Filters & order'}).click();
 assert.equal(await order.locator('option[value="grade_desc"]').count(),0);
 await posting.selectOption('job:job-1');
 await order.selectOption('grade_desc');
 await page.getByText('More filters',{exact:true}).click();
 await grades.selectOption('reviewed');
 await Promise.all([waitForApplicants(q=>q.get('jobId')===job.id&&q.get('grade')==='reviewed'&&q.get('sort')==='grade_desc'&&q.get('qualification')==='pass'),screening.selectOption('pass')]);
 await Promise.all([waitForApplicants(q=>q.get('jobId')===job.id&&!q.has('grade')&&!q.has('qualification')&&q.get('sort')==='screening_newest'),page.getByRole('button',{name:'Clear filters',exact:true}).click()]);
 assert.equal(await posting.inputValue(),'job:job-1');
 assert.equal(await grades.inputValue(),'');
 assert.equal(await screening.inputValue(),'');
 await Promise.all([waitForApplicants(q=>!q.has('jobId')),page.getByRole('button',{name:'Remove filter: '+job.title,exact:true}).click()]);
 assert.equal(await posting.inputValue(),'');
 assert.equal(await order.locator('option[value="grade_desc"]').count(),0);
});

test('staff read each original answer once with its own estimate and matching evidence directly underneath',async t=>{
 const {page,queries}=await setup(t,'detail');
 for(const width of [320,1280]){
  await page.setViewportSize({width,height:800});
  const answers=page.locator('.hub-application-answers');
  const row=answers.locator('dl.hub-answer-list > div').filter({has:page.getByText('Experience',{exact:true})});
  const check=row.locator('dd > .response-check-inline');
  await check.getByText('Checked · Too little context to interpret',{exact:true}).waitFor();
  assert.equal(await check.getByText('Resembles mixed-source text').count(),0);
  assert.equal(await page.getByText('Synthetic role evidence',{exact:true}).count(),1);
  assert.equal(await page.getByText('Response checks',{exact:true}).count(),0);
  assert.equal(queries.filter(path=>path.endsWith('/response-checks?includeText=false')).length,1);
  await check.getByText('Matching passages (1)',{exact:true}).click();
  assert.match(await check.getByRole('link',{name:/Open matching application/}).getAttribute('href'),/application=peer/);
  assert.equal(await check.evaluate(el=>el.getBoundingClientRect().right<=window.innerWidth),true);
  await check.getByText('Matching passages (1)',{exact:true}).click();
 }
});

const legacyFinding = {
  criterion: '5+ years of software or ML engineering, with at least 2 on systems used by real people',
  status: 'needs_verification',
  explanation: 'The résumé lists 12+ years shipping production systems. The application lists “8p” for software or ML engineering. Clarify the total years of experience and the time spent on ML.',
  citations: [
    {source:'resume',quote:'Synthetic Applicant • (555) 010-1401 • synthetic@example.invalid • PROFILE SUMMARY: 12+ years building production software.'},
    {source:'answers',quote:'"question":"Years of software or ML engineering","answer":"8p"}{"question":"Desired compensation","answer":"4000"'},
  ],
};

test('claim review summarizes conflicting experience without repeating private evidence',async t=>{
  const applicant={...detail,aiMatch:{status:'ready',criteria:[legacyFinding]}};
  const {page}=await setup(t,'detail',applicant);
  const summary=page.getByRole('region',{name:'Claim review'});
  for(const width of [320,1280]){
    await page.setViewportSize({width,height:800});
    await summary.waitFor();
    const text=await summary.innerText();
    assert.match(text,/12\+/);
    assert.match(text,/\b8p\b/);
    assert.doesNotMatch(text,/(?:\b8 years|Synthetic Applicant|555\) 010|synthetic@example|PROFILE SUMMARY|compensation|4000|"answer"|"question"|5\+ years of software)/i);
    assert.equal(await summary.locator('blockquote').count(),0);
    assert.ok(await summary.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Summary fits its container');
  }
});

test('claim review puts different answers from past applications in context',async t=>{
  const {page}=await setup(t,'detail',{
    ...detail,
    aiMatch:{status:'ready',criteria:[]},
    relatedApplications:[{
      id:'prior',jobId:'old-job',jobTitle:'Earlier opening',stage:'Screening',createdAt:Date.UTC(2025,3,22),
      differences:[{question:'years managing production systems',current:12,other:4}],
    }],
  });
  const summary=await page.getByRole('region',{name:'Claim review'}).innerText();
  assert.match(summary,/production systems/i);
  assert.match(summary,/\b12\b/);
  assert.match(summary,/\b4\b/);
  assert.doesNotMatch(summary,/source excerpts|compare the dated answers under/i);
});

test('claim review distinguishes a completed clear comparison from a pending review',async t=>{
  for(const [match,expected] of [
    [{status:'ready',criteria:[]},/no discrepancies flagged/i],
    [{status:'pending',criteria:[]},/source comparison pending/i],
  ]){
    const {page}=await setup(t,'detail',{...detail,aiMatch:match});
    const summary=await page.getByRole('region',{name:'Claim review'}).innerText();
    assert.match(summary,expected);
    assert.doesNotMatch(summary,/Medium|High|Synthetic Applicant|synthetic@example/);
  }
});

test('additional distinct findings remain readable on demand',async t=>{
  const explanations=[
    'The résumé lists a team of 18. The application lists a team of 22.',
    'The résumé lists a 2018 start date. The application lists a 2020 start date.',
    'The résumé reports 26 campaigns. The application reports 40 campaigns.',
  ];
  const criteria=explanations.map((explanation,i)=>({...legacyFinding,criterion:['Team size','Start date','Campaign count'][i],explanation}));
  const {page}=await setup(t,'detail',{...detail,aiMatch:{status:'ready',criteria}});
  const summary=page.getByRole('region',{name:'Claim review'});
  const more=summary.locator('details > summary');
  await more.click();
  const expanded=await summary.innerText();
  for(const value of ['18','22','2018','2020','26','40'])assert.ok(expanded.includes(value));
  assert.doesNotMatch(expanded,/synthetic@example|compensation|4000|PROFILE SUMMARY/);
  await more.focus();await page.keyboard.press('Enter');
  assert.equal(await summary.locator('details').getAttribute('open'),null);
});

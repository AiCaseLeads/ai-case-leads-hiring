// Real built Vinext Node server + production SQLite/files. Google remains disconnected.
// Staff identity is seeded ONLY in this isolated test database, never via an app bypass.
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {randomBytes,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {DatabaseSync} from 'node:sqlite';
import {chromium} from 'playwright';
import {SQLiteD1Database} from '../lib/railway/sqlite.ts';
import {FileObjectStore} from '../lib/railway/object-store.ts';
import {HubStore} from '../lib/hub/store.ts';
import {readSingleResumeText} from '../lib/agent-api/resume-text.ts';

assert.ok(existsSync('dist/server/index.js'),'Run npm run build:railway first.');
const dataDir=mkdtempSync(path.join(realpathSync(tmpdir()),'aicl-railway-http-'));
const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const origin=`http://127.0.0.1:${port}`,rawSession=randomBytes(32).toString('hex');
const ownerCookie=`aicl_staff_session=${rawSession}`;
const sqlite=new SQLiteD1Database(path.join(dataDir,'hiring.sqlite'));sqlite.migrate(path.resolve('drizzle'));
sqlite.connection.prepare('INSERT INTO staff_sessions(token_hash,user_id,email,full_name,created_at,expires_at) VALUES(?,?,?,?,?,?)').run(createHash('sha256').update(rawSession).digest('hex'),'isolated-test-owner','sales@aicaseleads.com','Isolated test owner',Date.now(),Date.now()+3600_000);
for(const name of ['maria','alex','sam'])sqlite.connection.prepare('INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES(?,?,?,1,?,?)').run(`synthetic-${name}`,`${name}@example.invalid`,'recruiter',Date.now(),Date.now());
sqlite.close();
let child,logs='',browser;
async function start(enabled){
 logs='';child=spawn(process.execPath,['scripts/start-railway.mjs'],{env:{...process.env,NODE_ENV:'development',DATA_DIR:dataDir,RAILWAY_DEPLOYMENT_ID:'synthetic-isolated',RAILWAY_VOLUME_MOUNT_PATH:dataDir,PUBLIC_SITE_ORIGIN:origin,PORT:String(port),ADMIN_EMAILS:'sales@aicaseleads.com',GOOGLE_CLIENT_ID:'synthetic.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'synthetic-only',GOOGLE_TOKEN_KEY:'1'.repeat(64),EXPECTED_RECRUITING_EMAIL:'mariam@aicaseleads.com',BACKGROUND_ENABLED:'false',APPLICATIONS_ENABLED:String(enabled)},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',value=>{logs+=value;});child.stderr.on('data',value=>{logs+=value;});
 const began=Date.now();while(!logs.includes('[railway] http_ready')){assert.ok(Date.now()-began<30000&&child.exitCode===null,`Node server failed: ${logs.slice(-2500)}`);await new Promise(resolve=>setTimeout(resolve,100));}
 assert.equal((await fetch(origin+'/api/health')).status,200);
}
async function stop(){if(!child||child.exitCode!==null)return;const processDone=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),55000);await processDone;clearTimeout(timer);assert.equal(child.exitCode,0,logs.slice(-2500));}
async function api(url,method='GET',body,staff=true,extra={}){
 const response=await fetch(origin+url,{method,headers:{...(staff?{Cookie:ownerCookie}:{}),...(body!==undefined?{'Content-Type':'application/json',Origin:origin}:{}),...extra},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const value=await response.json();assert.equal(response.status,200,JSON.stringify({url,status:response.status,value}));return value.data;
}
// Background workers are deliberately off to isolate outbound effects. Use the
// production single-file parser to finish only the originals this smoke reads.
async function prepareResumeText(applicationId,fileId) {
 const db=new SQLiteD1Database(path.join(dataDir,'hiring.sqlite'));
 try {
  const store=new HubStore(db.asD1());
  const file=await store.stmt('SELECT id,uploaded_at,size,content_type FROM hub_files WHERE id=? AND application_id=?',fileId,applicationId).first();
  assert.ok(file,'The test PDF must belong to the submitted application');
  const bucket=new FileObjectStore(path.join(dataDir,'objects'));
  const result=await readSingleResumeText({store,bucket,applicationId,file,deadline:Date.now()+30000});
  assert.equal(result.status,'ready');
 } finally { db.close(); }
}
function syntheticResume(padding=20000, label="Synthetic isolated resume"){
 const content=`BT /F1 12 Tf 72 720 Td (${label}) Tj ET\n`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let pdf='%PDF-1.7\n',offsets=[0];for(const [index,object] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;}
 pdf+='% Synthetic isolated verification padding.\n'.repeat(padding);
 const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return Buffer.from(pdf);
}
const sample=syntheticResume();assert.ok(sample.length>512*1024);
const started=performance.now(),latencies=[];let phase='initial checks',acceptedRequests=0;
function verifyOneApplication(receipts){
 const db=new DatabaseSync(path.join(dataDir,'hiring.sqlite'),{readOnly:true});
 try{
  const lookup=db.prepare('SELECT application_id FROM hiring_submissions WHERE receipt_hash=? OR key_hash IN (SELECT submission_key_hash FROM hiring_receipts WHERE receipt_hash=?)');
  const ids=receipts.map(receipt=>{const hash=createHash('sha256').update(receipt).digest('hex');return lookup.get(hash,hash)?.application_id;});
  assert.ok(ids.every(Boolean));assert.equal(new Set(ids).size,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM hub_tasks WHERE application_id=?').get(ids[0]).n,4);
 }finally{db.close();}
}
try{
 await start(false);
 for(const url of ['/api/hub/overview','/api/hub/applications','/api/hub/settings','/api/job-team','/api/team','/api/personal-calendar','/api/files/unknown'])for(const forged of [false,true]){
  const response=await fetch(origin+url,{headers:forged?{'oai-authenticated-user-id':'attacker','oai-authenticated-user-email':'sales@aicaseleads.com','x-openai-user-email':'sales@aicaseleads.com'}:{}});assert.equal(response.status,403);
 }
 assert.equal((await fetch(origin+'/team?auth=__proto__')).status,200);
 const startResponse=await fetch(origin+'/api/auth/google/start?return_to=//attacker.invalid',{redirect:'manual'});assert.equal(startResponse.status,303);
 const authorize=new URL(startResponse.headers.get('location'));assert.equal(authorize.origin,'https://accounts.google.com');assert.equal(authorize.searchParams.get('redirect_uri'),origin+'/api/auth/google/callback');assert.equal(authorize.searchParams.get('scope'),'openid email profile');assert.equal(authorize.searchParams.has('client_secret'),false);
 const personal=await api('/api/personal-calendar');assert.equal(personal.email,'sales@aicaseleads.com');assert.equal(personal.connected,false);assert.equal(personal.ready,false);assert.equal(personal.configured,true);
 const hours={timeZone:'America/Bogota',weekdays:[1,2,3,4,5],startHour:10,endHour:16,durationMinutes:30,minimumNoticeHours:2,horizonDays:14};
 const savedHours=await api('/api/personal-calendar','PUT',{availability:hours});assert.deepEqual(savedHours.availability,hours);assert.equal(savedHours.ready,false,'Hours alone do not authorize Google');
 const invited=await api('/api/team','POST',{email:'head@example.invalid',role:'admin',active:true,sendInvite:true});assert.equal(invited.members.find(m=>m.email==='head@example.invalid').invite.status,'pending');assert.equal(invited.members.find(m=>m.email==='head@example.invalid').isOwner,false);
 const repeated=await api('/api/team','POST',{email:'head@example.invalid',role:'admin',active:true,sendInvite:true});assert.equal(repeated.members.find(m=>m.email==='head@example.invalid').invite.createdAt,invited.members.find(m=>m.email==='head@example.invalid').invite.createdAt);
 const guide=await fetch(origin+'/recruiter-guide.pdf');assert.equal(guide.status,200);assert.match(guide.headers.get('content-type'),/application\/pdf/);assert.equal(Buffer.from(await guide.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
 const fixtureUi=await promisify(execFile)(process.execPath,['--test','tests/ui-flow.spec.mjs'],{env:{...process.env,TEST_BASE_URL:origin,TEST_HOSTING_PLATFORM:'railway',TEST_PRODUCTION_ASSETS:'true'},maxBuffer:1024*1024});
 assert.match(fixtureUi.stdout,/tests 20/);assert.match(fixtureUi.stdout,/pass 20/);assert.match(fixtureUi.stdout,/skipped 0/);console.log('Existing production browser recovery suite: 20 passed.');
 await stop();await start(true);
 const executable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 browser=await chromium.launch({headless:true,...(existsSync(executable)?{executablePath:executable}:{})});
 const staff=await browser.newContext({viewport:{width:1440,height:1000}});await staff.addCookies([{name:'aicl_staff_session',value:rawSession,url:origin,httpOnly:true,sameSite:'Lax'}]);
 const team=await staff.newPage(),errors=[],consoleErrors=[];team.on('pageerror',error=>errors.push(error.message));team.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
 await team.goto(origin+'/team');await team.getByRole('button',{name:'Jobs',exact:true}).click();await team.getByRole('button',{name:'Create job',exact:true}).click();
 await team.getByRole('button',{name:'Create blank job',exact:true}).click();
 await team.getByLabel('Job title',{exact:true}).fill('Railway Test Engineer');await team.getByText('More details: department and page address',{exact:true}).click();await team.getByLabel('Public page address',{exact:true}).fill('railway-test-engineer');await team.getByLabel('Job description',{exact:true}).fill('Isolated Railway verification role. No real applications or outreach.');
 for(let n=0;n<2;n++)await team.getByRole('button',{name:'Continue',exact:true}).click();
 await team.locator('.hub-review-team > summary').click();
 await team.getByRole('checkbox',{name:/maria@example.invalid/}).check();await team.getByRole('checkbox',{name:/alex@example.invalid/}).check();await team.getByLabel('Default reply contact',{exact:true}).selectOption('maria@example.invalid');
 await team.getByRole('button',{name:'Continue',exact:true}).click();
 assert.equal(await team.getByRole('checkbox',{name:/I have reviewed|I approve/}).count(),0);
 await team.getByRole('button',{name:'Publish job',exact:true}).click();await team.getByRole('heading',{name:'Jobs',exact:true}).waitFor();
 let jobs=await api('/api/hub/jobs');assert.equal(jobs.length,1);const engineer=jobs[0];assert.equal(engineer.title,'Railway Test Engineer');assert.equal(engineer.status,'open');
 assert.ok(engineer.fields.slice(0,4).every(field=>field.required));assert.equal(engineer.fields.find(field=>field.path==='_systemfield_phone').type,'Phone');
 const engineerTeam=await api('/api/job-team?jobId='+engineer.id);assert.deepEqual(engineerTeam.config.members,['maria@example.invalid','alex@example.invalid']);assert.equal(engineerTeam.config.replyTo,'maria@example.invalid');
 const creative=await api('/api/hub/jobs','POST',{title:'Railway Test Creative',slug:'railway-test-creative',department:'Isolated test',descriptionHtml:'<p>Isolated test role.</p>',status:'open',fields:engineer.fields,rules:[],autoReject:false,assessmentPrompt:'Isolated assessment',rejectionTemplate:'Isolated rejection for {{name}}.'});
 await api('/api/job-team','PUT',{jobId:creative.id,expectedRevision:0,members:['sam@example.invalid'],replyTo:'sam@example.invalid',notifyNewApplications:true,notifyAssessmentSubmissions:true,notifyReplies:true,notifyOverdueReviews:true});
 // Every starting point uses the real built server; these remain private drafts.
 const jobCard=title=>team.locator('article').filter({has:team.getByRole('heading',{name:title,exact:true})});
 async function finishDraft(title){await team.getByLabel('Job title',{exact:true}).fill(title);for(let n=0;n<3;n++)await team.getByRole('button',{name:'Continue',exact:true}).click();await team.getByRole('button',{name:'Save draft job',exact:true}).click();await team.getByRole('heading',{name:'Jobs',exact:true}).waitFor();}
 await jobCard(engineer.title).getByLabel(`Actions for ${engineer.title}`,{exact:true}).click();await jobCard(engineer.title).getByRole('button',{name:'Duplicate job',exact:true}).click();await finishDraft('Isolated Duplicate Posting');
 await jobCard(engineer.title).getByLabel(`Actions for ${engineer.title}`,{exact:true}).click();await jobCard(engineer.title).getByRole('button',{name:'Save as template',exact:true}).click();await team.getByLabel('Template name',{exact:true}).fill('Isolated Engineering Template');await team.getByRole('button',{name:'Save template',exact:true}).click();await team.getByText('Job template saved.',{exact:false}).waitFor();
 await team.getByRole('button',{name:'Create job',exact:true}).click();await team.getByRole('button',{name:'Choose template',exact:true}).click();const savedSetup=await api('/api/job-setup');assert.equal(savedSetup.templates.length,1);await team.getByLabel('Job template',{exact:true}).selectOption(savedSetup.templates[0].id);await team.getByRole('button',{name:'Use this template',exact:true}).click();await finishDraft('Isolated Template Posting');
 await team.getByRole('button',{name:'Create job',exact:true}).click();await team.getByRole('button',{name:'Open hiring requests',exact:true}).click();await team.getByRole('button',{name:'Create a hiring request',exact:true}).click();await team.getByLabel('Requested job title',{exact:true}).fill('Isolated Requested Posting');await team.getByLabel('Why do we need this hire?',{exact:true}).fill('Synthetic internal request verification only.');await team.getByLabel('Draft responsibilities (optional)',{exact:true}).fill('Synthetic responsibilities.');await team.getByRole('button',{name:'Save hiring request',exact:true}).click();await team.getByRole('button',{name:'Create job from request',exact:true}).click();await finishDraft('Isolated Requested Posting');
 const setupResult=await api('/api/job-setup');assert.equal(setupResult.requests[0].status,'used');const privateDrafts=(await api('/api/hub/jobs')).filter(job=>job.status==='draft');assert.equal(privateDrafts.length,3);assert.equal((await api('/api/hub/jobs')).find(job=>job.id===engineer.id).status,'open');
 for(const draft of privateDrafts)assert.equal((await fetch(origin+'/api/jobs/'+draft.slug)).status,404);
 let firstId,firstFile;
 for(const [index,job] of [engineer,creative].entries()){
  const applicant=await browser.newContext({viewport:index?{width:390,height:844}:{width:1440,height:1000}}),page=await applicant.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+`/jobs/${job.slug}?utm_source=railway-verified`);await page.getByLabel('First name',{exact:false}).fill('Isolated Browser');await page.getByLabel('Last name',{exact:false}).fill(`Candidate ${index}`);await page.getByLabel('Email address',{exact:false}).fill(`isolated-browser-${index}@example.invalid`);await page.getByLabel('Phone number',{exact:false}).fill('+1 305 555 0123');await page.getByLabel('LinkedIn profile',{exact:false}).fill(`https://www.linkedin.com/in/isolated-browser-${index}`);await page.locator('input[type=file]').setInputFiles({name:'isolated-resume.pdf',mimeType:'application/pdf',buffer:sample});
  await page.getByRole('button',{name:'Submit application',exact:false}).click();await page.waitForURL(/\/applications\/[a-f0-9]{64}$/, {timeout:15000}).catch(async error=>{throw new Error(`${error.message}\n${(await page.locator('body').innerText()).slice(-2000)}`);});
  assert.equal((await fetch(origin+'/api'+new URL(page.url()).pathname)).status,200);await applicant.close();
 }
 const applications=await api('/api/hub/applications');assert.equal(applications.total,2);firstId=applications.items[0].id;
 const detail=await api('/api/hub/applications/'+firstId);assert.equal(detail.files.length,1);firstFile=detail.files[0].id;assert.equal(detail.source,'railway-verified');
 const original=await fetch(origin+'/api/files/'+firstFile,{headers:{Cookie:ownerCookie}});assert.equal(original.status,200);assert.deepEqual(Buffer.from(await original.arrayBuffer()),sample);assert.equal((await fetch(origin+'/api/files/'+firstFile)).status,403);
 const pdfRequest={applicationId:firstId,fileId:firstFile};
 await prepareResumeText(firstId,firstFile);
 const extracted=await api('/api/ai/resume-text','POST',pdfRequest);assert.equal(extracted.status,'ready');assert.match(extracted.text,/Synthetic isolated resume/);
 assert.equal((await api('/api/ai/resume-text','POST',pdfRequest)).cached,true);
 assert.equal((await fetch(origin+'/api/ai/resume-text',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(pdfRequest)})).status,403);
 const another=applications.items.find(item=>item.id!==firstId);
 const otherDetail=await api('/api/hub/applications/'+another.id);await prepareResumeText(another.id,otherDetail.files[0].id);
 const mismatch=await fetch(origin+'/api/ai/resume-text',{method:'POST',headers:{Origin:origin,Cookie:ownerCookie,'Content-Type':'application/json'},body:JSON.stringify({...pdfRequest,applicationId:another.id})});assert.equal(mismatch.status,404);
 // Real browser history on the built server, without changing applicant data.
 const nav=team.getByRole('navigation',{name:'Hiring workspace'});
 await nav.getByRole('button',{name:'Applicants',exact:true}).click();await team.getByRole('heading',{name:'Applicants',exact:true}).waitFor();
 const applicationListUrl=team.url();
 await nav.getByRole('button',{name:'Jobs',exact:true}).click();await team.getByRole('heading',{name:'Jobs',exact:true}).waitFor();
 await team.goBack();await team.getByRole('heading',{name:'Applicants',exact:true}).waitFor();assert.equal(team.url(),applicationListUrl);
 await team.goForward();await team.getByRole('heading',{name:'Jobs',exact:true}).waitFor().catch(async error=>{throw new Error(error.message+'\nURL: '+team.url()+'\n'+(await team.locator('body').innerText()).slice(0,1500)+'\nBrowser errors: '+JSON.stringify({errors,consoleErrors})+'\nServer logs: '+logs.slice(-1500));});
 await nav.getByRole('button',{name:'Applicants',exact:true}).click();await team.getByRole('heading',{name:'Applicants',exact:true}).waitFor();
 const chosenJob=[engineer,creative].find(job=>job.id===detail.jobId);assert.ok(chosenJob);
 await team.getByLabel('Role or posting',{exact:true}).selectOption('job:'+chosenJob.id);await team.getByRole('heading',{name:chosenJob.title,exact:true}).waitFor();
 const jobApplicationsUrl=team.url();
 // Real browser exports retain answers and original files, with job scope made explicit.
 await team.getByLabel('Application options',{exact:true}).click();
 const csvResponse=await fetch(origin+'/api/hub/applications-export?format=csv&jobId='+chosenJob.id,{headers:{Cookie:ownerCookie}});assert.equal(csvResponse.status,200);const csv=await csvResponse.text();assert.ok(csv.includes(detail.email));assert.ok(csv.includes(detail.name));
 const [zipDownload]=await Promise.all([team.waitForEvent('download'),team.getByRole('button',{name:/^Download matching ZIP/}).click()]);
 assert.match(zipDownload.suggestedFilename(),/\.zip$/);const zip=readFileSync(await zipDownload.path());assert.equal(zip.subarray(0,2).toString(),'PK');assert.ok(zip.includes(Buffer.from('isolated-resume.pdf')));
 await team.getByRole('link',{name:detail.name,exact:true}).click();await team.getByRole('heading',{name:detail.name,exact:true}).waitFor();
 assert.equal(new URL(team.url()).searchParams.get('application'),firstId);
 await team.getByLabel('More applicant actions',{exact:true}).click();
 const [applicationPdf]=await Promise.all([team.waitForEvent('download'),team.getByRole('button',{name:'Download application PDF',exact:true}).click()]);
 assert.match(applicationPdf.suggestedFilename(),/\.pdf$/);assert.equal(readFileSync(await applicationPdf.path()).subarray(0,5).toString(),'%PDF-');
 await team.goBack();await team.getByRole('heading',{name:chosenJob.title,exact:true}).waitFor();assert.equal(team.url(),jobApplicationsUrl);
 await team.goForward();await team.getByRole('heading',{name:detail.name,exact:true}).waitFor();
 await team.getByRole('button',{name:'Back to applications',exact:true}).click();await team.getByRole('heading',{name:chosenJob.title,exact:true}).waitFor();
 await team.getByRole('link',{name:detail.name,exact:true}).click();
 await team.getByRole('button',{name:'Shortlist',exact:true}).click();await team.getByText('Added to the shortlist. No email sent.',{exact:true}).waitFor();
 assert.equal((await api('/api/hub/applications/'+firstId)).stage,'Screening');
 await team.getByRole('heading',{name:chosenJob.title,exact:true}).waitFor();
 await team.getByRole('link',{name:detail.name,exact:true}).click();
 await team.getByLabel('More applicant actions',{exact:true}).click();await team.locator('.hub-job-menu[open]').getByRole('button',{name:'Request interview',exact:true}).click();await team.getByRole('button',{name:'Send booking link',exact:true}).waitFor();
 assert.equal(await team.getByRole('button',{name:'Send booking link',exact:true}).isDisabled(),true,'Disconnected Gmail/Calendar cannot send an interview invitation');
 assert.equal((await api('/api/hub/applications/'+firstId)).interviews.length,0);
 await team.goto(origin+'/team?application='+firstId);await team.getByLabel('More applicant actions',{exact:true}).click();await team.getByRole('button',{name:'Other applicant actions',exact:true}).click();await team.getByLabel('Action',{exact:true}).selectOption('scorecard');await team.getByLabel('Overall reviewer grade',{exact:false}).selectOption('4');await team.getByLabel('Evaluation criteria',{exact:false}).fill('Isolated job-specific rubric');await team.getByLabel('Review notes',{exact:true}).fill('Synthetic test evidence only.');await team.getByRole('button',{name:'Save action',exact:true}).click();await team.getByText('Saved to this application.',{exact:true}).waitFor();
 const graded=await api('/api/hub/applications/'+firstId);assert.equal(graded.grade.scorePercent,80);assert.equal(graded.grade.reviewerCount,1);
 let catalog=await api('/api/scorecards');
 const rubric={name:'Synthetic reusable rubric',criteria:[{label:'Implementation evidence',weight:1,anchors:['1','2','3','4','5']},{label:'Communication evidence',weight:1,anchors:['1','2','3','4','5']}]};
 catalog=await api('/api/scorecards','PATCH',{action:'save',expectedRevision:catalog.revision,rubric});const template=catalog.templates[0];
 catalog=await api('/api/scorecards','PATCH',{action:'bind',expectedRevision:catalog.revision,jobId:another.jobId,templateId:template.id,version:template.version});
 await team.goto(origin+'/team?application='+another.id);await team.getByRole('tab',{name:'Interviews & notes',exact:true}).click();await team.getByText('Optional: human grades and scorecards',{exact:true}).click();await team.getByRole('heading',{name:'Reusable scorecard review',exact:true}).waitFor();
 await team.getByLabel('Implementation evidence: score',{exact:true}).selectOption('3');await team.getByLabel('Implementation evidence: supporting evidence',{exact:true}).fill('Synthetic sample includes a working API.');
 await team.getByLabel('Communication evidence: score',{exact:true}).selectOption('4');await team.getByLabel('Communication evidence: supporting evidence',{exact:true}).fill('Synthetic explanation identifies constraints.');
 await team.getByRole('button',{name:'Save reusable scorecard',exact:true}).click();
 let rubricResult;for(let n=0;n<100;n++){rubricResult=await api('/api/hub/applications/'+another.id);if(rubricResult.grade.scorePercent===70)break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(rubricResult.grade.scorePercent,70);assert.match(rubricResult.scorecards[0].text,/Implementation evidence/);assert.equal(rubricResult.stage,another.stage);
 await api('/api/scorecards','PATCH',{action:'save',expectedRevision:catalog.revision,templateId:template.id,rubric:{...rubric,name:'Synthetic rubric revised'}});
 const assigned=await api('/api/scorecards?jobId='+another.jobId);assert.equal(assigned.template.version,1);
 assert.equal((await api('/api/hub/applications/'+another.id)).grade.scorePercent,70);
 await team.getByText('Advanced: evidence and verification tools',{exact:true}).click();await team.getByText('Custom evidence comparison (optional)',{exact:true}).click();await team.getByText('View extracted résumé text',{exact:true}).click();await team.getByLabel('Text read from uploaded PDF',{exact:true}).waitFor();
 await team.waitForFunction(()=>document.querySelector('textarea[readonly]')?.value.includes('Synthetic isolated resume'));
 await team.getByRole('button',{name:'Settings',exact:true}).click();await team.getByRole('heading',{name:'Settings',exact:true}).waitFor();await team.getByRole('heading',{name:'My interview calendar',exact:true}).waitFor();await team.getByRole('button',{name:'Diagnostics',exact:true}).click();await team.getByText('Background processing',{exact:true}).click();await team.getByText('No Google Apps Script scheduler is needed.',{exact:false}).waitFor();assert.equal(await team.getByText('No Google Apps Script scheduler is needed.',{exact:false}).count(),1);assert.equal(await team.getByRole('button',{name:'Save Google client configuration',exact:true}).count(),0);
 await staff.close();assert.deepEqual(errors,[]);await browser.close();browser=undefined;console.log('Seeded owner browser job posting, desktop/mobile application uploads, private files and grading passed.');
 const payload=(job,seq)=>({jobPostingId:job.id,formVersion:job.formVersion,submissionKey:crypto.randomUUID(),fieldSubmissions:[{path:'_systemfield_name',value:'Isolated Load'},{path:'_systemfield_last_name',value:`Candidate ${seq}`},{path:'_systemfield_email',value:`isolated-load-${seq}@example.invalid`},{path:'_systemfield_phone',value:'+1305'+String(seq).padStart(7,'0')},{path:'linkedin_profile',value:'https://www.linkedin.com/in/synthetic-load-'+seq}],utmData:{utm_source:'isolated-load'}});
 phase='synthetic application load';
 let localConnectRetries=0;
 const submit=async(job,seq,input,session)=>{
  const began=performance.now();
  const request={method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:`hiring_session=${session}`,'x-real-ip':`198.18.${(seq>>8)&255}.${seq&255}`},body:JSON.stringify(input)};
  const url=origin+'/api/applications';
  let response;
  try { response=await fetch(url,request); } catch(error) {
    // On macOS the 1,000 simultaneous TCP opens can fill the loopback listen
    // queue. Retry only an unconnected socket, with the same idempotency key.
    if(error.cause?.code!=='ETIMEDOUT' || error.cause?.syscall!=='connect')throw error;
    localConnectRetries++;response=await fetch(url,request);
  }
  const value=await response.json();latencies.push(performance.now()-began);
  assert.equal(response.status,201,JSON.stringify(value));assert.equal(value.status,'accepted');acceptedRequests++;return value;
 };
 const resumeJourneys=[];
 // Every posting requires a private résumé, including load and replay cases.
 async function prepareSubmission(job,seq) {
  const session=randomBytes(32).toString('hex'),input=payload(job,seq);
  const bytes=syntheticResume(0,`Synthetic candidate ${seq}: Built React TypeScript interfaces and Node APIs.`);
  const headers={Origin:origin,Cookie:`hiring_session=${session}`,'x-real-ip':`198.18.${(seq>>8)&255}.${seq&255}`};
  const fileField=job.fields.find(f=>f.type==='File').path;
  const filename=seq<1000?`synthetic-${seq}.pdf`:`load-resume-${seq}.pdf`;
  const upload=await fetch(origin+'/api/uploads',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({jobPostingId:job.id,fieldPath:fileField,filename,contentType:'application/pdf',contentLength:bytes.length})});
  const slot=await upload.json();assert.equal(upload.status,200,JSON.stringify(slot));
  const form=new FormData();form.append('file',new File([bytes],filename,{type:'application/pdf'}));
  const stored=await fetch(slot.url,{method:'POST',headers,body:form});assert.equal(stored.status,204,await stored.text());
  input.fieldSubmissions.push({path:fileField,value:slot.handle});
  return {input,session};
 }
 for(let batch=0;batch<20;batch++){phase=`load batch ${batch+1}/20`;await Promise.all(Array.from({length:100},async(_,index)=>{
  const seq=batch*100+index,job=seq%2?creative:engineer,began=performance.now();
  const {input,session}=await prepareSubmission(job,seq);
  await submit(job,seq,input,session);resumeJourneys.push(performance.now()-began);
 }));}
 phase='1,000 simultaneous submission requests';console.log('2,000 synthetic applications accepted. Preparing the 1,000-request burst.');
 const burst=[];
 for(let i=2000;i<3000;i+=100)burst.push(...await Promise.all(Array.from({length:100},async(_,n)=>{
  const seq=i+n,job=seq%2?creative:engineer;return {job,seq,...await prepareSubmission(job,seq)};
 })));
 await Promise.all(burst.map(({job,seq,input,session})=>submit(job,seq,input,session)));
 phase='file matching and overdue review checks';console.log('3,000 synthetic applications accepted. Checking private files and review queues.');
 const checkedFiles=new DatabaseSync(path.join(dataDir,'hiring.sqlite'),{readOnly:true});
 assert.equal(checkedFiles.prepare('SELECT COUNT(*) AS n FROM hub_files WHERE application_id IS NOT NULL AND uploaded_at>0').get().n,3002);const selected=checkedFiles.prepare("SELECT id,application_id,filename FROM hub_files WHERE filename IN ('synthetic-0.pdf','synthetic-500.pdf','synthetic-999.pdf')").all();checkedFiles.close();
 for(const file of selected){await prepareResumeText(file.application_id,file.id);const seq=file.filename.match(/synthetic-(\d+)/)[1];const data=await api('/api/ai/resume-text','POST',{applicationId:file.application_id,fileId:file.id});assert.equal(data.status,'ready');assert.match(data.text,new RegExp(`Synthetic candidate ${seq}:`));}
 const overdueDb=new DatabaseSync(path.join(dataDir,'hiring.sqlite'));const aged=Date.now()-49*3600_000;
 overdueDb.prepare("UPDATE hub_applications SET stage_entered_at=? WHERE id IN (SELECT application_id FROM hub_files WHERE filename LIKE 'synthetic-%.pdf')").run(aged);
 overdueDb.prepare("UPDATE hub_history SET created_at=? WHERE application_id IN (SELECT application_id FROM hub_files WHERE filename LIKE 'synthetic-%.pdf')").run(aged);overdueDb.close();
 const overdue=await api('/api/review-reminders');assert.equal(overdue.total,1000);assert.equal(overdue.applications.length,50);
 await api('/api/review-reminders','PATCH',{enabled:true,dueHours:48,fallbackAdmins:['sales@aicaseleads.com']});
 const secondPage=await api('/api/review-reminders?offset=50');assert.equal(secondPage.total,1000);assert.equal(new Set([...overdue.applications,...secondPage.applications].map(a=>a.id)).size,100);
 assert.equal((await fetch(origin+'/api/review-reminders')).status,403);
 resumeJourneys.sort((a,b)=>a-b);
 phase='20 simultaneous duplicate submission requests';
 const {input:duplicate,session}=await prepareSubmission(engineer,4000);const repeats=await Promise.all(Array.from({length:20},()=>submit(engineer,4000,duplicate,session)));verifyOneApplication(repeats.map(value=>value.receipt));
 assert.equal((await api('/api/hub/reports')).applications,3003);
 const routed=new DatabaseSync(path.join(dataDir,'hiring.sqlite'),{readOnly:true});
 const notices=routed.prepare("SELECT a.job_id,json_extract(t.payload_json,'$.recipient') AS recipient,COUNT(*) AS n FROM hub_tasks t JOIN hub_applications a ON a.id=t.application_id WHERE json_extract(t.payload_json,'$.jobNotification')=1 GROUP BY a.job_id,recipient").all();
 const totals=routed.prepare('SELECT job_id,COUNT(*) AS n FROM hub_applications GROUP BY job_id').all();
 assert.equal(notices.length,3);for(const notice of notices){assert.ok((notice.job_id===engineer.id?['maria@example.invalid','alex@example.invalid']:['sam@example.invalid']).includes(notice.recipient));assert.equal(notice.n,totals.find(row=>row.job_id===notice.job_id).n);}routed.close();
 phase='restart persistence and accepted replay';
 await stop();await start(false);
 assert.equal((await api('/api/hub/reports')).applications,3003);assert.equal((await api('/api/hub/applications/'+firstId)).grade.scorePercent,80);
 assert.deepEqual((await api('/api/job-team?jobId='+engineer.id)).config.members,['maria@example.invalid','alex@example.invalid']);
 const after=await fetch(origin+'/api/files/'+firstFile,{headers:{Cookie:ownerCookie}});assert.deepEqual(Buffer.from(await after.arrayBuffer()),sample);
 const replay=await submit(engineer,4000,duplicate,session);verifyOneApplication([repeats[0].receipt,replay.receipt]);assert.equal((await api('/api/hub/reports')).applications,3003);
 for(const receipt of [repeats[0].receipt,replay.receipt]){const response=await fetch(origin+'/api/applications/'+receipt);assert.equal(response.status,200);assert.equal((await response.json()).status,'accepted');}
 const logoutPage=await fetch(origin+'/api/auth/logout',{headers:{Cookie:ownerCookie}});assert.equal(logoutPage.status,200);assert.match(await logoutPage.text(),/form method="post"/);assert.ok(await api('/api/hub/overview'));
 const logout=await fetch(origin+'/api/auth/logout',{method:'POST',redirect:'manual',headers:{Cookie:ownerCookie,Origin:origin}});assert.equal(logout.status,303);assert.equal((await fetch(origin+'/api/hub/overview',{headers:{Cookie:ownerCookie}})).status,403);
 latencies.sort((a,b)=>a-b);
 console.log(JSON.stringify({status:'passed',existingBrowserChecks:20,seededOwnerBrowserJobPosting:true,browserBackForwardVerified:true,jobScopedBrowserPdfAndZip:true,internalCsvApi:true,oneClickShortlist:true,disconnectedInterviewGate:true,guidedStartingPoints:['blank','duplicate','template','request'],desktopAndMobileRealApplications:2,originalResumeBytes:sample.length,privateFiles:true,gradePersisted:80,reusableRubricGrade:70,autoPdfReading:true,overdueReviews:1000,syntheticLoadApplications:3000,applicationsWithPrivatePdfs:3003,pdfJourneyP95Ms:Math.round(resumeJourneys[Math.floor(resumeJourneys.length*.95)]),concurrentRequests:1000,localConnectRetries,concurrentPdfJourneys:100,duplicateHttpRequests:20,duplicateApplicationsCreated:1,persistedApplications:3003,restartAndPausedReplay:true,elapsedMs:Math.round(performance.now()-started),httpP95Ms:Math.round(latencies[Math.floor(latencies.length*.95)]),limits:'Real built Node server on local disk with production SQLite/files. Synthetic account session is seeded only in the isolated test database. This isolated run does not exercise live Google delivery/quotas, the hosted Docker image, Railway throughput or backup restoration.'},null,2));
}catch(error){console.error(JSON.stringify({phase,acceptedRequests,serverExitCode:child?.exitCode,serverLogs:logs.slice(-1500)}));throw error;}finally{if(browser)await browser.close();await stop();rmSync(dataDir,{recursive:true,force:true});}

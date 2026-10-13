// Real built Vinext Node server + production SQLite/files. Google remains disconnected.
// Staff identity is seeded ONLY in this isolated test database, never via an app bypass.
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes,createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {SQLiteD1Database} from '../lib/railway/sqlite.ts';

assert.ok(existsSync('dist/server/index.js'),'Run npm run build:railway first.');
const dataDir=mkdtempSync(path.join(realpathSync(tmpdir()),'aicl-railway-http-'));
const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const origin=`http://127.0.0.1:${port}`,rawSession=randomBytes(32).toString('hex');
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
try {
 await start(true);
 const executable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';browser=await chromium.launch({headless:true,...(existsSync(executable)?{executablePath:executable}:{})});
 const staff=await browser.newContext({viewport:{width:1440,height:1000}});await staff.addCookies([{name:'aicl_staff_session',value:rawSession,url:origin,httpOnly:true,sameSite:'Lax'}]);
 const page=await staff.newPage(),errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('request',r=>{if(r.url().includes('_rsc'))requests.push(r.url())});
 await page.goto(origin+'/team');const nav=page.getByRole('navigation',{name:'Hiring workspace'});await nav.waitFor();
 for(const width of [390,1440]){
  await page.setViewportSize({width,height:900});
  const navigate=async name=>{const menu=page.getByRole('button',{name:'Open workspace menu',exact:true});if(await menu.isVisible())await menu.click();await nav.getByRole('button',{name,exact:true}).click();await page.getByRole('heading',{name,exact:true}).waitFor();};
  for(let round=0;round<10;round++){
   await navigate('Applications');await navigate('Jobs');
   await page.goBack();await page.getByRole('heading',{name:'Applications',exact:true}).waitFor();
   await page.goForward();await page.getByRole('heading',{name:'Jobs',exact:true}).waitFor();
  }
  await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('button',{name:'Create blank job',exact:true}).click();await page.getByLabel('Job title',{exact:true}).fill('Unsaved navigation regression');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('heading',{name:'What should applicants send?',exact:true}).waitFor();
  await page.goBack();await page.getByRole('heading',{name:'Tell applicants about the job',exact:true}).waitFor();assert.equal(await page.getByLabel('Job title',{exact:true}).inputValue(),'Unsaved navigation regression');
  await page.goForward();await page.getByRole('heading',{name:'What should applicants send?',exact:true}).waitFor();await navigate('Jobs');
 }
 assert.deepEqual(requests,[],'Dashboard traversal must not start framework RSC requests');
 assert.deepEqual(errors,[],'Dashboard traversal must not abort a React render');
 // A destination outside the mounted workspace belongs to the browser/framework.
 await page.goto(origin+'/');await page.goto(origin+'/team?view=jobs');await page.getByRole('heading',{name:'Jobs',exact:true}).waitFor();await page.goBack();assert.equal(new URL(page.url()).pathname,'/');assert.equal(await page.locator('[data-hiring-workspace]').count(),0);
 const anonymous=await fetch(origin+'/team?view=settings');assert.ok(!(await anonymous.text()).includes('window.__aiclHubHistoryGuard=true'),'Anonymous Team page must not install authenticated workspace guard');
 console.log('Built navigation regression: 20 mobile/desktop Back-Forward cycles, wizard draft restoration, normal exit, no RSC requests or render errors.');
} finally {if(browser)await browser.close();await stop();rmSync(dataDir,{recursive:true,force:true});}

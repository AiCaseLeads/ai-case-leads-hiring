import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
for(const width of [390,1280])test(`staff sign-in explicitly opts into persistence at ${width}px`,async t=>{
 const modules={
 '@/lib/hub/auth':'export async function getHubMember(){return null}',
 '@/app/chatgpt-auth':"export const usesGoogleStaffAuth=()=>true;export const getChatGPTUser=async()=>null;export const chatGPTSignInPath=()=>'';export const chatGPTSignOutPath=()=>'';",
 '@/components/hub/dashboard':'export const HiringDashboard=()=>null;',
 };
 const result=await build({stdin:{contents:"import React from'react';import{createRoot}from'react-dom/client';import TeamPage from'./app/team/page';TeamPage({searchParams:Promise.resolve(Object.fromEntries(new URLSearchParams(location.search)))}).then(node=>createRoot(document.getElementById('root')).render(node));",loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'synthetic-auth',setup(builder){builder.onResolve({filter:/^@\//},args=>modules[args.path]?{path:args.path,namespace:'fixture'}:undefined);builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:modules[args.path],loader:'js'}));}}]});
 const css=(await postcss([tailwind()]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'})).css;
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?result.outputFiles[0].text:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script>`);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});const page=await browser.newPage({viewport:{width,height:900}});const url=`http://127.0.0.1:${server.address().port}/team?view=settings`;await page.goto(url);const remember=page.getByRole('checkbox',{name:'Keep me signed in for 30 days'});await remember.waitFor();assert.equal(await remember.isChecked(),false);assert.match(await page.locator('#remember-help').textContent(),/24 hours/);const contrast=await page.locator('#remember-help').evaluate(el=>{const rgb=getComputedStyle(el).color.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4});return 1.05/(.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]+.05)});assert.ok(contrast>=4.5,`Help text contrast ${contrast} must remain readable on white`);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(await page.locator('.team-sign-in').evaluate(form=>Object.fromEntries(new FormData(form))),{return_to:'/team?view=settings'});
 await remember.check();assert.deepEqual(await page.locator('.team-sign-in').evaluate(form=>Object.fromEntries(new FormData(form))),{return_to:'/team?view=settings',remember:'1'});mkdirSync('/tmp/staff-signin-audit',{recursive:true});await page.screenshot({path:`/tmp/staff-signin-audit/signin-${width}.png`,fullPage:true});await page.route('**/api/auth/google/start?**',route=>route.fulfill({body:'Synthetic authorization start'}));await page.getByRole('button',{name:'Sign in with Google',exact:true}).click();await page.waitForURL(/\/api\/auth\/google\/start/);assert.equal(new URL(page.url()).searchParams.get('remember'),'1');assert.equal(new URL(page.url()).searchParams.get('return_to'),'/team?view=settings');
});

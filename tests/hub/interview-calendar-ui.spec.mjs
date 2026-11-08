import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';

test('candidate can pick a local calendar date before choosing a time on desktop and mobile',async t=>{
  const {outputFiles}=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';import {InterviewBooking} from './components/hub/candidate';
    const params=new URLSearchParams(location.search);
    const slots=params.has('empty')?[]:['2030-12-31T23:30:00Z','2031-01-01T05:00:00Z','2031-01-02T03:00:00Z'];
    createRoot(document.getElementById('root')).render(<InterviewBooking token={'a'.repeat(64)} data={{kind:'interview',jobTitle:'Example engineer',status:params.has('preview')?'preview':'invited',slots}} reload={async()=>{}}/>);
  `},bundle:true,write:false,format:'iife',jsx:'automatic'});
  const css=readFileSync('components/hub/hub.css','utf8');
  const server=createServer((req,res)=>{
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(outputFiles[0].text);return;}
    res.setHeader("Content-Type","text/html");res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}${css}</style><main class="candidate-main" id="root"></main><script src="/app.js"></script>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  const url='http://127.0.0.1:'+server.address().port;
  for (const width of [320,390,1280]){
    const page=await browser.newPage({viewport:{width,height:800},timezoneId:'UTC'});
    page.setDefaultTimeout(4000);page.on("pageerror",e=>console.error(e));
    await page.goto(url);
    const date=page.getByRole('button',{name:'Tuesday, December 31, 2030'});
    await date.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('radio',{name:'11:30 PM UTC'}).check();
    assert.ok(await page.getByRole('button',{name:'Book interview'}).isEnabled());
    await page.getByRole('button',{name:'Next month'}).click();
    assert.equal(await page.getByRole('radio').count(),0);
    await page.getByRole('button',{name:'Wednesday, January 1, 2031'}).click();
    await page.getByRole('radio',{name:'5:00 AM UTC'}).waitFor();
    await page.getByRole('combobox',{name:'Your time zone'}).selectOption('America/Los_Angeles');
    await page.getByRole('button',{name:'Tuesday, December 31, 2030'}).click();
    await page.getByRole('radio',{name:'9:00 PM PST'}).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.goto(url+'?preview');
    await page.getByRole('button',{name:'Tuesday, December 31, 2030'}).click();
    await page.getByRole('radio',{name:'11:30 PM UTC'}).check();
    assert.ok(await page.getByRole('button',{name:'Book interview'}).isDisabled());
    await page.goto(url+'?empty');
    await page.getByRole('heading',{name:'No available times right now'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Next month'}).count(),0);
    await page.close();
  }
});

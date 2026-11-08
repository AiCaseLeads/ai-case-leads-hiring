import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';

test('candidate can pick a local calendar date before choosing a time on desktop and mobile',async t=>{
  const {outputFiles}=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';import {SecureCandidatePage} from './components/hub/candidate';
    createRoot(document.getElementById('root')).render(<SecureCandidatePage token={'a'.repeat(64)} kind="interview"/>);
  `},bundle:true,write:false,format:'iife',jsx:'automatic'});
  const css=readFileSync('app/globals.css','utf8').replace(/^@import .+?;$/gm,'')+readFileSync('components/hub/hub.css','utf8');
  const server=createServer((req,res)=>{
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(outputFiles[0].text);return;}
    res.setHeader("Content-Type","text/html");res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}${css}</style><div id="root"></div><script src="/app.js"></script>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  const url='http://127.0.0.1:'+server.address().port;
  for (const width of [320,390,1280]){
    const page=await browser.newPage({viewport:{width,height:800},timezoneId:'UTC'});
    page.setDefaultTimeout(4000);page.on("pageerror",e=>console.error(e));
    let booking=null;
    let polls=0;
    await page.route('**/api/candidate/*',async route=>{
      const params=new URL(page.url()).searchParams;
      const slots=params.has('empty')?[]:params.has('dst')?['2030-11-03T05:30:00Z','2030-11-03T06:30:00Z']:['2030-12-31T23:30:00Z','2031-01-01T05:00:00Z','2031-01-02T03:00:00Z'];
      if(route.request().method()==='POST'){
        booking=route.request().postDataJSON();
        assert.equal(booking.action,'book');
        await route.fulfill({status:202,json:{data:{status:'pending',start:booking.start,timeZone:booking.timeZone}}});
        return;
      }
      const status=params.get('record') || (params.has('preview')?'preview':booking&&!params.has('dst')?(++polls===1?'pending':'booked'):'invited');
      await route.fulfill({json:{data:{kind:'interview',jobTitle:'Example engineer',status,slots,interview:booking&&!params.has('dst')?{start:booking.start,timeZone:booking.timeZone,meetUrl:status==='booked'?'https://meet.google.com/example':undefined}:undefined}}});
    });
    await page.goto(url);
    const date=page.getByRole('button',{name:'Tuesday, December 31, 2030'});
    await date.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('radio',{name:'11:30 PM',exact:true}).check();
    assert.ok(await page.getByRole('button',{name:'Book interview'}).isEnabled());
    await page.getByRole('button',{name:'Next month'}).click();
    assert.equal(await page.getByRole('radio').count(),0);
    await page.getByRole('button',{name:'Wednesday, January 1, 2031'}).click();
    await page.getByRole('radio',{name:'5:00 AM',exact:true}).waitFor();
    await page.getByRole('combobox',{name:'Your time zone'}).selectOption('America/Los_Angeles');
    await page.getByRole('button',{name:'Tuesday, December 31, 2030'}).click();
    await page.getByRole('radio',{name:'9:00 PM',exact:true}).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(process.env.BOOKING_SCREENSHOT_DIR) await page.screenshot({path:process.env.BOOKING_SCREENSHOT_DIR+'/booking-'+width+'.png',fullPage:true});
    await page.goto(url+'?preview');
    assert.equal(await page.getByRole('combobox',{name:'Your time zone'}).inputValue(),'America/Los_Angeles');
    await page.getByRole('button',{name:'Tuesday, December 31, 2030'}).click();
    await page.getByRole('radio',{name:'3:30 PM',exact:true}).check();
    assert.ok(await page.getByRole('button',{name:'Book interview'}).isDisabled());
    await page.goto(url+'?empty');
    await page.getByRole('heading',{name:'No available times right now'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Next month'}).count(),0);
    if(width===390 || width===1280){
      await page.goto(url);
      await page.getByRole('button',{name:'Tuesday, December 31, 2030'}).click();
      await page.getByRole('radio',{name:'3:30 PM',exact:true}).check();
      await page.getByRole('button',{name:'Book interview'}).click();
      await page.getByRole('heading',{name:'Confirming your interview'}).waitFor();
      assert.equal(await page.getByRole('link',{name:'Join Google Meet'}).count(),0);
      await page.getByRole('heading',{name:'Your interview is confirmed'}).waitFor({timeout:8000});
      assert.equal(booking.timeZone,'America/Los_Angeles');
      await page.getByRole('link',{name:'Join Google Meet'}).waitFor();
      assert.ok(await page.getByText(/Please join on time/).isVisible());
      assert.equal(await page.getByRole('radio').count(),0);
      if(process.env.BOOKING_SCREENSHOT_DIR) await page.screenshot({path:process.env.BOOKING_SCREENSHOT_DIR+'/confirmed-'+width+'.png',fullPage:true});
      await page.getByText('Reschedule interview',{exact:true}).click();
      await page.getByRole('combobox',{name:'Your time zone'}).waitFor();
      await page.goto(url+'?dst');
      await page.getByRole('combobox',{name:'Your time zone'}).selectOption('America/New_York');
      await page.getByRole('button',{name:'Sunday, November 3, 2030'}).click();
      await page.getByRole('radio',{name:'1:30 AM GMT-4',exact:true}).check();
      await page.getByRole('radio',{name:'1:30 AM GMT-5',exact:true}).check();
      for (const [record,title] of [['past','Your interview time has passed'],['unlinked','Check your booking with the hiring team'],['cancelled','Interview cancelled']]){
        await page.goto(url+'?record='+record);
        await page.getByRole('heading',{name:title}).waitFor();
        assert.equal(await page.getByRole('link',{name:'Join Google Meet'}).count(),0);
        assert.equal(await page.getByRole('button',{name:'Book interview'}).count(),0);
        assert.equal(await page.getByText('Reschedule interview',{exact:true}).count(),0);
      }
    }
    await page.close();
  }

  // The AWS origin has no trusted IP zone. The browser can quietly resolve an
  // already-permitted location, even when the device clock is set to another zone.
  const localContext=await browser.newContext({timezoneId:'UTC',geolocation:{latitude:34.0522,longitude:-118.2437},permissions:['geolocation']});
  t.after(()=>localContext.close());
  const localPage=await localContext.newPage();
  const slots=['2030-12-31T23:30:00Z'];
  const posts=[];
  await localPage.route('**/api/candidate/*',route=>{
    if(route.request().method()==='POST') posts.push(route.request().postDataJSON());
    return route.fulfill({json:{data:{kind:'interview',jobTitle:'Example',status:'invited',slots}}});
  });
  await localPage.goto(url);
  await localPage.waitForFunction(()=>document.querySelector('.booking-zone select')?.value==='America/Los_Angeles');
  await localPage.getByRole('combobox',{name:'Your time zone'}).selectOption('America/New_York');
  await localPage.reload();
  assert.equal(await localPage.getByRole('combobox',{name:'Your time zone'}).inputValue(),'America/New_York');
  await localPage.getByRole('button',{name:'Use my location'}).click();
  await localPage.waitForFunction(()=>document.querySelector('.booking-zone select')?.value==='America/Los_Angeles');
  await localPage.getByRole('button',{name:'Tuesday, December 31, 2030'}).click();
  await localPage.getByRole('radio',{name:'3:30 PM',exact:true}).check();
  await localPage.getByRole('button',{name:'Book interview'}).click();
  assert.deepEqual(posts,[{action:'book',start:slots[0],timeZone:'America/Los_Angeles'}]);

  // A first visit must not automatically prompt, and a denial leaves the picker usable.
  const fallback=await browser.newPage({timezoneId:'Asia/Tokyo'});
  t.after(()=>fallback.close());
  await fallback.addInitScript(()=>{
    window.locationRequests=0;
    Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition:(_ok,error)=>{
      window.locationRequests++; error({code:1});
    }}});
  });
  await fallback.route('**/api/candidate/*',route=>route.fulfill({json:{data:{
    kind:'interview',jobTitle:'Example',status:'invited',slots,
    ...(fallback.url().includes('edge')?{locationTimeZone:'Asia/Manila'}:{}),
  }}}));
  await fallback.goto(url);
  const zone=fallback.getByRole('combobox',{name:'Your time zone'});
  assert.equal(await zone.inputValue(),'Asia/Tokyo');
  assert.equal(await fallback.evaluate(()=>window.locationRequests),0);
  await fallback.getByRole('button',{name:'Use my location'}).click();
  await fallback.getByText('Location is unavailable. Choose your time zone manually.').waitFor();
  assert.equal(await zone.inputValue(),'Asia/Tokyo');
  await fallback.goto(url+'?edge');
  assert.equal(await zone.inputValue(),'Asia/Manila');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';

test('team lists and live saved views are usable at phone and desktop widths',async t=>{
  const {outputFiles}=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {ApplicantCollections} from './components/hub/applicant-collections';
    import {ListReviewInbox} from './components/hub/list-review-inbox';
    function Fixture(){
      const [filter,setFilter]=useState('qualification=pass&sort=newest');
      const [ids,setIds]=useState(['a','b']);
      return <main className="hub-main"><ApplicantCollections filter={filter} selectedIds={ids} onApply={setFilter} disabled={false} allMatching={false}/>
      <ListReviewInbox/><output aria-label="Queue filters">{filter}</output></main>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);`},bundle:true,write:false,format:'iife',jsx:'automatic'});
  const styles=readFileSync('components/hub/hub.css','utf8');
  const server=createServer((req,res)=>{
    if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(outputFiles[0].text);return;}
    res.setHeader('Content-Type','text/html');
    res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}main{padding:8px}'+styles+'</style><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const executable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser=await chromium.launch({headless:true,...(existsSync(executable)?{executablePath:executable}:{})});
  t.after(async()=>{await browser.close();await new Promise(r=>{server.close(r);server.closeAllConnections();});});
  for(const width of [320,390,1280]){
    const page=await browser.newPage({viewport:{width,height:800}});
    page.setDefaultTimeout(4000);
    page.on('pageerror',err=>console.log(err.message));
    const rows=[];
    const writes=[];
    await page.route('**/api/hub/collections*',async route=>{
      const req=route.request(),url=new URL(req.url());
      const data=await (async()=>{
        if(url.searchParams.has('compare'))return ['a','b'].map((id,i)=>({id,name:'Candidate '+(i+1),jobTitle:'Role '+(i+1),stage:'Screening',qualification:'pass',salary:'1000 USD',concerns:'Discuss portfolio'}));
        if(req.method()==='GET')return rows;
        const cmd=req.postDataJSON();writes.push(cmd);
        if(cmd.action==='create'){const id=cmd.kind==='view'?'v':'l';rows.push({...cmd,id,owner:'test@example.invalid',owned:true,revision:1,updatedAt:0,size:cmd.ids?.length||0});return {id};}
        throw new Error('Unexpected mutation');
      })();
      await route.fulfill({json:{data}});
    });
    let review=null, completed=false;
    await page.route('**/api/hub/list-reviews**',async route=>{
      const req=route.request(),url=new URL(req.url());
      let data;
      if(req.method()==='POST'){
        const cmd=req.postDataJSON();
        if(cmd.action==='request')review=cmd; else if(cmd.action==='review'){assert.equal(cmd.feedback,'Strong portfolio.');completed=true;}
        data={id:cmd.requestId};
      } else if(url.pathname.endsWith('/reviewers')) data=['reviewer@example.invalid'];
      else {
        const summary=review?{id:review.requestId,listId:'l',name:'Monday finalists',requester:'test@example.invalid',reviewer:review.reviewer,prompt:review.prompt,total:2,completed:completed?1:0}:null;
        data=url.pathname.endsWith('/list-reviews')?{items:summary?[summary]:[],page:1,total:summary?1:0}
          :{summary,items:['a','b'].map((a,i)=>({applicationId:a,name:'Candidate '+(i+1),jobTitle:'Role '+(i+1),stage:'Screening',feedback:i===0&&completed?'Strong portfolio.':'',reviewedAt:i===0&&completed?123:null})),canRespond:true};
      }
      await route.fulfill({json:{data}});
    });
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.getByRole('button',{name:'Saved views',exact:true}).click();
    await page.getByRole('button',{name:'Save current view',exact:true}).click();
    await page.getByRole('textbox',{name:'View name'}).fill('Qualified and new');
    await page.getByRole('button',{name:'Save view',exact:true}).click();
    await page.getByRole('button',{name:'Open view',exact:true}).waitFor();
    assert.match(writes[0].creationId,/^[a-f0-9-]{36}$/);
    assert.deepEqual(writes[0],{action:'create',creationId:writes[0].creationId,kind:'view',name:'Qualified and new',visibility:'personal',query:'qualification=pass&sort=newest'});
    await page.getByRole('button',{name:'Add to list',exact:true}).click();
    await page.getByRole('button',{name:'Create list',exact:true}).click();
    await page.getByRole('textbox',{name:'List name'}).fill('Monday finalists');
    await page.getByLabel('Visibility').selectOption('team');
    await page.getByRole('button',{name:'Create list',exact:true}).click();
    await page.getByRole('button',{name:'Open list',exact:true}).click();
    assert.notEqual(writes[1].creationId,writes[0].creationId);
    assert.deepEqual(writes[1],{action:'create',creationId:writes[1].creationId,kind:'list',name:'Monday finalists',visibility:'team',ids:['a','b']});
    await page.getByRole('button',{name:'Compare selected (2)'}).click();
    await page.getByRole('heading',{name:'Candidate 2'}).waitFor();
    assert.equal(await page.getByText('Discuss portfolio',{exact:true}).count(),2);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow at '+width);
    assert.equal(new URLSearchParams(await page.getByLabel('Queue filters').textContent()).get('listId'),'l');
    await page.getByRole('button',{name:'Request feedback',exact:true}).click();
    await page.getByRole('combobox',{name:/Reviewer/i}).selectOption('reviewer@example.invalid');
    await page.getByLabel('Question for reviewer (optional)').fill('Review these two portfolios.');
    await page.getByRole('button',{name:'Request review',exact:true}).click();
    await page.getByText(/Review requested from reviewer/).waitFor();
    assert.deepEqual(review.ids,['a','b']);
    // A teammate reopens Home to work through the review request.
    await page.reload();
    await page.getByRole('button',{name:'List reviews · 1 awaiting you'}).click();
    await page.getByRole('button',{name:/Monday finalists.*0 of 2 reviewed/}).click();
    await page.getByLabel('Internal feedback (optional)').first().fill('Strong portfolio.');
    await page.getByRole('button',{name:'Mark reviewed',exact:true}).first().click();
    await page.getByText('Strong portfolio.',{exact:true}).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'review inbox overflow at '+width);
    await page.close();
  }
});

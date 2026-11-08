import test from "node:test";
import assert from "node:assert/strict";
import {parseResponseEntry,ResponseEntryCounter} from "../../lib/hiring/response-entry";
import {parseApplication} from "../../lib/hiring/validation";
import {createStore,jobInput,applicationInput} from "../hub/fixtures";

test("entry snapshots freeze elapsed durations, deduplicate browser paste phases and store only large edit lengths",()=>{
  const tracker=new ResponseEntryCounter(100);
  tracker.paste("explain","paste",250);
  tracker.paste("explain","beforeinput",251);
  tracker.paste("explain","input",253);
  tracker.paste("explain","paste",255);
  tracker.edit("explain",4,300);
  tracker.edit("explain",80,401);
  const entry=tracker.snapshot(1000);
  assert.deepEqual(entry,{version:1,formElapsedMs:900,firstEditToSubmitMs:700,
    fields:[{path:"explain",pasteAttempts:2,largeInsertions:1,largestInsertionChars:80}]});
  tracker.edit("explain",400,1200);
  assert.equal(entry.fields[0].largestInsertionChars,80);
  assert.equal(new ResponseEntryCounter(1).snapshot(500).firstEditToSubmitMs,null);
});

test("submission accepts old, missing and invalid telemetry, and strips arbitrary extra keys",()=>{
  const input=applicationInput(crypto.randomUUID());
  assert.equal(parseApplication(input).responseEntry,undefined);
  const valid=new ResponseEntryCounter(100).snapshot(1000);
  for(const invalid of [{...valid,formElapsedMs:-10},{...valid,firstEditToSubmitMs:1500},{...valid,fields:[{path:"x",rawKeys:"private"}]},{...valid,fields:Array(104).fill({})}])
    assert.equal(parseApplication({...input,responseEntry:invalid}).responseEntry,undefined);
  assert.deepEqual(parseResponseEntry({...valid,rawText:"discard"}),valid);
});

test("stored observations apply to configured written questions and a retry cannot overwrite the accepted snapshot",async()=>{
  const {store,database}=createStore();
  try {
    const inputJob=jobInput();inputJob.fields.push({type:"LongText",path:"why",title:"Why?",required:false});
    const job=await store.saveJob(inputJob);
    const input=applicationInput(job.id);
    const counter=new ResponseEntryCounter(0);
    for(const path of ["_systemfield_name","experience","why","invented"]) counter.paste(path,"paste",1200);
    input.fieldSubmissions.push({path:"why",value:"Because of my experience."});
    const entry=counter.snapshot(5000);
    const {id}=await store.acceptApplication({...input,responseEntry:entry});
    const original=database.prepare("SELECT response_entry_json AS entry FROM hub_applications WHERE id=?").get(id)!.entry as string;
    assert.deepEqual(JSON.parse(original).fields.map((r:{path:string})=>r.path),["why"]);
    await store.acceptApplication({...input,responseEntry:{...entry,formElapsedMs:1}});
    assert.equal(database.prepare("SELECT response_entry_json AS entry FROM hub_applications WHERE id=?").get(id)!.entry,original);
    const historical=await store.acceptApplication(applicationInput(job.id));
    assert.equal(database.prepare("SELECT response_entry_json AS entry FROM hub_applications WHERE id=?").get(historical.id)!.entry,null);
  } finally {database.close();}
});

import {test} from "node:test";
import assert from "node:assert/strict";
import {createStore,jobInput,applicationInput} from "./fixtures";
import {processResponseCheckBatch} from "../../lib/response-checks/worker";
import {getResponseChecks,getResponseCoverage} from "../../lib/response-checks/store";
import {DetectorError} from "../../lib/response-checks/gptzero";
import type {HubStore} from "../../lib/hub/store";

const key=async()=>"synthetic-test-key";
const text="During the migration our team measured worker latency across multiple regions and compared database write throughput before gradually shifting production traffic. ".repeat(6);
const submit=async(store:HubStore,jobId:string,email:string,answer:string)=>{
  const input=applicationInput(jobId);
  const emailField=input.fieldSubmissions.find(item=>item.path==="_systemfield_email")!;
  emailField.value=email;
  input.fieldSubmissions.push({path:"question1",value:answer});
  return (await store.acceptApplication(input)).id;
};
async function fixture() {
  const {store,database}=createStore(),input=jobInput();
  input.fields.push({path:"question1",type:"LongText",title:"Describe the work you personally did.",required:false});
  const job=await store.saveJob(input);
  return {store,database,id:job.id};
}
test("backfill indexes all written answers locally, caches matching copy and separates identities",async()=>{
  const {store,id,database}=await fixture();
  const first=await submit(store,id,"same@example.invalid",text);
  const repeated=await submit(store,id,"SAME@example.invalid",text);
  const other=await submit(store,id,"other@example.invalid",text);
  const short=await submit(store,id,"short@example.invalid","I managed the campaign.");
  const noWriting=await store.acceptApplication(applicationInput(id));
  assert.equal((await getResponseChecks(store,first)).answers[0].text,text.trim());
  let requests=0;
  const scan=async()=>{requests++;return {classification:"MIXED" as const,confidence:"medium"};};
  await Promise.all([processResponseCheckBatch({store,key,scan}),processResponseCheckBatch({store,key,scan})]);
  assert.equal(requests,1);
  const checked=await getResponseChecks(store,first);
  assert.equal(checked.status,"ready");assert.equal(checked.answers[0].classification,"MIXED");
  assert.deepEqual(checked.answers[0].matches.map(m=>m.applicationId),[other]);
  assert.ok(checked.answers[0].matches[0].passage.length>40);
  assert.equal((await getResponseChecks(store,short)).answers[0].status,"too_short");
  assert.equal((await getResponseChecks(store,noWriting.id)).status,"no_written_answers");
  const coverage=await getResponseCoverage(store);
  assert.deepEqual([coverage.total,coverage.indexed,coverage.ready,coverage.noWritten,coverage.scannedAnswers,coverage.tooShort,coverage.pending],[5,5,4,1,3,1,0]);
  await store.setSetting("application_trash:"+other,{deletedAt:1});
  assert.deepEqual((await getResponseChecks(store,repeated)).answers[0].matches,[]);
  assert.equal((await getResponseCoverage(store)).total,4);
  await assert.rejects(getResponseChecks(store,other));
  database.close();
});
test("unconfigured and rate-limited detectors preserve local coverage, resume once and never send contacts",async()=>{
  const {store,id,database}=await fixture();
  const first=await submit(store,id,"other@example.invalid",text+" Contact Synthetic Applicant at other@example.invalid, +1 555 555 0987, or https://example.invalid/secret.");
  await processResponseCheckBatch({store,key:async()=>null,scan:async()=>{throw Error("unexpected");}});
  const local=await getResponseCoverage(store);assert.equal(local.pending,1);assert.equal(local.indexed,1);assert.equal(local.detectorState,"unconfigured");
  let now=100000,calls=0;
  const scan=async(text:string)=>{
    calls++;
    assert.doesNotMatch(text,/synthetic applicant|example\.invalid|555 555 0987/i);
    if(calls===1)throw new DetectorError(429,90);
    return {classification:"UNDETERMINED" as const,confidence:null};
  };
  const deps={store,key,scan,now:()=>now};
  await processResponseCheckBatch(deps);
  let coverage=await getResponseCoverage(store);
  assert.equal(coverage.retryAt,now+90_000);assert.equal(coverage.detectorState,"paused");
  await processResponseCheckBatch(deps);assert.equal(calls,1);
  now+=90_001;await processResponseCheckBatch(deps);
  assert.equal(calls,2);coverage=await getResponseCoverage(store);
  assert.equal(coverage.ready,1);assert.equal(coverage.pendingAnswers,0);
  assert.equal((await getResponseChecks(store,first)).answers[0].classification,"UNDETERMINED");
  database.close();
});
test("authentication pauses and a replacement key can resume; bad documents stop retrying",async()=>{
  const {store,id,database}=await fixture(),app=await submit(store,id,"reader@example.invalid",text);
  let calls=0;
  const scan=async()=>{calls++;throw new DetectorError(calls===1?401:422,60);};
  await processResponseCheckBatch({store,key,scan});
  assert.equal((await getResponseCoverage(store)).detectorState,"paused");
  await processResponseCheckBatch({store,key,scan});assert.equal(calls,1);
  await processResponseCheckBatch({store,key:async()=>"replacement-synthetic",scan});
  assert.equal(calls,2);assert.equal((await getResponseChecks(store,app)).status,"partial");
  assert.equal((await getResponseCoverage(store)).unavailable,1);
  database.close();
});

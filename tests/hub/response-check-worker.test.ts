import {test} from "node:test";
import assert from "node:assert/strict";
import {createStore,jobInput,applicationInput} from "./fixtures";
import {processResponseCheckBatch} from "../../lib/response-checks/worker";
import {writtenAnswers} from "../../lib/response-checks/answers";
import {getResponseChecks,getResponseCoverage} from "../../lib/response-checks/store";
import {DetectorError} from "../../lib/response-checks/gptzero";
import type {HubStore} from "../../lib/hub/store";

const allowance=async()=>1_000_000;
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
  await Promise.all([processResponseCheckBatch({store,allowance,key,scan}),processResponseCheckBatch({store,allowance,key,scan})]);
  assert.equal(requests,2);
  const checked=await getResponseChecks(store,first);
  const compact=await getResponseChecks(store,first,{includeText:false});
  assert.equal(Object.hasOwn(compact.answers[0],"text"),false);
  assert.deepEqual(compact.answers[0].matches,checked.answers[0].matches);
  assert.equal(checked.status,"ready");assert.equal(checked.answers[0].classification,"MIXED");
  assert.deepEqual(checked.answers[0].matches.map(m=>m.applicationId),[other]);
  assert.ok(checked.answers[0].matches[0].passage.length>40);
  assert.equal((await getResponseChecks(store,short)).answers[0].status,"ready");
  assert.equal((await getResponseChecks(store,noWriting.id)).status,"no_written_answers");
  const coverage=await getResponseCoverage(store);
  assert.deepEqual([coverage.total,coverage.indexed,coverage.ready,coverage.noWritten,coverage.scannedAnswers,coverage.tooShort,coverage.pending],[5,5,4,1,4,0,0]);
  await store.setSetting("application_trash:"+other,{deletedAt:1});
  assert.deepEqual((await getResponseChecks(store,repeated)).answers[0].matches,[]);
  assert.equal((await getResponseCoverage(store)).total,4);
  await assert.rejects(getResponseChecks(store,other));
  database.close();
});
test("unconfigured and rate-limited detectors preserve local coverage, resume once and never send contacts",async()=>{
  const {store,id,database}=await fixture();
  const first=await submit(store,id,"other@example.invalid",text+" Contact Synthetic Applicant at other@example.invalid, +1 555 555 0987, or https://example.invalid/secret.");
  await processResponseCheckBatch({store,allowance,key:async()=>null,scan:async()=>{throw Error("unexpected");}});
  const local=await getResponseCoverage(store);assert.equal(local.pending,1);assert.equal(local.indexed,1);assert.equal(local.detectorState,"unconfigured");
  let now=100000,calls=0;
  const scan=async(text:string)=>{
    calls++;
    assert.doesNotMatch(text,/synthetic applicant|example\.invalid|555 555 0987/i);
    if(calls===1)throw new DetectorError(429,90);
    return {classification:"UNDETERMINED" as const,confidence:null};
  };
  const deps={store,allowance,key,scan,now:()=>now};
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
  await processResponseCheckBatch({store,allowance,key,scan});
  assert.equal((await getResponseCoverage(store)).detectorState,"paused");
  await processResponseCheckBatch({store,allowance,key,scan});assert.equal(calls,1);
  await processResponseCheckBatch({store,allowance,key:async()=>"replacement-synthetic",scan});
  assert.equal(calls,2);assert.equal((await getResponseChecks(store,app)).status,"partial");
  assert.equal((await getResponseCoverage(store)).unavailable,1);
  database.close();
});

test("detector redaction removes bare domains and name components without changing the stored answer",()=>{
  const original="I am Eliana. Look for Calderón on linkedin.com/in/eliana-calderon and portfolio.demo.co.uk?ref=profile or eliana.dev. I work in IT and report quarterly.";
  const [answer]=writtenAnswers({id:"app",name:"Eliana IT Calderón",email:"person@example.invalid",
    fields_json:JSON.stringify([{path:"prose",type:"LongText",title:"What did you do?"}]),
    answers_json:JSON.stringify([{path:"prose",value:original}])});
  assert.equal(answer.text,original);
  assert.doesNotMatch(answer.sanitized,/eliana|calderón|linkedin|portfolio|ref=|\.dev/iu);
  assert.match(answer.sanitized,/work in IT/);
});

test("zero or unreadable allowance leaves all results pending without paid scans; empty queues skip usage preflight",async()=>{
  const {store,id,database}=await fixture();
  let usageCalls=0,paid=0;
  const scan=async()=>{paid++;return {classification:"MIXED" as const,confidence:null};};
  const zero=async()=>{usageCalls++;return 0;};
  await processResponseCheckBatch({store,key,scan,allowance:zero});
  assert.equal(usageCalls,0);
  await submit(store,id,"reader@example.invalid",text);
  await processResponseCheckBatch({store,key,scan,allowance:zero});
  assert.equal(usageCalls,1);assert.equal(paid,0);
  let coverage=await getResponseCoverage(store);
  assert.equal(coverage.pendingAnswers,1);assert.equal(coverage.pauseReason,"quota");
  const offline=async()=>{throw new DetectorError(503,60);};
  await processResponseCheckBatch({store,key:async()=>"new-credential",scan,allowance:offline});
  coverage=await getResponseCoverage(store);
  assert.equal(paid,0);assert.equal(coverage.pendingAnswers,1);assert.equal(coverage.pauseReason,"allowance_unavailable");
  database.close();
});

test("a shared allowance funds one answer across concurrent workers and keeps the remainder retryable",async()=>{
  const {store,id,database}=await fixture();
  await submit(store,id,"one@example.invalid",text+" First.");
  await submit(store,id,"two@example.invalid",text+" Other.");
  const words=(text+" First.").trim().split(/\s+/u).length;
  let usageCalls=0,paid=0,now=1000;
  const deps={store,key,now:()=>now,allowance:async()=>{usageCalls++;return words;},scan:async()=>{
    paid++;await new Promise(resolve=>setTimeout(resolve,10));return {classification:"MIXED" as const,confidence:null};
  }};
  await Promise.all([processResponseCheckBatch(deps),processResponseCheckBatch(deps)]);
  let coverage=await getResponseCoverage(store);
  assert.equal(usageCalls,1);assert.equal(paid,1);assert.equal(coverage.scannedAnswers,1);
  assert.equal(coverage.pendingAnswers,1);assert.equal(coverage.pauseReason,"quota");
  now=coverage.retryAt!+1;
  await processResponseCheckBatch(deps);
  coverage=await getResponseCoverage(store);
  assert.equal(paid,2);assert.equal(coverage.pendingAnswers,0);
  await processResponseCheckBatch(deps);
  assert.equal(usageCalls,2);
  database.close();
});

test("historical per-answer skips are revisited exactly once, preserve cached results, and respect provider refusals",async()=>{
  const {store,id,database}=await fixture();
  const oldReady=await submit(store,id,"one@example.invalid",text);
  const short=await submit(store,id,"two@example.invalid","I designed that campaign and ran the entire launch.");
  const tiny=await submit(store,id,"three@example.invalid","My example.");
  const yes=await submit(store,id,"four@example.invalid","Yes.");
  const link=await submit(store,id,"five@example.invalid","https://private.example/portfolio");
  // Snapshot what the old worker stored: the long response already has a
  // prediction, but the historical short answers have a null reference.
  await processResponseCheckBatch({store,key:async()=>null});
  await store.stmt("UPDATE hub_response_detector_cache SET status='ready',classification='HUMAN_ONLY',confidence='medium'").run();
  await store.stmt("UPDATE hub_response_answers SET answer_hash=NULL WHERE application_id<>?",oldReady).run();
  await store.stmt("DELETE FROM hub_response_detector_cache WHERE answer_hash NOT IN (SELECT answer_hash FROM hub_response_answers WHERE answer_hash IS NOT NULL)").run();
  await store.stmt("DELETE FROM hub_settings WHERE key='response_checks_expanded_coverage_v1'").run();
  const scans:string[]=[];
  const scan=async(prose:string)=>{
    scans.push(prose);
    if(prose==="My example.")throw new DetectorError(400,60,"too_short");
    return {classification:"MIXED" as const,confidence:"low"};
  };
  for(let i=0;i<3;i++)await processResponseCheckBatch({store,allowance,key,scan});
  assert.deepEqual(scans.sort(),["I designed that campaign and ran the entire launch.","My example.","Yes."]);
  const read=async(id:string)=>(await getResponseChecks(store,id)).answers[0];
  assert.equal((await read(oldReady)).classification,"HUMAN_ONLY");
  assert.equal((await read(short)).classification,"MIXED");
  assert.equal((await read(tiny)).status,"too_short");assert.equal((await read(tiny)).classification,null);
  assert.equal((await read(yes)).status,"ready");assert.equal((await read(link)).status,"not_prose");
  const coverage=await getResponseCoverage(store);
  assert.deepEqual([coverage.indexed,coverage.scannedAnswers,coverage.tooShort,coverage.notProse,coverage.unavailable,coverage.pendingAnswers],[5,3,1,1,0,0]);
  database.close();
});

test("private contact questions stay local for both text types and old report rows disappear",async()=>{
  const privateLabels=["Who referred you?","Mailing address","What is your current company and title?","Provide your professional reference contact details","Please provide your date of birth","Government ID number"];
  const source={id:"test",name:"Tester",email:"person@example.invalid"};
  for (const type of ["String","LongText"]){
    const fields=[...privateLabels,"How did you address an issue at your current company?"].map((title,i)=>({path:"f"+i,title,type}));
    const row={...source,fields_json:JSON.stringify(fields),answers_json:JSON.stringify(fields.map(f=>({path:f.path,value:"A written answer."})))};
    assert.deepEqual(writtenAnswers(row).map(a=>a.title),["How did you address an issue at your current company?"]);
  }
  const {store,database}=createStore();
  const input=jobInput();
  input.fields.push({path:"question1",type:"LongText",title:"Mailing address",required:false});
  const job=await store.saveJob(input);
  const id=await submit(store,job.id,"tester@example.invalid","12 Elm Street");
  await store.stmt("INSERT INTO hub_response_index(application_id,indexed_at) VALUES(?,5)",id).run();
  await store.stmt("INSERT INTO hub_response_detector_cache(answer_hash,status,updated_at) VALUES('old','pending',1)").run();
  await store.stmt("INSERT INTO hub_response_answers(application_id,path,title,words,answer_hash) VALUES(?,'question1','Mailing address',3,'old')",id).run();
  await store.stmt("INSERT INTO hub_response_passages(application_id,path,passage_hash,excerpt) VALUES(?,'question1','hash','private')",id).run();
  await processResponseCheckBatch({store,key,allowance,scan:async()=>{assert.fail("sent private data");}});
  assert.equal((await getResponseChecks(store,id)).status,"no_written_answers");
  assert.equal((await getResponseCoverage(store)).noWritten,1);
  assert.equal((await store.stmt("SELECT COUNT(*) n FROM hub_response_passages WHERE application_id=?",id).first<{n:number}>())?.n,0);
  database.close();
});

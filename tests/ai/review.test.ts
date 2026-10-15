import assert from "node:assert/strict";
import test from "node:test";
import { createStore,MANAGER,RECRUITER,jobInput,applicationInput } from "../hub/fixtures";
import { handleAiConfig,handleAiReview,type AiDependencies } from "../../lib/ai/http";
import { generateReview,validateReview,reviewNote,MODEL,type Review } from "../../lib/ai/review";
const key="sk-or-"+"testsecret".repeat(4),encryptionKey="c".repeat(64);
const origin="https://jobs.example.invalid";
function request(path:string,body?:unknown,method=body?"POST":"GET",source=origin){return new Request(`${origin}/api/ai/${path}`,{method,headers:{"content-type":"application/json",origin:source},...(body?{body:JSON.stringify(body)}:{})});}
const review:Review={criteria:[{criterion:"Build React applications",status:"evidence_found",explanation:"The supplied resume claims React experience; verify in the interview.",citations:[{source:"resume",quote:"Built React applications for two years."}]}],checks:[{question:"Describe a React application you built and how you tested it.",citations:[]}]};
const sources={resume:"Built React applications for two years.",linkedin:"",answers:""};
const response=()=>Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({...review,criteria:review.criteria.map(item=>({...item,citations:[{id:"resume:0"}]}))})}}]});
async function fixture(fetcher:typeof fetch=async()=>response()){
  const f=createStore();
  const job=await f.store.saveJob(jobInput());
  const {id}=await f.store.acceptApplication(applicationInput(job.id));
  const app=await f.store.getApplication(id);
  const deps:AiDependencies={store:f.store,encryptionKey,fetcher};
  const input={applicationId:id,expectedRevision:app.revision,resumeText:sources.resume,linkedinText:"",jobCriteria:"Build React applications",consent:true};
  assert.equal((await handleAiConfig(request("config",{apiKey:key,enabled:true},"PATCH"),MANAGER,deps)).status,200);
  return {...f,deps,input,app};
}
test("AI config is inactive by default, admin only, same-origin, encrypted and write-only",async()=>{
  const f=createStore(),deps={store:f.store,encryptionKey};
  assert.equal((await handleAiConfig(request("config"),null,deps)).status,403);
  const status=await (await handleAiConfig(request("config"),RECRUITER,deps)).json() as {data:{enabled:boolean;configured:boolean}};
  assert.equal(status.data.enabled,false);assert.equal(status.data.configured,false);
  assert.equal((await handleAiConfig(request("config",{apiKey:key,enabled:true},"PATCH"),RECRUITER,deps)).status,403);
  assert.equal((await handleAiConfig(request("config",{apiKey:key,enabled:true},"PATCH","https://evil.invalid"),MANAGER,deps)).status,403);
  assert.equal((await handleAiConfig(request("config",{enabled:true},"PATCH"),MANAGER,deps)).status,422);
  const saved=await handleAiConfig(request("config",{apiKey:key,enabled:true},"PATCH"),MANAGER,deps);
  assert.equal(saved.status,200);assert.ok(!(await saved.text()).includes(key));
  const stored=await f.store.setting<{sealedKey:string;updatedBy:string}>("ai_openrouter_config_v1",{} as never);
  assert.match(stored.sealedKey,/^v1\./);assert.equal(stored.updatedBy,MANAGER.email);assert.ok(!JSON.stringify(stored).includes(key));
  const text=await (await handleAiConfig(request("config"),MANAGER,deps)).text();assert.ok(!text.includes(stored.sealedKey));
  assert.equal((await handleAiConfig(request("config",{enabled:false},"PATCH"),MANAGER,deps)).status,200);
  f.database.close();
});
test("authorized review saves an audited note and Drive task without scoring, qualification or stage changes; replay is free",async()=>{
  let calls=0;
  const f=await fixture(async(_url,init)=>{calls++;const body=JSON.parse(init!.body as string);assert.equal(body.model,MODEL);assert.deepEqual(body.provider,{only:["OpenAI"],allow_fallbacks:false,data_collection:"deny",require_parameters:true});assert.ok(!body.messages.at(-1).content.includes(f.app.email));return response();});
  const first=await handleAiReview(request("review",f.input),RECRUITER,f.deps);
  assert.equal(first.status,200,await first.clone().text());
  const result=(await first.json() as {data:{application:typeof f.app}}).data;
  assert.equal(result.application.stage,f.app.stage);assert.deepEqual(result.application.grade,f.app.grade);assert.equal(result.application.qualification,f.app.qualification);
  assert.equal(result.application.notes.length,1);assert.equal(result.application.notes[0].actor,RECRUITER.email);assert.match(result.application.notes[0].text,/OpenRouter/);
  assert.ok((await f.store.tasks()).some(t=>t.kind==="drive"&&t.applicationId===f.app.id));
  assert.equal((await handleAiReview(request("review",f.input),RECRUITER,f.deps)).status,200);
  assert.equal(calls,1);assert.equal((await f.store.getApplication(f.app.id)).notes.length,1);
  f.database.close();
});
test("no external request occurs for disabled, unauthenticated, missing consent, stale revision, cross-origin or oversized inputs",async()=>{
  let calls=0;const f=await fixture(async()=>{calls++;return response();});
  assert.equal((await handleAiReview(request("review",f.input),null,f.deps)).status,403);
  assert.equal((await handleAiReview(request("review",{...f.input,consent:false}),MANAGER,f.deps)).status,422);
  assert.equal((await handleAiReview(request("review",{...f.input,expectedRevision:999}),MANAGER,f.deps)).status,409);
  assert.equal((await handleAiReview(request("review",f.input,"POST","https://evil.invalid"),MANAGER,f.deps)).status,403);
  assert.equal((await handleAiReview(request("review",{...f.input,resumeText:"x".repeat(30001)}),MANAGER,f.deps)).status,422);
  assert.equal((await handleAiReview(request("review",{...f.input,jobCriteria:Array.from({length:9},(_,i)=>`Criterion ${i}`).join("\n")}),MANAGER,f.deps)).status,422);
  await handleAiConfig(request("config",{enabled:false},"PATCH"),MANAGER,f.deps);
  assert.equal((await handleAiReview(request("review",f.input),MANAGER,f.deps)).status,409);assert.equal(calls,0);
  f.database.close();
});
test("provider errors and invented quotes are rejected without saving or exposing secrets",async()=>{
  const f=await fixture(async()=>Response.json({error:{message:`secret ${key}`}}, {status:401}));
  const result=await handleAiReview(request("review",f.input),MANAGER,f.deps);
  assert.equal(result.status,502);assert.ok(!(await result.text()).includes(key));assert.equal((await f.store.getApplication(f.app.id)).notes.length,0);
  assert.equal((await handleAiReview(request("review",f.input),MANAGER,f.deps)).status,409);
  assert.throws(()=>validateReview({...review,criteria:[{...review.criteria[0],citations:[{source:"resume",quote:"Invented experience"}]}]},sources,[review.criteria[0].criterion]));
  assert.throws(()=>validateReview({...review,rank:1},sources,[review.criteria[0].criterion]));
  assert.throws(()=>validateReview({...review,criteria:[{...review.criteria[0],status:"needs_verification"}]},sources,[review.criteria[0].criterion]));
  assert.throws(()=>validateReview({...review,criteria:[{...review.criteria[0],status:"not_found"}]},sources,[review.criteria[0].criterion]));
  f.database.close();
});
test("concurrent repeated clicks invoke provider once, and a revision race can retry cached evidence without another charge",async()=>{
  let release!:()=>void;let started!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});const ready=new Promise<void>(resolve=>{started=resolve;});let calls=0;
  const f=await fixture(async()=>{calls++;started();await pending;return response();});
  const first=handleAiReview(request("review",f.input),MANAGER,f.deps);await ready;
  assert.equal((await handleAiReview(request("review",f.input),MANAGER,f.deps)).status,409);
  await f.store.action(f.app.id,{action:"note",text:"A human reviewed this concurrently.",expectedRevision:f.app.revision},MANAGER);
  release();assert.equal((await first).status,409);
  const current=await f.store.getApplication(f.app.id);
  assert.equal((await handleAiReview(request("review",{...f.input,expectedRevision:current.revision}),MANAGER,f.deps)).status,200);
  assert.equal(calls,1);assert.equal((await f.store.getApplication(f.app.id)).notes.length,2);
  f.database.close();
});
test("model output is schema bounded and incomplete generations cannot save",async()=>{
  const max:Review={criteria:Array.from({length:8},()=>({criterion:"c".repeat(500),status:"needs_verification",explanation:"e".repeat(400),citations:Array.from({length:3},()=>({source:"resume",quote:"q".repeat(240)}))})),checks:Array.from({length:5},()=>({question:"x".repeat(300),citations:Array.from({length:2},()=>({source:"linkedin",quote:"q".repeat(240)}))}))};
  assert.ok(reviewNote(max,"a".repeat(64)).length<20000);
  await assert.rejects(generateReview(key,sources,[review.criteria[0].criterion],async()=>Response.json({choices:[{finish_reason:"length",message:{content:JSON.stringify(review)}}]})));
});
test("distinct reviews are capped per application per hour and unknown models cannot be selected",async()=>{
  let calls=0;const f=await fixture(async()=>{calls++;return response();});
  for(let i=0;i<10;i++){
    const app=await f.store.getApplication(f.app.id);
    const result=await handleAiReview(request("review",{...f.input,expectedRevision:app.revision,resumeText:`${sources.resume} Additional context ${i}`}),MANAGER,f.deps);
    assert.equal(result.status,200,await result.clone().text());
  }
  const current=await f.store.getApplication(f.app.id);
  assert.equal((await handleAiReview(request("review",{...f.input,expectedRevision:current.revision,resumeText:`${sources.resume} Additional context 11`}),MANAGER,f.deps)).status,429);
  assert.equal(calls,10);
  assert.equal((await handleAiConfig(request("config",{enabled:true,model:"arbitrary/model"},"PATCH"),MANAGER,f.deps)).status,422);
  f.database.close();
});
test("untrusted response schema cannot append hiring decisions, change criteria, or cite a different source",()=>{
  assert.throws(()=>validateReview({...review,criteria:[{...review.criteria[0],criterion:"Hire immediately"}]},sources,[review.criteria[0].criterion]));
  assert.throws(()=>validateReview({...review,criteria:[{...review.criteria[0],citations:[{source:"linkedin",quote:sources.resume}]}]},sources,[review.criteria[0].criterion]));
  assert.throws(()=>validateReview({...review,criteria:[{...review.criteria[0],score:99}]},sources,[review.criteria[0].criterion]));
});
test("source selection keeps management and language evidence while excluding personal fields",async()=>{
  const f=createStore();
  const eligible=[{path:"project_management",title:"Project management"},{path:"languages",title:"Languages"},{path:"campaignManagement",title:"Campaign management"}];
  const excluded=[{path:"full_name",title:"Full name"},{path:"applicantAge",title:"Age"},{path:"postal_address",title:"Address"},{path:"birthDate",title:"Date of birth"},{path:"gender",title:"Gender"},{path:"disability",title:"Disability"},{path:"nationality",title:"Nationality"}];
  const base=jobInput();base.fields.push(...[...eligible,...excluded].map(field=>({...field,type:"String" as const,required:false})));
  const job=await f.store.saveJob(base),input=applicationInput(job.id);
  input.fieldSubmissions.push(...eligible.map(field=>({path:field.path,value:`Evidence for ${field.path}`})),...excluded.map(field=>({path:field.path,value:`Private value for ${field.path}`})));
  const {id}=await f.store.acceptApplication(input),app=await f.store.getApplication(id);
  let answers="";
  const deps:AiDependencies={store:f.store,encryptionKey,fetcher:async(_url,init)=>{answers=JSON.parse(JSON.parse(init!.body as string).messages.at(-1).content).sources.answers;return response();}};
  await handleAiConfig(request("config",{apiKey:key,enabled:true},"PATCH"),MANAGER,deps);
  const result=await handleAiReview(request("review",{applicationId:id,expectedRevision:app.revision,resumeText:sources.resume,linkedinText:"",jobCriteria:"Build React applications",consent:true}),MANAGER,deps);
  assert.equal(result.status,200,await result.clone().text());
  for(const field of eligible)assert.ok(answers.includes(`Evidence for ${field.path}`),`${field.path} is preserved`);
  assert.ok(!answers.includes("Private value"));assert.ok(!answers.includes(app.email));assert.ok(!answers.includes(app.name));
  f.database.close();
});
test("selected original PDF is authoritative over browser text and must belong to the application",async()=>{
  const {makePdf}=await import("../pdf/fixtures");
  const bytes=makePdf(sources.resume);let calls=0;
  const f=await fixture(async(_url,init)=>{calls++;const sent=JSON.parse(init!.body as string);assert.ok(sent.messages.at(-1).content.includes(sources.resume));assert.ok(!sent.messages.at(-1).content.includes("INVENTED BROWSER TEXT"));return response();});
  const fileId="a".repeat(64);
  await f.store.stmt("INSERT INTO hub_files(id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,application_id,expires_at,session_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)",fileId,f.app.jobId,"resume","resume.pdf","application/pdf",bytes.length,"private/original",Date.now(),f.app.id,Date.now()+100000,"b".repeat(64)).run();
  const deps={...f.deps,bucket:{get:async()=>({size:bytes.length,customMetadata:{fileId},body:new Response(bytes.buffer as ArrayBuffer).body!})} as unknown as R2Bucket};
  assert.equal((await handleAiReview(request("review",{...f.input,resumeFileId:"f".repeat(64)}),MANAGER,deps)).status,404);assert.equal(calls,0);
  const result=await handleAiReview(request("review",{...f.input,resumeFileId:fileId,resumeText:"INVENTED BROWSER TEXT"}),MANAGER,deps);
  assert.equal(result.status,200,await result.clone().text());assert.equal(calls,1);
  assert.match((await f.store.getApplication(f.app.id)).notes[0].text,/Original PDF: resume.pdf/);
  f.database.close();
});

test('provider schema mirrors exact criteria, string bounds and evidence citation rules',async()=>{
 const {reviewJsonSchema}=await import('../../lib/ai/review');
 const criteria=['Build React applications','Write automated tests'];
 const schema=reviewJsonSchema(criteria),items=schema.properties.criteria.items.anyOf;
 assert.equal(schema.properties.criteria.minItems,2);assert.equal(schema.properties.criteria.maxItems,2);
 for(const item of items){assert.deepEqual(item.properties.criterion.enum,criteria);assert.equal(item.properties.explanation.maxLength,400);}
 assert.equal(items.find(item=>item.properties.status.enum[0]==='not_found')!.properties.citations.maxItems,0);
 assert.equal(items.find(item=>item.properties.status.enum[0]==='evidence_found')!.properties.citations.minItems,1);
 assert.equal(items.find(item=>item.properties.status.enum[0]==='needs_verification')!.properties.citations.minItems,2);
 assert.equal(schema.$defs.citation.properties.quote.maxLength,240);
 assert.equal(schema.properties.checks.items.properties.question.maxLength,300);
 let calls=0;
 await generateReview(key,sources,[review.criteria[0].criterion],async(_url,init)=>{
  calls++;const sent=JSON.parse(String(init?.body));assert.deepEqual(sent.response_format.json_schema.schema,(await import("../../lib/ai/review")).referencedReviewSchema([review.criteria[0].criterion],(await import("../../lib/ai/review")).sourceSpans(sources)));return response();
 });assert.equal(calls,1);
});

test('AI failures distinguish structure, criterion identity, citation policy and exact source validation',()=>{
 const criteria=[review.criteria[0].criterion],copy=()=>structuredClone(review);
 const long=copy();long.criteria[0].explanation='x'.repeat(401);
 assert.throws(()=>validateReview(long,sources,criteria),{code:'ai_response_schema_invalid'});
 const renamed=copy();renamed.criteria[0].criterion='Related but different requirement';
 assert.throws(()=>validateReview(renamed,sources,criteria),{code:'ai_response_criteria_mismatch'});
 const policy=copy();policy.criteria[0].status='not_found';
 assert.throws(()=>validateReview(policy,sources,criteria),{code:'ai_response_citation_policy'});
 const invented=copy();invented.criteria[0].citations[0].quote='Built React applications for seven years.';
 assert.throws(()=>validateReview(invented,sources,criteria),{code:'ai_response_quote_unverified'});
 const normalized=copy();normalized.criteria[0].citations[0].quote='Built  React applications for two years.';
 assert.throws(()=>validateReview(normalized,sources,criteria),{code:'ai_response_quote_unverified'});
 assert.deepEqual(validateReview(review,sources,criteria),review);
});

test('provider completion diagnostics distinguish truncation, refusal, JSON and timeout without leaking content',async()=>{
 const criteria=[review.criteria[0].criterion];
 for(const [body,code] of [
  [{choices:[{finish_reason:'length',message:{content:'private-content'}}]},'ai_response_truncated'],
  [{choices:[{finish_reason:'stop',message:{refusal:'private refusal details',content:''}}]},'ai_response_refused'],
  [{choices:[{finish_reason:'content_filter',message:{content:'private-content'}}]},'ai_response_refused'],
  [{choices:[{finish_reason:'error',message:{content:'private-content'}}]},'ai_response_incomplete'],
  [{choices:[{finish_reason:'stop',message:{content:'private malformed json'}}]},'ai_response_json_invalid'],
 ] as const){
  await assert.rejects(generateReview(key,sources,criteria,async()=>Response.json(body)),error=>{
   assert.equal((error as {code:string}).code,code);assert.ok(!String(error).includes('private'));return true;
  });
 }
 await assert.rejects(generateReview(key,sources,criteria,async()=>{throw new DOMException('private provider detail','TimeoutError');}),{code:'ai_request_timeout'});
});


test('source references preserve exact PDF whitespace and boundaries without accepting invented evidence',async()=>{
 const {sourceSpans,resolveReviewReferences}=await import('../../lib/ai/review');
 const text='x'.repeat(215)+' Built\nReact  applications\tfor seven years. '+'y'.repeat(250)+'😀';
 const input={resume:text,linkedin:'Independent profile text',answers:'Brief count: 12'};
 const spans=sourceSpans(input);
 for(const span of spans){assert.equal(input[span.source].slice(span.start,span.start+span.quote.length),span.quote);assert.ok(span.quote.length<=240);}
 assert.ok(spans.some(span=>span.quote.includes('Built\nReact  applications\tfor seven years.')));
 const chosen=spans.find(span=>span.quote.includes('Built\nReact'))!;
 const wire={criteria:[{criterion:'React experience',status:'evidence_found',explanation:'Resume reports React experience.',citations:[{id:chosen.id}]}],checks:[]};
 const result=await generateReview(key,input,['React experience'],async(_url,init)=>{
  const request=JSON.parse(String(init?.body));assert.deepEqual(request.reasoning,{effort:'low',exclude:true});assert.equal(request.max_tokens,5000);
  const sent=JSON.parse(request.messages.at(-1).content);assert.deepEqual(sent.sources,input);assert.deepEqual(sent.sourceSpans,spans);
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}]});
 });assert.equal(result.criteria[0].citations[0].quote,chosen.quote);
 assert.throws(()=>resolveReviewReferences({...wire,criteria:[{...wire.criteria[0],citations:[{id:'resume:99999'}]}]},spans),{code:'ai_response_quote_unverified'});
 assert.throws(()=>resolveReviewReferences({...wire,criteria:[{...wire.criteria[0],citations:[{id:chosen.id,quote:'Invented'}]}]},spans),{code:'ai_response_schema_invalid'});
 const duplicate={...wire,criteria:[{...wire.criteria[0],status:'needs_verification',citations:[{id:chosen.id},{id:chosen.id}]}]};
 assert.throws(()=>validateReview(resolveReviewReferences(duplicate,spans),input,['React experience']),{code:'ai_response_citation_policy'});
 assert.throws(()=>resolveReviewReferences(wire,[]),{code:'ai_response_quote_unverified'});
});

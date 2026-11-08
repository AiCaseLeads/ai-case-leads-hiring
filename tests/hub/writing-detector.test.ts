import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { scanAnswer, DetectorError } from "../../lib/response-checks/gptzero";
import { saveDetectorKey, getDetectorKey } from "../../lib/response-checks/key";
import { createStore } from "./fixtures";

test("detector sends only the supplied prose to the fixed API and keeps the assessment",async t=>{
  let calls=0;
  t.mock.method(globalThis,"fetch",async (url:string, options:RequestInit)=>{
    assert.equal(url,"https://api.gptzero.me/v2/predict/text");
    assert.equal(options.redirect,"error");
    assert.equal(new Headers(options.headers).get("x-api-key"),"synthetic-token");
    assert.deepEqual(JSON.parse(String(options.body)),{document:"Fictional answer."});
    calls++;
    return Response.json({documents:[{predicted_class:calls===1?"mixed":"new_vendor_class",confidence_category:"high",sentences:[{sentence:"unnecessary provider text"}]}]});
  });
  assert.deepEqual(await scanAnswer("Fictional answer.","synthetic-token"),{classification:"MIXED",confidence:"high"});
  assert.equal((await scanAnswer("Fictional answer.","synthetic-token")).classification,"UNDETERMINED");
});

test("provider limits expose a bounded retry interval without leaking the payload",async t=>{
  t.mock.method(globalThis,"fetch",async()=>new Response("private raw response",{status:429,headers:{"Retry-After":"120"}}));
  await assert.rejects(()=>scanAnswer("private answer","private-key"),error=>{
    assert.ok(error instanceof DetectorError);
    assert.equal(error.retryAfterSeconds,120);
    assert.equal(error.status,429);
    assert.doesNotMatch(error.message,/private/);
    return true;
  });
});

test("a verified detector key is sealed at rest and a failed replacement preserves it",async t=>{
  const {store,database}=createStore();
  const old=process.env.GOOGLE_TOKEN_KEY;
  process.env.GOOGLE_TOKEN_KEY=randomBytes(32).toString("hex");
  t.after(()=>{ if(old===undefined) delete process.env.GOOGLE_TOKEN_KEY; else process.env.GOOGLE_TOKEN_KEY=old; database.close();});
  const token="example-test-token-98765";
  let valid=true;
  t.mock.method(globalThis,"fetch",async()=>valid?Response.json({data:{words_left:1500}}):new Response("unauthorized",{status:401}));
  assert.deepEqual(await saveDetectorKey(store,token),{connected:true,wordsRemaining:1500});
  assert.ok(!(await store.setting("response_checks_gptzero_connection","")).includes(token));
  assert.equal(await getDetectorKey(store),token);
  valid=false;
  await assert.rejects(()=>saveDetectorKey(store,"example-test-replacement"),/GPTZero rejected/);
  assert.equal(await getDetectorKey(store),token);
});

test("distinguishes a provider length refusal from unrelated validation errors or echoed text",async t=>{
  const replies=[
    {detail:[{msg:"String should have at least 250 characters",input:"private prose"}]},
    {detail:[{msg:"Unsupported content",input:"It is too short"}]},
  ];
  t.mock.method(globalThis,"fetch",async()=>Response.json(replies.shift(),{status:422}));
  for(const reason of ["too_short",undefined]){
    await assert.rejects(scanAnswer("private prose","test-key"),error=>error instanceof DetectorError && error.reason===reason);
  }
});

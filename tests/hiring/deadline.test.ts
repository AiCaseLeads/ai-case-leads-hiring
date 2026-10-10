import test from "node:test";
import assert from "node:assert/strict";
import {withinDeadline} from "../../lib/hiring/deadline";
test("expired work never starts; a hung provider doesn't consume the whole processor",async()=>{
 let started=0;
 await assert.rejects(()=>withinDeadline(async()=>{started++;return "unexpected";},Date.now()-1),{code:"operation_deadline_exceeded"});
 assert.equal(started,0);
 await assert.rejects(()=>withinDeadline(()=>new Promise(()=>{}),Date.now()+10,"storage_deadline_exceeded"),{code:"storage_deadline_exceeded"});
});
test("bounded operations preserve success and errors for task recovery",async()=>{
 assert.equal(await withinDeadline(async()=>"completed",Date.now()+1000),"completed");
 await assert.rejects(()=>withinDeadline(async()=>{throw new Error("storage outage");},Date.now()+1000),/storage outage/);
});


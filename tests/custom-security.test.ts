import test from "node:test";
import assert from "node:assert/strict";
import { memberFromHeaders } from "../lib/hub/auth-core";
import { fileSignature,boundedBytes } from "../lib/hiring/files";
import { schedulerAuthorized } from "../lib/task-runner";

test("staff membership requires Sites identity and explicit authorization",async()=>{
  const config={ADMIN_EMAILS:"owner@example.invalid"};
  assert.equal(await memberFromHeaders(new Headers({Cookie:"hiring_session="+"a".repeat(64)}),config),null);
  assert.equal(await memberFromHeaders(new Headers({"oai-authenticated-user-id":"u","oai-authenticated-user-email":"stranger@example.invalid"}),config),null);
  assert.equal(await memberFromHeaders(new Headers({"oai-authenticated-user-email":"owner@example.invalid"}),config),null);
  assert.deepEqual(await memberFromHeaders(new Headers({"oai-authenticated-user-id":"u","oai-authenticated-user-email":"OWNER@example.invalid"}),config),{userId:"u",email:"owner@example.invalid",role:"admin",isOwner:true});
});
test("scheduler authorization requires the complete independent bearer",async()=>{
  assert.equal(await schedulerAuthorized(new Request("https://careers.invalid"),"secret"),false);
  assert.equal(await schedulerAuthorized(new Request("https://careers.invalid",{headers:{Authorization:"Bearer wrong"}}),"secret"),false);
  assert.equal(await schedulerAuthorized(new Request("https://careers.invalid",{headers:{Authorization:"Bearer secret"}}),"secret"),true);
  assert.equal(await schedulerAuthorized(new Request("https://careers.invalid",{headers:{Authorization:"Bearer secret"}})),false);
});
test("uploads reject fabricated document types and unbounded streamed bodies",async()=>{
  assert.equal(fileSignature(new TextEncoder().encode("<html>script</html>"),"application/pdf"),false);
  assert.equal(fileSignature(new TextEncoder().encode("%PDF-1.7\n"),"application/pdf"),true);
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(1025));controller.close();}});
  await assert.rejects(()=>boundedBytes(new Request("https://careers.invalid",{method:"POST",body:stream,duplex:"half"} as RequestInit),1024),/too large/);
});

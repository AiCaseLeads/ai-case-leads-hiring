import test from "node:test";
import assert from "node:assert/strict";
import { createStore as fixture,MANAGER,RECRUITER,jobInput } from "./fixtures";
import { staffInput,staffTeam,updateStaff,processStaffInvites } from "../../lib/staff/service";
import { handleStaffTeam } from "../../lib/staff/http";
import { handleHubRequest } from "../../lib/hub/http";
import { currentStaffMember } from "../../lib/railway/auth-core";
const owner={...MANAGER,isOwner:true},head={email:"head@example.invalid",role:"admin" as const,userId:"head",isOwner:false},origin="https://jobs.example.invalid",owners=[owner.email];
const input=(overrides:Record<string,unknown>={})=>staffInput.parse({email:RECRUITER.email,role:"recruiter",active:true,sendInvite:true,...overrides});
function req(method:string,body?:unknown){return new Request(`${origin}/api/team`,{method,headers:{origin,"content-type":"application/json"},body:body?JSON.stringify(body):undefined});}
test("owner appoints head, heads invite recruiters without granting owner, protected roles cannot be changed",async()=>{
 const f=await fixture();
 await updateStaff(f.store,owner,owners,input({email:head.email,role:"admin"}),origin);
 await updateStaff(f.store,head,owners,input(),origin);
 assert.equal((await staffTeam(f.store,head,owners)).members.find(m=>m.email===head.email)?.isOwner,false);
 await assert.rejects(updateStaff(f.store,head,owners,input({email:"another@example.invalid",role:"admin"}),origin),/Only the owner/);
 await assert.rejects(updateStaff(f.store,head,owners,input({email:owner.email,active:false}),origin),/owner accounts/);
 await assert.rejects(updateStaff(f.store,owner,owners,input({email:owner.email,active:false}),origin),/owner accounts/);
 await assert.rejects(updateStaff(f.store,RECRUITER,owners,input(),origin),/Only the head/);
 f.database.close();
});
test("staff invites are durable, deduplicated, contain guide and correct recipient, with no fake application",async()=>{
 const f=await fixture();await updateStaff(f.store,owner,owners,input(),origin);await updateStaff(f.store,owner,owners,input(),origin);
 const sent:Array<{to:string;body:string;messageId:string}>=[];const google={sendMail:async(mail:typeof sent[number])=>{sent.push(mail);return {id:"sent",threadId:"thread"};},reconcileMail:async()=>null};
 await Promise.all([processStaffInvites(f.store,google,owners),processStaffInvites(f.store,google,owners)]);
 await processStaffInvites(f.store,google,owners);
 assert.equal(sent.length,1);assert.equal(sent[0].to,RECRUITER.email);assert.match(sent[0].body,/\/recruiter-guide.pdf/);assert.match(sent[0].body,/\/team\?view=settings/);
 assert.equal((await f.store.stmt("SELECT COUNT(*) n FROM hub_applications").first<{n:number}>())?.n,0);
 const members=await staffTeam(f.store,owner,owners);assert.equal(members.members.find(m=>m.email===RECRUITER.email)?.invite?.status,"sent");
 await updateStaff(f.store,owner,owners,input(),origin);await processStaffInvites(f.store,google,owners);assert.equal(sent.length,1);
 f.database.close();
});
test("revoked invitation is not sent; stale manager writes fail without changing role",async()=>{
 const f=await fixture();await updateStaff(f.store,owner,owners,input(),origin);
 await updateStaff(f.store,head,owners,input({active:false,sendInvite:false}),origin);
 let calls=0;await processStaffInvites(f.store,{sendMail:async()=>{calls++;return {id:"s",threadId:"t"};},reconcileMail:async()=>null},owners);assert.equal(calls,0);
 await assert.rejects(updateStaff(f.store,owner,owners,input({expectedUpdatedAt:0}),origin),/access changed/);
 assert.equal((await staffTeam(f.store,owner,owners)).members.find(m=>m.email===RECRUITER.email)?.active,false);f.database.close();
});
test("uncertain sends only reconcile and cannot be resent from UI",async()=>{
 const f=await fixture();await updateStaff(f.store,owner,owners,input(),origin);let calls=0;
 const google={sendMail:async()=>{calls++;throw {code:"network_error",uncertain:true};},reconcileMail:async()=>null};
 await processStaffInvites(f.store,google,owners);
 const key=`staff_invite:${RECRUITER.email}`,saved=await f.store.setting<Record<string,unknown>>(key,{});assert.equal(saved.status,"uncertain");await f.store.setSetting(key,{...saved,runAfter:0});
 await processStaffInvites(f.store,google,owners);assert.equal(calls,1);
 await assert.rejects(updateStaff(f.store,owner,owners,input({resendInvite:true}),origin),/awaiting delivery/);
 const uncertain=await f.store.setting<Record<string,unknown>>(key,{});await f.store.setSetting(key,{...uncertain,runAfter:0});
 await processStaffInvites(f.store,{...google,reconcileMail:async()=>({id:"s",threadId:"t"})},owners);
 assert.equal((await f.store.setting<Record<string,unknown>>(key,{})).status,"sent");f.database.close();
});
test("expired running leases reconcile without another send",async()=>{
 const f=await fixture();await updateStaff(f.store,owner,owners,input(),origin);const key=`staff_invite:${RECRUITER.email}`,saved=await f.store.setting<Record<string,unknown>>(key,{});await f.store.setSetting(key,{...saved,status:"running",leaseUntil:0});let calls=0;
 await processStaffInvites(f.store,{sendMail:async()=>{calls++;return {id:"s",threadId:"t"};},reconcileMail:async()=>({id:"s",threadId:"t"})},owners);assert.equal(calls,0);assert.equal((await f.store.setting<Record<string,unknown>>(key,{})).status,"sent");f.database.close();
});
test("recruiters can create jobs; head cannot change company settings and old bulk membership path is disabled",async()=>{
 const f=await fixture();assert.equal((await handleHubRequest(req("POST",jobInput()),["jobs"],RECRUITER,f.store)).status,200);
 assert.equal((await handleHubRequest(req("PATCH",{settingsVersion:1}),["settings"],head,f.store)).status,403);
 assert.equal((await handleHubRequest(req("PATCH",{settingsVersion:1,members:[{email:owner.email,role:"admin"}]}),["settings"],owner,f.store)).status,422);
 assert.equal((await handleStaffTeam(req("POST",input()),RECRUITER,f.store,owners)).status,403);
 assert.equal((await handleStaffTeam(new Request(`${origin}/api/team`,{method:"POST",headers:{origin:"https://other.invalid"},body:JSON.stringify(input())}),owner,f.store,owners)).status,403);
 f.database.close();
});
test("authenticated owner capability is derived only from server allowlist, not admin role",async()=>{
 const f=await fixture();await updateStaff(f.store,owner,owners,input({email:head.email,role:"admin"}),origin);
 const config={db:f.db,origin,secureCookies:true,adminEmails:owner.email};
 const ownerSession=await currentStaffMember({userId:"owner",email:owner.email,fullName:null},config),headSession=await currentStaffMember({userId:"head",email:head.email,fullName:null},config);
 assert.equal(ownerSession?.isOwner,true);assert.equal(headSession?.isOwner,false);
 await updateStaff(f.store,owner,owners,input({email:head.email,role:"admin",active:false,sendInvite:false}),origin);
 assert.equal(await currentStaffMember({userId:"head",email:head.email,fullName:null},config),null);f.database.close();
});
test("definite delivery failures retain retry state and malformed team commands fail as client errors",async()=>{
 const f=await fixture();await updateStaff(f.store,owner,owners,input(),origin);let calls=0;
 await processStaffInvites(f.store,{sendMail:async()=>{calls++;throw {code:"google_not_connected",uncertain:false};},reconcileMail:async()=>null},owners);
 const key=`staff_invite:${RECRUITER.email}`,failed=await f.store.setting<Record<string,unknown>>(key,{});assert.equal(failed.status,"failed");assert.equal(failed.lastError,"google_not_connected");
 await processStaffInvites(f.store,{sendMail:async()=>{calls++;return {id:"s",threadId:"t"};},reconcileMail:async()=>null},owners);assert.equal(calls,1);
 assert.equal((await handleStaffTeam(req("POST",{email:"not-an-email",role:"owner",isOwner:true}),owner,f.store,owners)).status,422);
 await f.store.setSetting(key,{...failed,runAfter:0});await processStaffInvites(f.store,{sendMail:async()=>{calls++;return {id:"s",threadId:"t"};},reconcileMail:async()=>null},owners);assert.equal(calls,2);
 f.database.close();
});

test("unknown errors after entering provider send fail closed as uncertain",async()=>{
 const f=await fixture();await updateStaff(f.store,owner,owners,input(),origin);
 await processStaffInvites(f.store,{sendMail:async()=>{throw new Error("unexpected");},reconcileMail:async()=>null},owners);
 assert.equal((await f.store.setting<Record<string,unknown>>(`staff_invite:${RECRUITER.email}`,{})).status,"uncertain");f.database.close();
});

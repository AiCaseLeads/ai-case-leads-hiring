import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,MANAGER,RECRUITER} from './fixtures';
import {authorizeAgent,issueAccess,updateAccessScopes} from '../../lib/agent-api/access';
test('owner may change scopes without rotating or exposing secret or extending expiry',async()=>{const {store,database}=createStore();try{
 const issued=await issueAccess(store,'Claude Code',['jobs:read'],'owner'),key='agent_access_'+issued.id,before=await store.setting<Record<string,unknown>>(key,{});
 const result=await updateAccessScopes(store,{id:issued.id,scopes:['jobs:read','applicants:read','files:read']},MANAGER),after=await store.setting<Record<string,unknown>>(key,{});
 assert.equal(after.hash,before.hash);assert.equal(after.expiresAt,before.expiresAt);assert.equal(after.createdBy,before.createdBy);assert.equal(after.revoked,false);assert.ok(!('hash'in result));assert.ok(!('token'in result));assert.ok(!JSON.stringify(result).includes(issued.token));
 const request=new Request('https://example.invalid',{headers:{authorization:'Bearer '+issued.token}});await authorizeAgent(store,request,'files:read');
 const audit=database.prepare("SELECT before_json,after_json FROM hub_audit WHERE type='agent_access_scopes'").get()!;assert.ok(!JSON.stringify(audit).includes(String(before.hash)));assert.ok(!JSON.stringify(audit).includes(issued.token));
 }finally{database.close()}});
test('scope update rejects non-owner, invalid permissions, missing revoked and expired records',async()=>{const {store,database}=createStore();try{
 const access=await issueAccess(store,'qa',['jobs:read'],'owner'),input={id:access.id,scopes:['applicants:read','files:read']},key='agent_access_'+access.id;
 await assert.rejects(updateAccessScopes(store,input,RECRUITER),{code:'owner_access_required'});await assert.rejects(updateAccessScopes(store,{...input,scopes:['files:read']},MANAGER),{code:'invalid_access'});await assert.rejects(updateAccessScopes(store,{...input,scopes:['admin:*']},MANAGER),{code:'invalid_access'});await assert.rejects(updateAccessScopes(store,{...input,token:'new'},MANAGER),{code:'invalid_access'});
 await assert.rejects(updateAccessScopes(store,{...input,id:crypto.randomUUID()},MANAGER),{code:'access_not_editable'});const record=await store.setting<Record<string,unknown>>(key,{});await store.setSetting(key,{...record,revoked:true});await assert.rejects(updateAccessScopes(store,input,MANAGER),{code:'access_not_editable'});await store.setSetting(key,{...record,expiresAt:1});await assert.rejects(updateAccessScopes(store,input,MANAGER),{code:'access_not_editable'});
 }finally{database.close()}});

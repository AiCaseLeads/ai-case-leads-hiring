import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,RECRUITER,MANAGER} from './fixtures';
import {PERSONAL_MAIL_SCOPES,exchangeMailCode,sealToken,openToken,authorizationUrl} from '../../lib/google/oauth';
import {savePersonalMailGrant} from '../../lib/personal-mail/oauth';
import {canConnectPersonalMail,mailGrantKey,personalMailStatus,personalMailWorkspace} from '../../lib/personal-mail/service';
import {configurationFingerprint,claimOAuthBinding} from '../../lib/google/config-state';
import {sha256} from '../../lib/hiring/crypto';
const key='c'.repeat(64),origin='https://jobs.example.invalid';
const env={GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret',GOOGLE_TOKEN_KEY:key,GOOGLE_CLIENT_REVISION:0};
function google(email=RECRUITER.email,verified=true,scope=PERSONAL_MAIL_SCOPES.join(' ')):typeof fetch{return async(input)=>String(input).includes('/token')?Response.json({access_token:'access',refresh_token:'personal-mail-refresh',token_type:'Bearer',expires_in:3600,scope}):Response.json({email,verified_email:verified});}
async function fixture(){const f=createStore();f.database.prepare("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES (?,?,'recruiter',1,0,0)").run(RECRUITER.userId,RECRUITER.email);return f;}
test('mail consent excludes Drive/Calendar and requires readonly delivery reconciliation plus verified identity',async()=>{
 const url=new URL(authorizationUrl({clientId:'client',redirectUri:origin+'/api/google/callback',state:'a'.repeat(64),scopes:PERSONAL_MAIL_SCOPES}));assert.doesNotMatch(url.searchParams.get('scope')!,/drive|calendar/);
 const input={clientId:'client',clientSecret:'secret',redirectUri:origin+'/api/google/callback',code:'code',codeVerifier:'a'.repeat(64)};
 assert.equal((await exchangeMailCode(input,google())).email,RECRUITER.email);
 await assert.rejects(()=>exchangeMailCode(input,google(RECRUITER.email,false)),/google_profile_invalid/);
 await assert.rejects(()=>exchangeMailCode(input,google(RECRUITER.email,true,PERSONAL_MAIL_SCOPES.filter(scope=>!scope.endsWith('gmail.readonly')).join(' '))),/missing_permissions/);
});
test('personal mail callback is bound to signed-in staff and never replaces shared Drive/calendar credentials',async()=>{
 const f=await fixture();try{
  await f.store.setSetting('google_refresh_token','shared-storage-grant');await f.store.setSetting('google_sender','sales@example.com');
  const state='a'.repeat(64),binding={flow:'personal-mail' as const,email:RECRUITER.email,verifier:'b'.repeat(64),revision:0,fingerprint:await configurationFingerprint(env)},now=Date.now();
  f.database.prepare('INSERT INTO hub_oauth_states(state_hash,user_id,verifier,expires_at,used_at) VALUES(?,?,?,?,NULL)').run(await sha256(state),RECRUITER.userId,JSON.stringify(binding),now+60000);
  await assert.rejects(()=>claimOAuthBinding(f.db,state,MANAGER.userId,now));const claimed=await claimOAuthBinding(f.db,state,RECRUITER.userId,now);await assert.rejects(()=>claimOAuthBinding(f.db,state,RECRUITER.userId,now));
  const input={...claimed,member:RECRUITER,clientId:'client',clientSecret:'secret',tokenKey:key,redirectUri:origin+'/api/google/callback',code:'code'};
  await assert.rejects(()=>savePersonalMailGrant(f.db,input,google(MANAGER.email)),/wrong_mail_account/);
  await assert.rejects(()=>savePersonalMailGrant(f.db,{...input,binding:{...binding,flow:'personal-calendar'}},google()),/wrong_mail_account/);
  await savePersonalMailGrant(f.db,input,google());const saved=await f.store.setting<{sealedToken:string}>(mailGrantKey(RECRUITER.email),{sealedToken:''});assert.equal(await openToken(saved.sealedToken,key),'personal-mail-refresh');
  assert.equal(await f.store.setting('google_refresh_token',''),'shared-storage-grant');assert.equal(await f.store.setting('google_sender',''),'sales@example.com');assert.equal(await f.store.setting('personal_calendar_grant:'+RECRUITER.email,null),null);
  await f.store.setSetting('google_client_revision',1);await assert.rejects(()=>savePersonalMailGrant(f.db,input,google()));
 }finally{f.database.close();}
});
test('personal mail worker never falls back to shared account and rejects inactive or stale grants',async()=>{
 const f=await fixture();try{
  assert.equal(await personalMailWorkspace(f.store,RECRUITER.email,env),null);
  await f.store.setSetting(mailGrantKey(RECRUITER.email),{email:RECRUITER.email,sealedToken:await sealToken('private-refresh',key),revision:0,fingerprint:await configurationFingerprint(env),connectedAt:Date.now()});
  const status=await personalMailStatus(f.store,RECRUITER.email,env);assert.equal(status.connected,true);assert.doesNotMatch(JSON.stringify(status),/sealedToken|refresh|fingerprint/);
  const workspace=await personalMailWorkspace(f.store,RECRUITER.email,env);assert.equal(workspace?.status().sender,RECRUITER.email);assert.equal(workspace?.status().drive,false);assert.equal(workspace?.status().calendar,false);
  assert.equal(await personalMailWorkspace(f.store,RECRUITER.email,{...env,GOOGLE_CLIENT_SECRET:'changed'}),null);
  assert.equal(await personalMailWorkspace(f.store,RECRUITER.email,{...env,GOOGLE_CLIENT_REVISION:1}),null);
  f.database.prepare('UPDATE hub_members SET active=0').run();assert.equal(await personalMailWorkspace(f.store,RECRUITER.email,env),null);
 }finally{f.database.close();}
});

test('owner can explicitly connect personal Gmail without falling back to company credentials',async()=>{
 const f=await fixture(),owner='sales@aicaseleads.com',ownerEnv={...env,ADMIN_EMAILS:owner};try{
  assert.equal(canConnectPersonalMail(' SALES@AICASELEADS.COM '),true);assert.equal(canConnectPersonalMail('not an email'),false);
  await f.store.setSetting('google_refresh_token','shared-storage-grant');await f.store.setSetting('google_sender',owner);
  const disconnected=await personalMailStatus(f.store,owner,ownerEnv);
  assert.equal(disconnected.canConnect,true);assert.equal(disconnected.connected,false);
  assert.equal(await personalMailWorkspace(f.store,owner,ownerEnv),null,'company authorization is not a substitute for personal consent');
  await f.store.setSetting(mailGrantKey(owner),{email:owner,sealedToken:await sealToken('owner-personal-refresh',key),revision:0,fingerprint:await configurationFingerprint(ownerEnv),connectedAt:Date.now()});
  const status=await personalMailStatus(f.store,' SALES@AICASELEADS.COM ',ownerEnv);assert.equal(status.connected,true);assert.equal(status.email,owner);
  assert.doesNotMatch(JSON.stringify(status),/sealedToken|refresh|fingerprint/);
  const workspace=await personalMailWorkspace(f.store,owner,ownerEnv);assert.equal(workspace?.status().sender,owner);assert.equal(workspace?.status().drive,false);assert.equal(workspace?.status().calendar,false);
  assert.equal(await personalMailWorkspace(f.store,owner,env),null,'an unconfigured nonmember cannot borrow an owner grant');
  assert.equal(await personalMailWorkspace(f.store,owner,{...ownerEnv,GOOGLE_CLIENT_REVISION:1}),null);
  assert.equal(await f.store.setting('google_refresh_token',''),'shared-storage-grant');
 }finally{f.database.close();}
});

test('owner personal-mail OAuth remains identity-bound and separate from company Google',async()=>{
 const f=await fixture(),owner={...MANAGER,email:'sales@aicaseleads.com'},ownerEnv={...env,ADMIN_EMAILS:'sales@aicaseleads.com'};try{
  await f.store.setSetting('google_refresh_token','shared-storage-grant');
  const state='f'.repeat(64),binding={flow:'personal-mail' as const,email:owner.email,verifier:'b'.repeat(64),revision:0,fingerprint:await configurationFingerprint(ownerEnv)},now=Date.now();
  f.database.prepare('INSERT INTO hub_oauth_states(state_hash,user_id,verifier,expires_at,used_at) VALUES(?,?,?,?,NULL)').run(await sha256(state),owner.userId,JSON.stringify(binding),now+60000);
  const claimed=await claimOAuthBinding(f.db,state,owner.userId,now),input={...claimed,member:owner,clientId:'client',clientSecret:'secret',tokenKey:key,redirectUri:origin+'/api/google/callback',code:'code'};
  await assert.rejects(()=>savePersonalMailGrant(f.db,input,google(RECRUITER.email)),/wrong_mail_account/);
  await savePersonalMailGrant(f.db,input,google(owner.email));
  const saved=await f.store.setting<{sealedToken:string}>(mailGrantKey(owner.email),{sealedToken:''});assert.equal(await openToken(saved.sealedToken,key),'personal-mail-refresh');
  assert.equal((await personalMailStatus(f.store,owner.email,ownerEnv)).connected,true);
  assert.equal(await f.store.setting('google_refresh_token',''),'shared-storage-grant');
 }finally{f.database.close();}
});

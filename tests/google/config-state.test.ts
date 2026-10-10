import test from "node:test";
import assert from "node:assert/strict";
import {customDatabase} from "../custom-fixture";
import {coherentGoogleGrant,configurationFingerprint,configureGoogleClient,decodeOAuthState,readGoogleConfiguration,saveGoogleGrant} from "../../lib/google/config-state";

test("OAuth state is bound to the chosen client, sender and configuration revision",async()=>{
 const client={GOOGLE_CLIENT_ID:"synthetic.apps.googleusercontent.com",GOOGLE_CLIENT_SECRET:"synthetic-test-secret",EXPECTED_RECRUITING_EMAIL:"mariam@aicaseleads.com"};
 const fingerprint=await configurationFingerprint(client),verifier="a".repeat(64);
 assert.notEqual(fingerprint,await configurationFingerprint({...client,GOOGLE_CLIENT_SECRET:"replacement-test-secret"}));
 assert.notEqual(fingerprint,await configurationFingerprint({...client,EXPECTED_RECRUITING_EMAIL:"other@example.invalid"}));
 assert.deepEqual(decodeOAuthState(JSON.stringify({verifier,revision:1,fingerprint})),{verifier,revision:1,fingerprint});
 for(const state of [verifier,JSON.stringify({verifier,revision:-1,fingerprint}),"{}"]){assert.throws(()=>decodeOAuthState(state),/configuration_changed/);}
});
test("a credential replacement invalidates unclaimed consent and fences an in-flight callback atomically",async()=>{
 const {database,db}=customDatabase();try{
  await configureGoogleClient(db,"old.apps.googleusercontent.com","sealed-old-secret");
  const claimedAt=Date.now(),fingerprint="b".repeat(64);
  database.prepare("INSERT INTO hub_oauth_states(state_hash,user_id,verifier,expires_at,used_at) VALUES ('claimed','owner','test',?,?)").run(claimedAt+60000,claimedAt);
  database.prepare("INSERT INTO hub_oauth_states(state_hash,user_id,verifier,expires_at,used_at) VALUES ('pending','owner','test',?,NULL)").run(claimedAt+60000);
  await configureGoogleClient(db,"new.apps.googleusercontent.com","sealed-new-secret");
  assert.deepEqual(await readGoogleConfiguration(db),{clientId:"new.apps.googleusercontent.com",clientSecret:"sealed-new-secret",revision:2});
  assert.ok(database.prepare("SELECT used_at FROM hub_oauth_states WHERE state_hash='pending'").get()!.used_at);
  await assert.rejects(saveGoogleGrant(db,{revision:1,fingerprint,stateHash:"claimed",userId:"owner",claimedAt,sealedToken:"old-refresh-token",sender:"mariam@aicaseleads.com"}),/configuration_changed/);
  assert.equal(database.prepare("SELECT key FROM hub_settings WHERE key IN ('google_refresh_token','google_sender','google_grant_revision','google_grant_fingerprint')").get(),undefined);
  database.prepare("INSERT INTO hub_oauth_states(state_hash,user_id,verifier,expires_at,used_at) VALUES ('new','owner','test',?,?)").run(claimedAt+60000,claimedAt);
  await saveGoogleGrant(db,{revision:2,fingerprint,stateHash:"new",userId:"owner",claimedAt,sealedToken:"new-refresh-token",sender:"mariam@aicaseleads.com"});
  assert.equal(database.prepare("SELECT value FROM hub_settings WHERE key='google_refresh_token'").get()!.value,'"new-refresh-token"');
  assert.equal(database.prepare("SELECT value FROM hub_settings WHERE key='google_grant_revision'").get()!.value,"2");
 }finally{database.close();}
});

test("runtime credential rotations cannot retain a connected grant for a previous client",async()=>{
 const oldClient={GOOGLE_CLIENT_ID:"old.apps.googleusercontent.com",GOOGLE_CLIENT_SECRET:"old-runtime-secret"};
 const nextClient={...oldClient,GOOGLE_CLIENT_SECRET:"new-runtime-secret"};
 const fingerprint=await configurationFingerprint(oldClient),grant={revision:0,fingerprint};
 assert.equal(coherentGoogleGrant(grant,0,fingerprint),true);
 assert.equal(coherentGoogleGrant(grant,0,await configurationFingerprint(nextClient)),false);
 assert.equal(coherentGoogleGrant({revision:0,fingerprint:null},0,fingerprint),false);
});

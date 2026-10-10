import { sha256 } from "../hiring/crypto";
import { expectedRecruitingSender } from "./sender";

type Client = {GOOGLE_CLIENT_ID?:string;GOOGLE_CLIENT_SECRET?:string;EXPECTED_RECRUITING_EMAIL?:string};
export type OAuthStateBinding={verifier:string;revision:number;fingerprint:string};
export async function configurationFingerprint(client:Client){
 return sha256(JSON.stringify([client.GOOGLE_CLIENT_ID,client.GOOGLE_CLIENT_SECRET,expectedRecruitingSender(client)]));
}
export function decodeOAuthState(value:string):OAuthStateBinding{
 try{
  const parsed=JSON.parse(value) as OAuthStateBinding;
  if(/^[a-f0-9]{64}$/.test(parsed.verifier)&&/^[a-f0-9]{64}$/.test(parsed.fingerprint)&&Number.isSafeInteger(parsed.revision)&&parsed.revision>=0)return parsed;
 }catch{}
 throw new Error("configuration_changed");
}
export async function readGoogleConfiguration(db:D1Database){
 const rows=await db.prepare("SELECT key,value FROM hub_settings WHERE key IN ('google_client_id','google_client_secret','google_client_revision')").all<{key:string;value:string}>();
 const values:Record<string,unknown>={};
 for(const row of rows.results){try{values[row.key]=JSON.parse(row.value);}catch{values[row.key]=row.value;}}
 const revision=values.google_client_revision??0;
 if(!Number.isSafeInteger(revision)||Number(revision)<0)throw new Error("configuration_changed");
 return {clientId:values.google_client_id,clientSecret:values.google_client_secret,revision:Number(revision)};
}
export async function configureGoogleClient(db:D1Database,clientId:string,sealedSecret:string){
 const now=Date.now();
 await db.batch([
  db.prepare("INSERT INTO hub_settings(key,value,updated_at) VALUES ('google_client_revision','1',?) ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(hub_settings.value AS INTEGER)+1 AS TEXT),updated_at=excluded.updated_at").bind(now),
  db.prepare("INSERT INTO hub_settings(key,value,updated_at) VALUES ('google_client_id',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(JSON.stringify(clientId),now),
  db.prepare("INSERT INTO hub_settings(key,value,updated_at) VALUES ('google_client_secret',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(JSON.stringify(sealedSecret),now),
  db.prepare("DELETE FROM hub_settings WHERE key IN ('google_refresh_token','google_sender','google_grant_revision','google_grant_fingerprint')"),
  db.prepare("UPDATE hub_oauth_states SET used_at=? WHERE used_at IS NULL").bind(now),
 ]);
}
/** The first NOT NULL constraint fences the entire atomic batch against credential changes during Google consent. */
export function coherentGoogleGrant(grant:{revision:unknown;fingerprint:unknown},revision:number,fingerprint:string){
 return grant.revision===revision&&grant.fingerprint===fingerprint;
}
export async function saveGoogleGrant(db:D1Database,input:{revision:number;fingerprint:string;stateHash:string;userId:string;claimedAt:number;sealedToken:string;sender:string}){
 const now=Date.now();
 try{
  await db.batch([
   db.prepare("INSERT INTO hub_settings(key,value,updated_at) VALUES ('google_grant_revision',CASE WHEN COALESCE((SELECT CAST(value AS INTEGER) FROM hub_settings WHERE key='google_client_revision'),0)=? AND EXISTS(SELECT 1 FROM hub_oauth_states WHERE state_hash=? AND user_id=? AND used_at=?) THEN ? ELSE NULL END,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(input.revision,input.stateHash,input.userId,input.claimedAt,String(input.revision),now),
   db.prepare("INSERT INTO hub_settings(key,value,updated_at) VALUES ('google_refresh_token',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(JSON.stringify(input.sealedToken),now),
   db.prepare("INSERT INTO hub_settings(key,value,updated_at) VALUES ('google_sender',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(JSON.stringify(input.sender),now),
   db.prepare("INSERT INTO hub_settings(key,value,updated_at) VALUES ('google_grant_fingerprint',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(JSON.stringify(input.fingerprint),now),
  ]);
 }catch{throw new Error("configuration_changed");}
}

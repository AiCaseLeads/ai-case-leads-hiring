import type { HubMember } from "../hub/auth-core";
import { exchangeMailCode,sealToken } from "../google/oauth";
import type { OAuthStateBinding } from "../google/config-state";
import { mailGrantKey,canConnectPersonalMail } from "./service";
export async function savePersonalMailGrant(db:D1Database,input:{binding:OAuthStateBinding;member:HubMember;stateHash:string;claimedAt:number;clientId:string;clientSecret:string;tokenKey:string;redirectUri:string;code:string},fetcher:typeof fetch=fetch){
 const {binding,member}=input;
 if(!canConnectPersonalMail(member.email)||binding.flow!=="personal-mail"||binding.email!==member.email.toLowerCase())throw new Error("wrong_mail_account");
 const grant=await exchangeMailCode({clientId:input.clientId,clientSecret:input.clientSecret,redirectUri:input.redirectUri,code:input.code,codeVerifier:binding.verifier},fetcher);
 if(grant.email!==member.email.toLowerCase())throw new Error("wrong_mail_account");
 if(!grant.refreshToken)throw new Error("offline_grant_missing");
 const value=JSON.stringify({email:grant.email,sealedToken:await sealToken(grant.refreshToken,input.tokenKey),revision:binding.revision,fingerprint:binding.fingerprint,connectedAt:Date.now()});
 // Credentials changed, another callback, or a consumed/revoked state cannot replace a grant.
 await db.prepare("INSERT INTO hub_settings(key,value,updated_at) VALUES (?,CASE WHEN COALESCE((SELECT CAST(value AS INTEGER) FROM hub_settings WHERE key='google_client_revision'),0)=? AND EXISTS(SELECT 1 FROM hub_oauth_states WHERE state_hash=? AND user_id=? AND used_at=?) THEN ? ELSE NULL END,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(mailGrantKey(grant.email),binding.revision,input.stateHash,member.userId,input.claimedAt,value,Date.now()).run();
}

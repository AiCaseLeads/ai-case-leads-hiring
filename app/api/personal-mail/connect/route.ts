import { canConnectPersonalMail } from "@/lib/personal-mail/service";
import { requireHubMember } from "@/lib/hub/auth";
import { resolvedWorkspaceEnv } from "@/lib/workspace-config";
import { assertSameOrigin,errorResponse,jsonResponse } from "@/lib/hiring/http";
import { privateToken,sha256 } from "@/lib/hiring/crypto";
import { HiringError } from "@/lib/hiring/errors";
import { authorizationUrl,PERSONAL_MAIL_SCOPES } from "@/lib/google/oauth";
import { configurationFingerprint } from "@/lib/google/config-state";
export const dynamic="force-dynamic";
export async function POST(request:Request){try{
 const member=await requireHubMember(request);assertSameOrigin(request);
 if(!canConnectPersonalMail(member.email))throw new HiringError("recruiter_mail_required",403,"The sales account cannot connect recruiting email. Maria must connect using her own staff login.");
 const env=await resolvedWorkspaceEnv();
 if(!env.DB||!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_TOKEN_KEY)throw new HiringError("google_setup_required",503,"Ask your account owner to configure the Google connection first.");
 const state=privateToken(),verifier=privateToken();
 const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier)));
 const challenge=btoa(String.fromCharCode(...digest)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
 await env.DB.prepare("INSERT INTO hub_oauth_states(state_hash,user_id,verifier,expires_at,used_at) VALUES (?,?,?,?,NULL)").bind(await sha256(state),member.userId,JSON.stringify({flow:"personal-mail",email:member.email.toLowerCase(),verifier,revision:env.GOOGLE_CLIENT_REVISION??0,fingerprint:await configurationFingerprint(env)}),Date.now()+600000).run();
 const url=new URL(authorizationUrl({clientId:env.GOOGLE_CLIENT_ID,redirectUri:`${new URL(request.url).origin}/api/google/callback`,state,codeChallenge:challenge,loginHint:member.email,scopes:PERSONAL_MAIL_SCOPES}));
 // Do not combine the company Drive/Calendar grant with a personal-mail request.
 url.searchParams.set("include_granted_scopes","false");
 return jsonResponse({data:{url:url.toString()}});
}catch(error){return errorResponse(error);}}

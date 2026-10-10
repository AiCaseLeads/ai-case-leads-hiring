import { requireHubMember,requireHubAdmin } from "@/lib/hub/auth";
import { resolvedWorkspaceEnv } from "@/lib/workspace-config";
import { assertSameOrigin,errorResponse,jsonResponse } from "@/lib/hiring/http";
import { privateToken,sha256 } from "@/lib/hiring/crypto";
import { HiringError } from "@/lib/hiring/errors";
import { authorizationUrl } from "@/lib/google/workspace";
import { configurationFingerprint } from "@/lib/google/config-state";
import { expectedRecruitingSender } from "@/lib/google/sender";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  try{
    const member=await requireHubMember(request);requireHubAdmin(member);assertSameOrigin(request);
    const env=await resolvedWorkspaceEnv();
    if(!env.DB||!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_TOKEN_KEY)throw new HiringError("google_setup_required",503,"Add your Google OAuth client ID and secret through the secure site settings, then connect Workspace. The setup guide lists the exact steps.");
    const state=privateToken(),verifier=privateToken();
    const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier)));
    const challenge=btoa(String.fromCharCode(...digest)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
    await env.DB.prepare("INSERT INTO hub_oauth_states (state_hash,user_id,verifier,expires_at,used_at) VALUES (?,?,?,?,NULL)").bind(await sha256(state),member.userId,JSON.stringify({verifier,revision:env.GOOGLE_CLIENT_REVISION??0,fingerprint:await configurationFingerprint(env)}),Date.now()+10*60*1000).run();
    const url=new URL(authorizationUrl({clientId:env.GOOGLE_CLIENT_ID,redirectUri:`${new URL(request.url).origin}/api/google/callback`,state,codeChallenge:challenge}));
    url.searchParams.set("login_hint",expectedRecruitingSender(env));
    return jsonResponse({data:{url:url.toString()}});
  }catch(error){return errorResponse(error);}
}

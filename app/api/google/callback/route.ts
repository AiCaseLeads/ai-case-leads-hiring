import { requireHubMember,requireHubAdmin } from "@/lib/hub/auth";
import { resolvedWorkspaceEnv,readSetting } from "@/lib/workspace-config";
import { sha256 } from "@/lib/hiring/crypto";
import { exchangeCode,sealToken,scopeStatus } from "@/lib/google/workspace";
import { configurationFingerprint,decodeOAuthState,saveGoogleGrant } from "@/lib/google/config-state";
import { assertRecruitingSender } from "@/lib/google/sender";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  const origin=new URL(request.url).origin;
  try{
    const member=await requireHubMember(request);requireHubAdmin(member);
    const env=await resolvedWorkspaceEnv(),url=new URL(request.url),state=url.searchParams.get("state"),code=url.searchParams.get("code");
    if(!env.DB||!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_TOKEN_KEY||!state||!code||url.searchParams.has("error")||!/^[a-f0-9]{64}$/.test(state))throw new Error("oauth_invalid");
    const stateHash=await sha256(state),claimedAt=Date.now();
    const claim=await env.DB.prepare("UPDATE hub_oauth_states SET used_at=? WHERE state_hash=? AND user_id=? AND used_at IS NULL AND expires_at>? RETURNING verifier").bind(claimedAt,stateHash,member.userId,claimedAt).first<{verifier:string}>();
    if(!claim)throw new Error("oauth_expired");
    const binding=decodeOAuthState(claim.verifier);
    if(binding.revision!==(env.GOOGLE_CLIENT_REVISION??0)||binding.fingerprint!==await configurationFingerprint(env))throw new Error("configuration_changed");
    const grant=await exchangeCode({clientId:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,redirectUri:`${origin}/api/google/callback`,code,codeVerifier:binding.verifier});
    const scopes=scopeStatus(grant.scope);if(!scopes.mail||!scopes.calendar||!scopes.drive)throw new Error("missing_permissions");
    if(!grant.refreshToken)throw new Error("offline_grant_missing");
    const sender=grant.email.toLowerCase();
    assertRecruitingSender(sender,env);
    const sealed=await sealToken(grant.refreshToken,env.GOOGLE_TOKEN_KEY);
    await saveGoogleGrant(env.DB,{revision:binding.revision,fingerprint:binding.fingerprint,stateHash,userId:member.userId,claimedAt,sealedToken:sealed,sender});
    // Do not put OAuth codes, Google errors, or refresh tokens into a redirect.
    const calendar=await readSetting(env.DB,"google_calendar_id");
    return Response.redirect(`${origin}/team?workspace=connected${calendar?"":"&calendar=setup"}`,303);
  }catch(error){
    const code=error&&typeof error==="object"&&"code"in error?error.code:error instanceof Error?error.message:"";
    const reason=["wrong_sender","missing_permissions","offline_grant_missing","configuration_changed"].includes(String(code))?`&reason=${String(code)}`:"";
    return Response.redirect(`${origin}/team?workspace=connection_failed${reason}`,303);
  }
}

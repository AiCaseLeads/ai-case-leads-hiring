import { savePersonalGrant } from "@/lib/personal-calendar/oauth";
import { requireHubMember,requireHubAdmin } from "@/lib/hub/auth";
import { resolvedWorkspaceEnv,readSetting } from "@/lib/workspace-config";
import { exchangeCode,sealToken,scopeStatus } from "@/lib/google/workspace";
import { configurationFingerprint,claimOAuthBinding,saveGoogleGrant } from "@/lib/google/config-state";
import { assertRecruitingSender } from "@/lib/google/sender";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  const origin=new URL(request.url).origin;
  let personal=false;
  try{
    const member=await requireHubMember(request);
    const env=await resolvedWorkspaceEnv(),url=new URL(request.url),state=url.searchParams.get("state"),code=url.searchParams.get("code");
    if(!env.DB||!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_TOKEN_KEY||!state||!/^[a-f0-9]{64}$/.test(state))throw new Error("oauth_invalid");
    const {binding,stateHash,claimedAt}=await claimOAuthBinding(env.DB,state,member.userId);
    personal=binding.flow==="personal-calendar";
    if(!personal)requireHubAdmin(member);
    if(!code||url.searchParams.has("error"))throw new Error("oauth_invalid");
    if(binding.revision!==(env.GOOGLE_CLIENT_REVISION??0)||binding.fingerprint!==await configurationFingerprint(env))throw new Error("configuration_changed");
    if(personal){
      await savePersonalGrant(env.DB,{binding,member,stateHash,claimedAt,clientId:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,tokenKey:env.GOOGLE_TOKEN_KEY,redirectUri:`${origin}/api/google/callback`,code});
      return Response.redirect(`${origin}/team?view=settings&personalCalendar=connected`,303);
    }
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
    const reason=["wrong_sender","missing_permissions","offline_grant_missing","configuration_changed","wrong_calendar_account"].includes(String(code))?`&reason=${String(code)}`:"";
    return Response.redirect(`${origin}/team?${personal?"view=settings&personalCalendar":"workspace"}=connection_failed${reason}`,303);
  }
}

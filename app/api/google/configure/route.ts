import { requireHubMember,requireHubOwner } from "@/lib/hub/auth";
import { workspaceEnv } from "@/lib/workspace-config";
import { assertSameOrigin,errorResponse,jsonResponse } from "@/lib/hiring/http";
import { boundedBytes } from "@/lib/hiring/files";
import { HiringError } from "@/lib/hiring/errors";
import { configureGoogleClient } from "@/lib/google/config-state";
import { sealToken } from "@/lib/google/workspace";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  try{
    const member=await requireHubMember(request);requireHubOwner(member);assertSameOrigin(request);
    const env=workspaceEnv();if(!env.DB||!env.GOOGLE_TOKEN_KEY)throw new HiringError("google_setup_required",503,"Secure Workspace configuration is unavailable.");
    if(env.GOOGLE_CLIENT_ID||env.GOOGLE_CLIENT_SECRET)throw new HiringError("runtime_configuration_locked",409,"Google credentials are managed in the hosting settings. Update them there, then reconnect Workspace.");
    const body=JSON.parse(new TextDecoder().decode(await boundedBytes(request,16384))) as Record<string,unknown>;
    if(typeof body.clientId!=="string"||!/^[-a-zA-Z0-9.]+\.apps\.googleusercontent\.com$/.test(body.clientId)||typeof body.clientSecret!=="string"||body.clientSecret.length<12||body.clientSecret.length>500||/[\r\n\x00]/.test(body.clientSecret))throw new HiringError("invalid_request",400,"Enter the web application client ID and client secret from Google Cloud.");
    const sealed=await sealToken(body.clientSecret,env.GOOGLE_TOKEN_KEY);
    await configureGoogleClient(env.DB,body.clientId,sealed);
    return jsonResponse({data:{configured:true,connected:false}});
  }catch(error){return errorResponse(error);}
}

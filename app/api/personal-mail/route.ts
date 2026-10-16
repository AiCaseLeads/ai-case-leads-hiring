import {requireHubMember} from '@/lib/hub/auth';
import {getHubStore} from '@/lib/hub/runtime';
import {resolvedWorkspaceEnv} from '@/lib/workspace-config';
import {jsonResponse,errorResponse} from '@/lib/hiring/http';
import {personalMailStatus} from '@/lib/personal-mail/service';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const member=await requireHubMember(request),store=await getHubStore(request),env=await resolvedWorkspaceEnv();
 return jsonResponse({data:{...await personalMailStatus(store,member.email,env),automaticProvider:"sendgrid"}});
}catch(error){return errorResponse(error);}}

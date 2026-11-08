import { requireHubMember } from '@/lib/hub/auth';
import { getHubStore } from '@/lib/hub/runtime';
import { resolvedWorkspaceEnv } from '@/lib/workspace-config';
import { interviewReadiness } from '@/lib/hub/interview-readiness';
import { errorResponse,jsonResponse } from '@/lib/hiring/http';
import { HiringError } from '@/lib/hiring/errors';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
 try {
  const member=await requireHubMember(request),store=await getHubStore(request),env=await resolvedWorkspaceEnv();
  const params=new URL(request.url).searchParams,id=params.get('applicationId'),interviewerEmail=params.get('interviewerEmail')||undefined;
  if(interviewerEmail&&(interviewerEmail.length>320||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(interviewerEmail)))throw new HiringError('invalid_interviewer',422,'Choose a valid interviewer.');
  if(!id || id.length>200) throw new HiringError('application_required',422,'Choose an applicant first.');
  return jsonResponse({data:await interviewReadiness(store,member,id,{...env,ADMIN_EMAILS:process.env.ADMIN_EMAILS},{interviewerEmail})});
 } catch(error) {return errorResponse(error);}
}

import { requireHubMember } from "@/lib/hub/auth";
import { getHubStore } from "@/lib/hub/runtime";
import { errorResponse } from "@/lib/hiring/http";
import { handleScorecards } from "@/lib/scorecards/http";
export const dynamic="force-dynamic";
async function handle(request:Request){try{return handleScorecards(request,await requireHubMember(request),await getHubStore(request));}catch(error){return errorResponse(error);}}
export const GET=handle;
export const PATCH=handle;

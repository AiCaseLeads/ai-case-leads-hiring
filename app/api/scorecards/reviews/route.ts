import { requireHubMember } from "@/lib/hub/auth";
import { getHubStore } from "@/lib/hub/runtime";
import { errorResponse } from "@/lib/hiring/http";
import { handleScorecardReview } from "@/lib/scorecards/http";
export const dynamic="force-dynamic";
export async function POST(request:Request){try{return handleScorecardReview(request,await requireHubMember(request),await getHubStore(request));}catch(error){return errorResponse(error);}}

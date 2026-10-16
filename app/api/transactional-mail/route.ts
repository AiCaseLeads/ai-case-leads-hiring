import { requireHubMember, requireHubAdmin } from '@/lib/hub/auth';
import { automaticMailStatus } from '@/lib/email/service';
import { errorResponse, jsonResponse } from '@/lib/hiring/http';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    requireHubAdmin(await requireHubMember(request));
    return jsonResponse({ data: await automaticMailStatus() });
  } catch (error) { return errorResponse(error); }
}

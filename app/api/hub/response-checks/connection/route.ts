import { requireHubMember, requireHubOwner } from "@/lib/hub/auth";
import { getHubStore } from "@/lib/hub/runtime";
import { assertSameOrigin, errorResponse, jsonResponse } from "@/lib/hiring/http";
import { boundedBytes } from "@/lib/hiring/files";
import { HiringError } from "@/lib/hiring/errors";
import { saveDetectorKey } from "@/lib/response-checks/key";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    requireHubOwner(await requireHubMember(request));
    assertSameOrigin(request);
    const bytes = await boundedBytes(request,2048);
    let input;
    try { input=JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new HiringError("invalid_detector_request",400,"Enter a GPTZero API key."); }
    return jsonResponse({data:await saveDetectorKey(await getHubStore(request),input?.apiKey)});
  } catch (error) { return errorResponse(error); }
}

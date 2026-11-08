import { requireHubMember } from '@/lib/hub/auth';
import { getHubStore } from '@/lib/hub/runtime';
import { sha256 } from '@/lib/hiring/crypto';
import { HiringError } from '@/lib/hiring/errors';
import { errorResponse } from '@/lib/hiring/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireHubMember(request);
    const store = await getHubStore(request);
    const params = new URL(request.url).searchParams;
    const applicationId = params.get('applicationId');
    const interviewId = params.get('interviewId');
    const unavailable = () => new HiringError('link_unavailable', 404, 'This interview has no active sent booking link.');
    if (!applicationId || !interviewId || applicationId.length > 200 || interviewId.length > 200) throw unavailable();
    const row = await store.stmt(
      `SELECT json_extract(t.payload_json,'$.body') AS body, l.token_hash
       FROM hub_links l JOIN hub_communications c ON c.application_id=l.application_id
       JOIN hub_tasks t ON t.id=c.task_id AND t.application_id=l.application_id
       WHERE l.application_id=? AND l.kind='interview' AND l.used_at IS NULL AND l.expires_at>?
         AND json_extract(l.payload_json,'$.interviewId')=? AND c.status='sent'
         AND instr(t.id,?)=1 ORDER BY c.created_at DESC LIMIT 1`,
      applicationId, Date.now(), interviewId, `gmail:${applicationId}:interview:${interviewId}:invitation:`,
    ).first<{body:string;token_hash:string}>();
    if (!row?.body) throw unavailable();
    for (const match of row.body.matchAll(/\/interview\/([a-f0-9]{64})(?![a-f0-9])/g)) {
      if (await sha256(match[1]) === row.token_hash) {
        return new Response(null, {status:302, headers:{Location:`/interview/${match[1]}`, 'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
      }
    }
    throw unavailable();
  } catch (error) { return errorResponse(error); }
}

import { requireId, sha256, verifyAshbySignature } from "./security";
import type { ArchiveStore } from "./store";

const APPLICATION_ACTIONS = new Set(["applicationSubmit", "applicationUpdate", "candidateHire", "candidateStageChange"]);
const TAKE_HOME_ACTIONS = new Set(["takeHomeAssignmentAssigned", "takeHomeAssignmentCancelled", "takeHomeAssignmentCompleted", "takeHomeAssignmentSubmitted"]);

export async function acceptWebhook(raw: Uint8Array, signature: string | null, secret: string, store: ArchiveStore): Promise<{ status: number; code: string }> {
  if (!await verifyAshbySignature(raw, signature, secret)) return { status: 401, code: "invalid_signature" };
  let body: { webhookActionId?: unknown; action?: unknown; data?: Record<string, unknown> };
  try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return { status: 400, code: "invalid_json" }; }
  if (typeof body.action !== "string" || body.action.length > 100) return { status: 400, code: "invalid_event" };
  // Authenticated pings are part of Ashby's webhook enablement handshake.
  if (body.action === "ping") return { status: 200, code: "ping" };
  let eventId: string;
  let applicationId: string | null = null;
  try {
    eventId = requireId(body.webhookActionId);
    const data = body.data ?? {};
    if (APPLICATION_ACTIONS.has(body.action)) applicationId = requireId((data.application as { id?: unknown } | undefined)?.id);
    if (TAKE_HOME_ACTIONS.has(body.action)) applicationId = requireId((data.takeHomeAssignment as { applicationId?: unknown } | undefined)?.applicationId);
    if (body.action === "surveySubmit") {
      const id = (data.surveySubmission as { applicationId?: unknown } | undefined)?.applicationId;
      if (id) applicationId = requireId(id);
    }
  } catch { return { status: 400, code: "invalid_event" }; }
  // Related actions (hire/stage-change/application-update) legitimately share one webhookActionId.
  // Dedupe only within the same action; companion events remain independently durable.
  const result = await store.recordWebhook(`${body.action}:${eventId}`, applicationId, body.action, await sha256(raw));
  return result === "conflict" ? { status: 409, code: "event_identity_conflict" } : { status: 200, code: result };
}

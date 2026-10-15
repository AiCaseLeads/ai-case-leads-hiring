import { z } from "zod";
import { jobInput, parse } from "../hub/validation";
import type { HubStore } from "../hub/store";
import type { HubMember } from "../hub/auth-core";
import { HiringError } from "../hiring/errors";
import { assertSameOrigin, errorResponse, jsonResponse } from "../hiring/http";
import { boundedBytes } from "../hiring/files";
import { sha256 } from "../hiring/crypto";
const draftField = jobInput.shape.fields.element.extend({
  title: z.string().max(160),
});
const draftRule = jobInput.shape.rules.element.extend({
  reason: z.string().max(500),
  value: jobInput.shape.rules.element.shape.value.nullable(),
});
export const draftStateSchema = z
  .object({
    title: z.string().max(160),
    description: z.string().max(100000),
    location: z
      .object({
        workModel: z.enum(["remote", "hybrid", "onsite"]),
        country: z.string().max(120),
        city: z.string().max(120),
      })
      .strict()
      .nullable(),
    fields: z.array(draftField).max(100),
    department: z.string().max(160),
    customSlug: z.string().max(160).nullable(),
    assessment: z.string().max(20000),
    rules: z.array(draftRule).max(100),
    autoReject: z.boolean(),
    rejection: z.string().max(10000),
    choice: z.string().max(200),
    rubric: z
      .object({
        name: z.string().max(160),
        criteria: z
          .array(
            z
              .object({
                label: z.string().max(500),
                weight: z.number().finite(),
                anchors: z.tuple([
                  z.string().max(2000),
                  z.string().max(2000),
                  z.string().max(2000),
                  z.string().max(2000),
                  z.string().max(2000),
                ]),
              })
              .strict(),
          )
          .max(100),
      })
      .strict(),
    team: z
      .object({
        members: z.array(z.string().email()).max(100),
        replyTo: z.string().email().nullable(),
        notifyNewApplications: z.boolean(),
        notifyAssessmentSubmissions: z.boolean(),
        notifyReplies: z.boolean(),
        notifyOverdueReviews: z.boolean(),
      })
      .strict()
      .nullable(),
    teamRevision: z.number().int().min(0).nullable(),
    expectedBinding: z
      .object({
        templateId: z.string().max(200),
        version: z.number().int().positive(),
      })
      .strict()
      .nullable(),
    step: z.number().int().min(0).max(3),
    creationId: z.string().uuid(),
    postingLabel: z.string().max(120),
    formVersion: z.number().int().positive().nullable(),
    startKind: z.enum(["blank", "duplicate", "template", "request"]),
    sourceId: z.string().max(200),
  })
  .strict();
export type JobRecoveryState = z.infer<typeof draftStateSchema>;
export type JobRecoveryDraft = {
  key: string;
  revision: number;
  updatedAt: number;
  state: JobRecoveryState;
};
const keySchema = z.string().regex(/^[a-zA-Z0-9:_-]{1,250}$/);
const command = z
  .object({
    key: keySchema,
    expectedRevision: z.number().int().min(0),
    state: draftStateSchema.optional(),
  })
  .strict();
const TTL = 30 * 24 * 60 * 60 * 1000;
export async function handleJobDrafts(
  request: Request,
  member: HubMember | null,
  store: HubStore,
) {
  try {
    if (!member)
      throw new HiringError(
        "staff_access_required",
        403,
        "Sign in to access your private job drafts.",
      );
    const prefix =
      "job_recovery_v1:" + (await sha256(member.email.toLowerCase())) + ":";
    if (request.method === "GET") {
      const raw = new URL(request.url).searchParams.get("key");
      if (raw) {
        const key = parse(keySchema, raw);
        const record = await store.setting<JobRecoveryDraft | null>(
          prefix + key,
          null,
        );
        return jsonResponse({ data: record });
      }
      const rows = await store.rows<{ value: string }>(
        "SELECT value FROM hub_settings WHERE key LIKE ? AND updated_at > ? ORDER BY updated_at DESC LIMIT 100",
        prefix + "%",
        Date.now() - TTL,
      );
      return jsonResponse({
        data: rows
          .map((r) => JSON.parse(r.value) as JobRecoveryDraft)
          .map(({ key, revision, updatedAt, state }) => ({
            key,
            revision,
            updatedAt,
            title: state.title,
            startKind: state.startKind,
            sourceId: state.sourceId,
          })),
      });
    }
    assertSameOrigin(request);
    if (!["PUT", "DELETE"].includes(request.method))
      throw new HiringError("method_not_allowed", 405, "Method not supported.");
    let input: unknown;
    try {
      input = JSON.parse(
        new TextDecoder().decode(await boundedBytes(request, 512 * 1024)),
      );
    } catch (e) {
      if (e instanceof HiringError) throw e;
      throw new HiringError(
        "invalid_request",
        400,
        "The draft could not be read.",
      );
    }
    const value = parse(command, input),
      key = prefix + value.key;
    const previous = await store.setting<JobRecoveryDraft | null>(key, null);
    if ((previous?.revision || 0) !== value.expectedRevision)
      throw new HiringError(
        "draft_conflict",
        409,
        "This draft changed in another tab. Your entries are still here; reopen the job in a separate tab to review the saved copy.",
      );
    if (request.method === "DELETE") {
      const result = await store
        .stmt(
          "DELETE FROM hub_settings WHERE key=? AND value=?",
          key,
          JSON.stringify(previous),
        )
        .run();
      if (previous && !result.meta.changes)
        throw new HiringError(
          "draft_conflict",
          409,
          "The saved draft changed. Try again before leaving.",
        );
      return jsonResponse({ data: true });
    }
    if (!value.state)
      throw new HiringError(
        "invalid_request",
        400,
        "Draft content is required.",
      );
    const record: JobRecoveryDraft = {
      key: value.key,
      revision: value.expectedRevision + 1,
      updatedAt: Date.now(),
      state: value.state,
    };
    const result = previous
      ? await store
          .stmt(
            "UPDATE hub_settings SET value=?,updated_at=? WHERE key=? AND value=?",
            JSON.stringify(record),
            record.updatedAt,
            key,
            JSON.stringify(previous),
          )
          .run()
      : await store
          .stmt(
            "INSERT INTO hub_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO NOTHING",
            key,
            JSON.stringify(record),
            record.updatedAt,
          )
          .run();
    if (!result.meta.changes)
      throw new HiringError(
        "draft_conflict",
        409,
        "This draft changed in another tab. Your entries are still here.",
      );
    return jsonResponse({ data: record });
  } catch (e) {
    return errorResponse(e);
  }
}

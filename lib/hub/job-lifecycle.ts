import { z } from "zod";
import { HiringError } from "../hiring/errors";
import { validateJob } from "./validation";
import type { HubMember } from "./auth-core";
import type { HubStore } from "./store";
import type { HubJob } from "./types";

export type JobLifecycle = {
  state: "active" | "archived" | "deleted";
  revision: number;
  changedAt: number;
  changedBy: string;
};
export const jobLifecycleKey = (id: string) => `job_lifecycle_${id}`;
export const jobLifecycleInput = z.object({
  action: z.enum(["pause", "resume", "archive", "delete", "restore"]),
  formVersion: z.number().int().positive().safe(),
  lifecycleRevision: z.number().int().nonnegative().safe(),
}).strict();
export type JobLifecycleAction = z.infer<typeof jobLifecycleInput>["action"];

export function assertJobEditable(job: HubJob) {
  if (job.lifecycle && job.lifecycle.state !== "active") {
    throw new HiringError("job_restore_required", 409,
      "Restore this job before editing or publishing it. Its applications are still saved.");
  }
}

/** Lifecycle changes preserve formVersion so existing AI reviews remain valid. */
export async function changeJobLifecycle(
  store: HubStore, id: string, input: z.infer<typeof jobLifecycleInput>, member: HubMember,
): Promise<HubJob> {
  const existing = await store.getJob(id), lifecycle = existing.lifecycle,
    state = lifecycle?.state || "active", revision = lifecycle?.revision || 0;
  if (existing.formVersion !== input.formVersion || revision !== input.lifecycleRevision) {
    throw new HiringError("record_changed", 409, "This job changed. Refresh the job list before trying again.");
  }
  let nextState: JobLifecycle["state"] = state, nextStatus = existing.status;
  switch (input.action) {
    case "pause":
      if (state !== "active" || existing.status !== "open") throw unavailable();
      nextStatus = "closed";
      break;
    case "resume":
      if (state !== "active" || existing.status !== "closed") throw unavailable();
      validateJob({ ...existing, status: "open" });
      nextStatus = "open";
      break;
    case "archive":
      if (state !== "active") throw unavailable();
      nextState = "archived";
      nextStatus = "closed";
      break;
    case "delete":
      if (state === "deleted") throw unavailable();
      nextState = "deleted";
      nextStatus = "closed";
      break;
    case "restore":
      if (state === "active") throw unavailable();
      nextState = "active";
      // Restoring never publishes a job unexpectedly.
      nextStatus = "closed";
      break;
  }
  const now = Date.now(), next: JobLifecycle = {
    state: nextState, revision: revision + 1, changedAt: now, changedBy: member.email,
  };
  try {
    // The NOT NULL guard rolls back both writes if a job edit or competing
    // lifecycle action wins the race. No applicant, file, or AI rows are changed.
    await store.db.batch([
      store.stmt(`INSERT INTO hub_settings(key,value,updated_at)
        VALUES(?,CASE WHEN (SELECT form_version FROM hub_jobs WHERE id=?)=?
          AND (SELECT status FROM hub_jobs WHERE id=?)=?
          AND COALESCE((SELECT json_extract(value,'$.revision') FROM hub_settings WHERE key=?),0)=?
          THEN ? ELSE NULL END,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
        jobLifecycleKey(id), id, input.formVersion, id, existing.status,
        jobLifecycleKey(id), revision, JSON.stringify(next), now),
      store.stmt("UPDATE hub_jobs SET status=?,updated_at=? WHERE id=?", nextStatus, now, id),
    ]);
  } catch {
    throw new HiringError("record_changed", 409, "This job changed. Refresh the job list before trying again.");
  }
  return store.getJob(id);
}
function unavailable() {
  return new HiringError("job_action_unavailable", 409, "That action is no longer available. Refresh the job list.");
}

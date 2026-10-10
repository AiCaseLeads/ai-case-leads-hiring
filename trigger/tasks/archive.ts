import { task, schedules } from "@trigger.dev/sdk";
import { AshbyArchiveClient } from "../../lib/archive/ashby";
import { GoogleDriveArchive } from "../../lib/archive/drive";
import { ArchiveInternalClient } from "../../lib/archive/internal-client";
import { archiveApplication } from "../../lib/archive/service";
import { reconciliationStreams, reconcilePage } from "../../lib/archive/reconcile";
import { requireId, safeError } from "../../lib/archive/security";

function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name.toLowerCase()}_missing`); return value; }
function internal() { return new ArchiveInternalClient(required("HIRING_SITE_URL"), required("HIRING_INTERNAL_SECRET")); }
function ashby() { return new AshbyArchiveClient(required("ASHBY_ARCHIVE_API_KEY")); }

export const archiveCandidateApplication = task({
  id: "hiring-archive-application",
  // One creator at a time prevents conflicting folder and resumable-session writes.
  queue: { name: "hiring-drive-archive", concurrencyLimit: 1 },
  retry: { maxAttempts: 5, minTimeoutInMs: 5000, maxTimeoutInMs: 60000, factor: 2, randomize: true },
  run: async (payload: { eventId: string }) => {
    const client = internal();
    const event = await client.claim(payload.eventId);
    if (!event?.application_id || !event.lease_token) return { skipped: true };
    try {
      const hosts = required("ASHBY_FILE_DOWNLOAD_HOSTS").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
      const result = await archiveApplication({
        applicationId: event.application_id,
        rootFolderId: required("GOOGLE_DRIVE_RECRUITING_FOLDER_ID"),
        allowedDownloadHosts: hosts,
        ashby: ashby(),
        drive: new GoogleDriveArchive({ clientId: required("GOOGLE_CLIENT_ID"), clientSecret: required("GOOGLE_CLIENT_SECRET"), refreshToken: required("GOOGLE_REFRESH_TOKEN") }, client),
        syncFieldIds: { folder: process.env.ASHBY_DRIVE_FOLDER_FIELD_ID, status: process.env.ASHBY_DRIVE_STATUS_FIELD_ID },
      });
      await client.complete(event.id, event.lease_token, "synced", result.folderId, null);
      // No candidate names, files, URLs, or submitted answers in task output.
      return { synced: true, filesArchived: result.filesArchived };
    } catch (error) {
      await client.complete(event.id, event.lease_token, "error", null, safeError(error));
      throw new Error(safeError(error));
    }
  },
});

export const dispatchArchiveOutbox = schedules.task({
  id: "hiring-archive-dispatch",
  cron: "* * * * *",
  queue: { name: "hiring-archive-dispatch", concurrencyLimit: 1 },
  run: async () => {
    const events = await internal().pending();
    if (events.length) await archiveCandidateApplication.batchTrigger(events.map((event) => ({
      payload: { eventId: event.id },
      options: { idempotencyKey: `archive:${event.id}:${event.attempts}`, idempotencyKeyTTL: "24h" },
    })));
    return { dispatched: events.length };
  },
});

export const reconcileHiringArchive = schedules.task({
  id: "hiring-archive-reconcile",
  cron: "0 * * * *",
  queue: { name: "hiring-archive-reconcile", concurrencyLimit: 1 },
  run: async () => {
    const client = internal();
    const provider = ashby();
    await client.call("cleanup", {});
    let failures = 0;
    const unresolved = await client.call<{ submissions: Array<{ key_hash: string; submitted_form_instance_id: string }> }>("unresolved");
    for (const submission of unresolved.submissions) {
      try {
        const application = await provider.info<{ id: string }>("application.info", { submittedFormInstanceId: submission.submitted_form_instance_id });
        await client.call("resolve", { keyHash: submission.key_hash, applicationId: requireId(application.id) });
      } catch (error) {
        failures++;
        await client.call("resolution-error", { keyHash: submission.key_hash, error: safeError(error) });
      }
    }
    let enqueued = 0;
    for (const stream of reconciliationStreams) {
      try {
        for (let page = 0; page < 100; page++) {
          const result = await reconcilePage(provider, client, stream);
          enqueued += result.enqueued;
          if (!result.more) break;
          // The page's cursor is already persisted; a bounded run resumes there next hour.
        }
      } catch { failures++; }
    }
    if (failures) throw new Error("reconciliation_incomplete");
    return { enqueued };
  },
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ArchiveStore, type ArchiveDb } from "../lib/archive/store";
import { acceptWebhook } from "../lib/archive/webhook";
import { GoogleDriveArchive } from "../lib/archive/drive";
import { AshbyArchiveClient } from "../lib/archive/ashby";
import { ArchiveInternalClient } from "../lib/archive/internal-client";
import { reconcilePage } from "../lib/archive/reconcile";
import { formFileAnswers } from "../lib/archive/form-files";
import { archiveApplication } from "../lib/archive/service";
import type { AshbyApplication } from "../lib/archive/contracts";
import { providerRequest, type Fetch } from "../lib/archive/http";
import { internalAuthorized, safeDownloadUrl, safeDriveSession, safeError, sha256 } from "../lib/archive/security";

const applicationId = "e9ed20fd-d45f-4aad-8a00-a19bfba0083e";
const eventId = "75395d87-4044-4dc4-bc29-0cec185e5f06";
const secret = "isolated-test-webhook-secret-with-32-characters";
const json = (data: unknown, status = 200) => Response.json(data, { status });

function database() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("../drizzle/0000_hiring_tracking.sql", import.meta.url), "utf8"));
  const db: ArchiveDb = { prepare: (query) => ({ bind: (...values: unknown[]) => {
    const statement = sql.prepare(query); const params = values as Array<string | number | null>;
    return { first: async <T>() => statement.get(...params) as T ?? null, all: async <T>() => ({ results: statement.all(...params) as T[] }), run: async () => statement.run(...params) };
  } }) };
  return { sql, db, store: new ArchiveStore(db) };
}

function signedBody(overrides = {}) {
  const raw = new TextEncoder().encode(JSON.stringify({ webhookActionId: eventId, action: "applicationSubmit", data: { application: { id: applicationId } }, ...overrides }));
  return { raw, signature: `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` };
}

test("webhook verifies exact raw bytes before recording and rejects forged signatures", async () => {
  const { store } = database(); const { raw, signature } = signedBody();
  assert.equal((await acceptWebhook(raw, signature, secret, store)).status, 200);
  assert.equal((await acceptWebhook(new TextEncoder().encode(new TextDecoder().decode(raw) + " "), signature, secret, store)).status, 401);
  assert.equal((await acceptWebhook(raw, "sha256=" + "0".repeat(64), secret, store)).status, 401);
  assert.equal((await store.pending()).length, 1);
});

test("stable event ID deduplicates replay and refuses conflicting signed payloads", async () => {
  const { db, store } = database(); const first = signedBody();
  await acceptWebhook(first.raw, first.signature, secret, store);
  const restarted = new ArchiveStore(db);
  assert.equal((await acceptWebhook(first.raw, first.signature, secret, restarted)).code, "duplicate");
  const conflict = signedBody({ data: { application: { id: "4071538b-3cac-4fbf-ac76-f78ed250ffdd" } } });
  assert.equal((await acceptWebhook(conflict.raw, conflict.signature, secret, restarted)).status, 409);
  assert.equal((await restarted.pending()).length, 1);
});

test("related Ashby webhook actions sharing an event ID are accepted independently", async () => {
  const { store } = database();
  for (const action of ["candidateHire", "candidateStageChange", "applicationUpdate"]) {
    const event = signedBody({ action });
    assert.equal((await acceptWebhook(event.raw, event.signature, secret, store)).status, 200);
    assert.equal((await acceptWebhook(event.raw, event.signature, secret, store)).code, "duplicate");
  }
  assert.equal((await store.pending()).length, 3);
});

test("outbox leases fence stale callbacks and persist retry-visible errors", async () => {
  const { sql, store } = database(); await store.enqueue(applicationId, "submission:test");
  const claimed = await store.claim("submission:test"); assert.ok(claimed?.lease_token);
  assert.equal(await store.claim("submission:test"), null);
  await store.complete("submission:test", "stale-token", "synced", "folder", null);
  assert.equal((await store.getEvent("submission:test"))?.status, "running");
  await store.complete("submission:test", claimed.lease_token, "error", null, "google_oauth_401");
  assert.equal((await store.status()).errors[0].last_error, "google_oauth_401");
  assert.equal(await store.claim("submission:test"), null);
  assert.ok((await store.getEvent("submission:test"))!.next_attempt_at! > Date.now());
  sql.prepare("UPDATE archive_events SET next_attempt_at = 0 WHERE id = 'submission:test'").run();
  const retry = await store.claim("submission:test"); assert.equal(retry?.attempts, 2);
  await store.complete("submission:test", retry!.lease_token!, "synced", "folder", null);
  assert.equal((await store.pending()).length, 0);
});

test("more than 100 permanent archive errors cannot starve a new application", async () => {
  const { sql, store } = database();
  for (let i = 0; i < 125; i++) {
    await store.enqueue(applicationId, `old-error:${i}`);
    sql.prepare("UPDATE archive_events SET status = 'error', attempts = 20, next_attempt_at = 0, last_error = 'permission_denied' WHERE id = ?").run(`old-error:${i}`);
  }
  await store.enqueue(applicationId, "new-application");
  const pending = await store.pending(100);
  assert.equal(pending.length, 100); assert.equal(pending[0].id, "new-application");
  const claimed = await store.claim("old-error:0");
  await store.complete(claimed!.id, claimed!.lease_token!, "error", null, "permission_denied");
  assert.ok((await store.getEvent("old-error:0"))!.next_attempt_at! >= Date.now() + 5 * 60 * 60 * 1000);
});

test("accepted form resolution links the existing provider application once", async () => {
  const { sql, store } = database(); const keyHash = "a".repeat(64);
  sql.prepare("INSERT INTO hiring_submissions (key_hash,session_hash,fingerprint,job_posting_id,job_title,status,submitted_form_instance_id,created_at,updated_at) VALUES (?, 'session', 'fingerprint', 'posting', 'Synthetic', 'accepted', 'submitted-form', 1, 1)").run(keyHash);
  assert.equal((await store.unresolved()).length, 1);
  await store.resolveSubmission(keyHash, applicationId); await store.resolveSubmission(keyHash, applicationId);
  assert.equal((await store.unresolved()).length, 0);
  assert.equal((await store.pending()).length, 1);
});

test("operator status includes unknown pending writes without promoting them to accepted", async () => {
  const { sql, store } = database();
  sql.prepare("INSERT INTO hiring_submissions (key_hash,session_hash,fingerprint,job_posting_id,job_title,status,created_at,updated_at,error_code) VALUES ('pending-key', 'session', 'fingerprint', 'posting', 'Synthetic', 'pending', 1, 1, 'unknown_outcome')").run();
  const attention = (await store.status()).submissionAttention;
  assert.equal(attention.length, 1); assert.equal(attention[0].status, "pending"); assert.equal(attention[0].count, 1);
  assert.equal((await store.unresolved()).length, 0);
  assert.equal((await store.pending()).length, 0);
});

function driveFixture(options: { failedChunk?: boolean; refresh401?: boolean; publicRoot?: boolean } = {}) {
  const { store } = database();
  let generated = 0; let refreshes = 0; let creates = 0; let failed = false; let denied = false;
  const files = new Map<string, Record<string, unknown>>([["root", { id: "root", name: "Recruiting", mimeType: "application/vnd.google-apps.folder" }]]);
  const sessions = new Map<string, { metadata: Record<string, unknown>; size: number; offset: number; data: number[] }>();
  const calls: Array<{ url: string; auth: string | null; method: string }> = [];
  const fetcher: Fetch = async (input, init = {}) => {
    const url = new URL(String(input)); const method = init.method ?? "GET";
    const headers = new Headers(init.headers); calls.push({ url: url.toString(), auth: headers.get("authorization"), method });
    assert.equal(init.redirect, "manual");
    if (url.hostname === "oauth2.googleapis.com") { refreshes++; return json({ access_token: `token-${refreshes}`, expires_in: 3600 }); }
    if (options.refresh401 && !denied) { denied = true; return json({}, 401); }
    if (url.pathname.endsWith("/permissions")) return json({ permissions: [{ type: options.publicRoot ? "anyone" : "user" }] });
    if (url.pathname.endsWith("/generateIds")) return json({ ids: [`generated-${++generated}`] });
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      const q = url.searchParams.get("q")!; const key = /value='([a-f0-9]+)'/.exec(q)![1];
      return json({ files: [...files.values()].filter((file) => (file.appProperties as Record<string, string> | undefined)?.aclArchiveKey === key) });
    }
    if (url.pathname === "/drive/v3/files" && method === "POST") {
      const data = JSON.parse(String(init.body));
      if (files.has(data.id)) return json({}, 409);
      files.set(data.id, data); creates++; return json(data);
    }
    if (url.pathname.startsWith("/drive/v3/files/")) {
      const id = url.pathname.split("/").at(-1)!;
      return files.has(id) ? json(files.get(id)) : json({}, 404);
    }
    if (url.pathname.startsWith("/upload/drive/v3/files") && (method === "POST" || method === "PATCH")) {
      const metadata = JSON.parse(String(init.body));
      if (method === "PATCH") Object.assign(metadata, { id: url.pathname.split("/").at(-1)!, parents: files.get(url.pathname.split("/").at(-1)!)!.parents });
      const sessionId = `session-${sessions.size + 1}`;
      sessions.set(sessionId, { metadata, size: Number(headers.get("x-upload-content-length")), offset: 0, data: [] });
      return new Response(null, { status: 200, headers: { Location: `https://www.googleapis.com/upload/drive/v3/files?upload_id=${sessionId}` } });
    }
    if (url.pathname.startsWith("/upload/drive/v3/files") && method === "PUT") {
      const session = sessions.get(url.searchParams.get("upload_id")!)!;
      const range = headers.get("content-range")!;
      if (range.startsWith("bytes */") && session.offset < session.size) return new Response(null, { status: 308, headers: session.offset ? { Range: `bytes=0-${session.offset - 1}` } : {} });
      if (options.failedChunk && !failed && session.offset > 0) { failed = true; return json({}, 400); }
      if (!range.startsWith("bytes */")) {
        const start = Number(/^bytes (\d+)-/.exec(range)![1]);
        assert.equal(start, session.offset);
        const chunk = init.body as Uint8Array;
        for (const byte of chunk) session.data.push(byte);
        session.offset += chunk.length;
      }
      if (session.offset < session.size) return new Response(null, { status: 308, headers: { Range: `bytes=0-${session.offset - 1}` } });
      const file: Record<string, unknown> = { ...session.metadata, sha256Checksum: await sha256(new Uint8Array(session.data)) };
      files.set(file.id as string, file);
      return json({ id: file.id });
    }
    throw new Error(`unexpected_test_request:${url.pathname}`);
  };
  const client = new GoogleDriveArchive({ clientId: "client", clientSecret: "secret", refreshToken: "refresh" }, store, fetcher);
  return { client, store, files, sessions, calls, metrics: () => ({ creates, generated, refreshes }) };
}

test("same candidate names have distinct stable application folders and retry reuses IDs", async () => {
  const fixture = driveFixture(); await fixture.client.assertPrivateRoot("root");
  const first = await fixture.client.folder("application:job:one", "Same Name", "root");
  const second = await fixture.client.folder("application:job:two", "Same Name", "root");
  assert.notEqual(first, second);
  assert.equal(await fixture.client.folder("application:job:one", "Same Name", "root"), first);
  assert.equal(fixture.metrics().creates, 2);
  assert.equal(fixture.metrics().generated, 2);
});

test("Google access token refresh on 401 does not leak secrets or create public permissions", async () => {
  const fixture = driveFixture({ refresh401: true }); await fixture.client.assertPrivateRoot("root");
  await fixture.client.folder("job:one", "Job", "root");
  assert.equal(fixture.metrics().refreshes, 2);
  assert.ok(fixture.calls.filter((call) => call.auth).every((call) => new URL(call.url).origin === "https://www.googleapis.com"));
  assert.ok(fixture.calls.every((call) => !(call.method === "POST" && call.url.includes("permissions"))));
});

test("public Recruiting root is rejected before any archival creation", async () => {
  const fixture = driveFixture({ publicRoot: true });
  await assert.rejects(() => fixture.client.assertPrivateRoot("root"), /drive_root_is_public/);
  assert.equal(fixture.metrics().creates, 0);
});

test("interrupted resumable upload persists session and resumes at provider-confirmed offset", async () => {
  const fixture = driveFixture({ failedChunk: true }); const bytes = new Uint8Array(1024 * 1024 + 17).fill(7);
  await assert.rejects(() => fixture.client.file("resume:one", "resume.pdf", "application/pdf", "root", bytes), /google_drive_400/);
  assert.equal(fixture.sessions.size, 1);
  const item = await fixture.store.get(await sha256("resume:one")); assert.ok(item?.session_url);
  const id = await fixture.client.file("resume:one", "resume.pdf", "application/pdf", "root", bytes);
  assert.equal(fixture.sessions.size, 1);
  assert.equal(fixture.files.get(id)?.sha256Checksum, await sha256(bytes));
  assert.equal((await fixture.store.get(await sha256("resume:one")))?.session_url, null);
  await fixture.client.file("resume:one", "resume.pdf", "application/pdf", "root", bytes);
  assert.equal(fixture.sessions.size, 1);
});

test("resumable sessions and file download hosts reject SSRF and credential-bearing URLs", () => {
  for (const url of ["http://s3.amazonaws.com/file", "https://127.0.0.1/file", "https://user:password@s3.amazonaws.com/file", "https://s3.amazonaws.com:444/file", "https://example.com/file"]) assert.throws(() => safeDownloadUrl(url, ["s3.amazonaws.com"]));
  assert.throws(() => safeDriveSession("https://example.com/upload/drive/v3/files"));
  assert.throws(() => safeDriveSession("https://www.googleapis.com/other"));
});

test("Ashby download only follows approved hosts and sends no API key to storage", async () => {
  const calls: Array<{ host: string; auth: string | null }> = [];
  const client = new AshbyArchiveClient("private-api-key", async (input, init = {}) => {
    const host = new URL(String(input)).hostname;
    calls.push({ host, auth: new Headers(init.headers).get("authorization") });
    if (host === "api.ashbyhq.com") return json({ success: true, results: { url: "https://s3.amazonaws.com/signed" } });
    return new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/secret" } });
  });
  await assert.rejects(() => client.download("trusted-handle", ["s3.amazonaws.com"]), /download_host_not_allowed/);
  assert.equal(calls.length, 2); assert.equal(calls[1].auth, null);
});

test("private callback authentication is required and redirects never receive the secret", async () => {
  assert.equal(await internalAuthorized(new Request("https://jobs.example.com"), secret), false);
  assert.equal(await internalAuthorized(new Request("https://jobs.example.com", { headers: { Authorization: `Bearer ${secret}` } }), secret), true);
  let calls = 0;
  const internal = new ArchiveInternalClient("https://jobs.example.com", secret, async (_input, init) => {
    calls++; assert.equal(init?.redirect, "manual"); return new Response(null, { status: 302, headers: { Location: "https://attacker.example" } });
  });
  await assert.rejects(() => internal.pending(), /redirect_rejected/);
  assert.equal(calls, 1);
});

test("rate limiting retries honor Retry-After and sanitize errors", async () => {
  let requests = 0; const waits: number[] = [];
  const response = await providerRequest("https://api.example.com", {}, "test", async () => ++requests === 1 ? new Response(null, { status: 429, headers: { "Retry-After": "2" } }) : json({ ok: true }), async (ms) => { waits.push(ms); });
  assert.equal(response.status, 200); assert.deepEqual(waits, [2000]);
  assert.equal(safeError(new Error("https://secret.example/token?private=token")), "archive_failed");
});

test("hourly reconciliation checkpoints only after all events are durably enqueued", async () => {
  const { store } = database(); const app = { id: applicationId, updatedAt: "2026-10-08T00:00:00Z" };
  let page = 0; const bodies: unknown[] = [];
  const ashby = new AshbyArchiveClient("isolated", async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return json(page++ === 0 ? { success: true, results: [app], moreDataAvailable: true, nextCursor: "page-2" } : { success: true, results: [], moreDataAvailable: false, syncToken: "sync-new" });
  });
  const internal: Pick<ArchiveInternalClient, "checkpoint" | "advance" | "enqueue"> = { checkpoint: (stream: string) => store.checkpoint(stream), advance: (checkpoint, cursor, sync) => store.advance(checkpoint.stream, checkpoint.revision, cursor, sync), enqueue: async (events) => { for (const event of events) await store.enqueue(event.applicationId, event.eventId, event.action); } };
  assert.equal((await reconcilePage(ashby, internal, "applications")).more, true);
  assert.equal((await store.checkpoint("applications")).cursor, "page-2");
  assert.equal((await store.pending()).length, 1);
  assert.equal((await reconcilePage(ashby, internal, "applications")).more, false);
  assert.equal((await store.checkpoint("applications")).sync_token, "sync-new");
  assert.equal((bodies[1] as { cursor: string }).cursor, "page-2");
});

test("expired Ashby sync token resets both token and cursor", async () => {
  const { store } = database(); const before = await store.checkpoint("applications"); await store.advance("applications", before.revision, "cursor-old", "token-old");
  const ashby = new AshbyArchiveClient("isolated", async () => json({ success: false, errors: ["sync_token_expired"] }));
  const internal: Pick<ArchiveInternalClient, "checkpoint" | "advance" | "enqueue"> = { checkpoint: (stream: string) => store.checkpoint(stream), advance: (checkpoint, cursor, sync, error) => store.advance(checkpoint.stream, checkpoint.revision, cursor, sync, error), enqueue: async () => assert.fail("invalid page must not enqueue") };
  assert.equal((await reconcilePage(ashby, internal, "applications")).more, true);
  const after = await store.checkpoint("applications"); assert.equal(after.cursor, null); assert.equal(after.sync_token, null); assert.equal(after.last_error, "ashby_sync_token_expired");
});

test("provider candidate mismatch aborts instead of associating the wrong record", async () => {
  const client = new AshbyArchiveClient("isolated", async () => json({ success: true, results: { id: eventId, name: "Other candidate" } }));
  await assert.rejects(() => client.candidate(applicationId), /candidate_identity_mismatch/);
});

test("non-resume form File answers are exported even when absent from candidate attachments", async () => {
  const file = { id: eventId, name: "cover-letter.pdf", handle: "public-file-handle" };
  const application = { applicationFormSubmissions: [{ id: applicationId, formDefinition: { sections: [{ fields: [{ field: { type: "File", path: "cover_letter", title: "Cover letter" } }] }] }, submittedValues: { cover_letter: file } }] } as AshbyApplication;
  assert.deepEqual(await formFileAnswers(application, []), [file]);
  application.applicationFormSubmissions![0].submittedValues = { cover_letter: "public-file-handle" };
  assert.deepEqual(await formFileAnswers(application, [file]), [file]);
  const fallback = await formFileAnswers(application, []);
  assert.equal(fallback.length, 1); assert.equal(fallback[0].handle, "public-file-handle");
  application.applicationFormSubmissions![0].submittedValues = { cover_letter: { undocumentedShape: true } };
  await assert.rejects(() => formFileAnswers(application, []), /application_file_answer_unresolved/);
});

test("authoritative application-to-Drive archival preserves form files, assessments and separate application identity", async () => {
  const candidateId = "84bfbed7-ed0a-496d-bb18-11b73369f666";
  const jobId = "4071538b-3cac-4fbf-ac76-f78ed250ffdd";
  const resume = { id: "1c23a4e4-d40a-4574-a3b9-8ec4318421ec", name: "resume.pdf", handle: "resume-handle" };
  const letter = { id: "fe05b423-e580-4c4b-8a67-32d354bdfe91", name: "cover-letter.pdf", handle: "letter-handle" };
  const assessmentFile = { id: "afc7d3c7-5616-423a-b0db-261888f6f10b", name: "exercise.txt", handle: "exercise-handle" };
  const application = {
    id: applicationId, candidate: { id: candidateId, name: "Same Name" }, job: { id: jobId, title: "Engineer" },
    createdAt: "2026-10-08T00:00:00Z", updatedAt: "2026-10-08T00:00:00Z", status: "Active", resumeFileHandle: resume,
    applicationFormSubmissions: [{ id: eventId, formDefinition: { sections: [{ fields: [{ field: { type: "File", path: "cover", title: "Cover letter" } }] }] }, submittedValues: { cover: letter } }],
  };
  const fetched: string[] = [];
  const provider = new AshbyArchiveClient("isolated", async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "s3.amazonaws.com") { assert.equal(new Headers(init.headers).get("authorization"), null); return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "application/octet-stream" } }); }
    const endpoint = url.pathname.slice(1); fetched.push(endpoint);
    if (endpoint === "application.info") return json({ success: true, results: application });
    if (endpoint === "candidate.info") return json({ success: true, results: { id: candidateId, name: "Same Name", fileHandles: [] } });
    if (endpoint === "file.info") return json({ success: true, results: { url: "https://s3.amazonaws.com/trusted-file" } });
    if (endpoint === "application.listHistory") return json({ success: true, results: [{ type: "StageTransition" }], moreDataAvailable: false });
    if (endpoint === "applicationFeedback.list") return json({ success: true, results: [], moreDataAvailable: false });
    if (endpoint === "takeHomeAssignment.list") return json({ success: true, results: [{ id: eventId, applicationId, candidateId, submission: { fileHandles: [assessmentFile] } }], moreDataAvailable: false });
    throw new Error("unexpected_ashby_endpoint");
  });
  const fixture = driveFixture();
  const first = await archiveApplication({ applicationId, rootFolderId: "root", allowedDownloadHosts: ["s3.amazonaws.com"], ashby: provider, drive: fixture.client });
  assert.equal(first.filesArchived, 5);
  assert.ok([...fixture.files.values()].some((file) => file.name === "cover-letter.pdf"));
  const applicationFolder = fixture.files.get(first.folderId)!;
  assert.equal(applicationFolder.name, `Same Name–${applicationId}`);
  assert.ok(fetched.includes("application.listHistory")); assert.ok(fetched.includes("takeHomeAssignment.list"));
  const sessionsBefore = fixture.sessions.size;
  const retry = await archiveApplication({ applicationId, rootFolderId: "root", allowedDownloadHosts: ["s3.amazonaws.com"], ashby: provider, drive: fixture.client });
  assert.equal(retry.folderId, first.folderId); assert.equal(fixture.sessions.size, sessionsBefore);
});

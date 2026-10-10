import test from "node:test";
import assert from "node:assert/strict";
import { GoogleWorkspace, type ArchiveItem, type ItemState } from "../../lib/google/workspace";
import { hash } from "../../lib/google/http";

function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
const baseConfig = { clientId: "client", clientSecret: "secret", refreshToken: "refresh", sender: "recruiting@example.com", driveRootId: "root" };
const detail = { id: "app-one", revision: 1, name: "Same Candidate", jobId: "job-one", jobTitle: "Engineer", answers: [{ path: "portfolio", value: "https://portfolio.example" }], assessment: { prompt: "Task", answer: "Completed" }, history: [{ type: "stage", text: "Screening" }], files: [{ id: "resume-id", filename: "resume.pdf", contentType: "application/pdf", size: 3, url: "/private/secret" }] };
const original = { id: "resume-id", name: "resume.pdf", mimeType: "application/pdf", bytes: new Uint8Array([1, 2, 3]) };

function fixture(options: { publicRoot?: boolean; interrupt?: boolean; createConflict?: boolean } = {}) {
  const rows = new Map<string, ArchiveItem>();
  const state: ItemState = {
    async get(key) { return rows.get(key) ?? null; },
    async reserve(key, driveId, parentId) {
      const canonical = rows.get(key);
      if (canonical) return canonical;
      const item = { key, drive_id: driveId, parent_id: parentId, content_hash: null, session_url: null, updated_at: Date.now() }; rows.set(key, item); return item;
    },
    async update(key, contentHash, sessionUrl) { Object.assign(rows.get(key)!, { content_hash: contentHash, session_url: sessionUrl }); },
  };
  let generated = 0, creates = 0, interrupted = false;
  const files = new Map<string, Record<string, unknown>>([["root", { id: "root", name: "Private recruiting", mimeType: "application/vnd.google-apps.folder" }]]);
  const bytes = new Map<string, Uint8Array>();
  const sessions = new Map<string, { metadata: Record<string, unknown>; total: number; offset: number; chunks: Uint8Array[] }>();
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method ?? "GET", headers = new Headers(init.headers);
    assert.equal(init.redirect, "manual");
    if (url.hostname === "oauth2.googleapis.com") return response({ access_token: "access", token_type: "Bearer", expires_in: 3600 });
    assert.equal(headers.get("Authorization"), "Bearer access");
    if (url.pathname.endsWith("/permissions")) return response({ permissions: [{ type: options.publicRoot ? "anyone" : "user" }] });
    if (url.pathname.endsWith("/generateIds")) return response({ ids: [`generated-${++generated}`] });
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      const q = url.searchParams.get("q")!, key = /value='([a-f0-9]+)'/.exec(q)![1], parent = /^'([^']+)'/.exec(q)![1];
      return response({ files: [...files.values()].filter((file) => (file.appProperties as Record<string, string>)?.aclArchiveKey === key && (file.parents as string[]).includes(parent)) });
    }
    if (url.pathname === "/drive/v3/files" && method === "POST") {
      const data = JSON.parse(String(init.body));
      const row = rows.get(data.appProperties.aclArchiveKey);
      assert.equal(row?.drive_id, data.id, "pre-generated file ID must be durably reserved before create");
      if (files.has(data.id)) return response({}, 409);
      creates++; files.set(data.id, data);
      return options.createConflict ? response({}, 409) : response(data);
    }
    if (url.pathname.startsWith("/drive/v3/files/")) return files.has(url.pathname.split("/").at(-1)!) ? response(files.get(url.pathname.split("/").at(-1)!)) : response({}, 404);
    if (url.pathname.startsWith("/upload/drive/v3/files") && ["POST", "PATCH"].includes(method)) {
      const metadata = JSON.parse(String(init.body));
      if (method === "PATCH") Object.assign(metadata, { id: url.pathname.split("/").at(-1)!, parents: files.get(url.pathname.split("/").at(-1)!)!.parents });
      assert.equal(rows.get(metadata.appProperties.aclArchiveKey)?.drive_id, metadata.id);
      const id = `session-${sessions.size + 1}`;
      sessions.set(id, { metadata, total: Number(headers.get("X-Upload-Content-Length")), offset: 0, chunks: [] });
      return new Response(null, { status: 200, headers: { Location: `https://www.googleapis.com/upload/drive/v3/files?upload_id=${id}` } });
    }
    if (url.pathname.startsWith("/upload/drive/v3/files") && method === "PUT") {
      const session = sessions.get(url.searchParams.get("upload_id")!)!, range = headers.get("Content-Range")!;
      if (range.startsWith("bytes */") && session.offset < session.total) return new Response(null, { status: 308, headers: session.offset ? { Range: `bytes=0-${session.offset - 1}` } : {} });
      if (options.interrupt && !interrupted && session.offset > 0) { interrupted = true; return response({}, 400); }
      if (!range.startsWith("bytes */")) {
        assert.equal(Number(/^bytes (\d+)-/.exec(range)![1]), session.offset);
        const chunk = new Uint8Array(init.body as Uint8Array); session.chunks.push(chunk); session.offset += chunk.length;
      }
      if (session.offset < session.total) return new Response(null, { status: 308, headers: { Range: `bytes=0-${session.offset - 1}` } });
      const content = new Uint8Array(session.total); let offset = 0;
      for (const chunk of session.chunks) { content.set(chunk, offset); offset += chunk.length; }
      const file: Record<string, unknown> = { ...session.metadata, sha256Checksum: await hash(content) }; files.set(file.id as string, file); bytes.set(file.id as string, content);
      return response({ id: file.id });
    }
    throw new Error("unexpected_test_request");
  };
  return { workspace: new GoogleWorkspace({ ...baseConfig, archiveState: state }, fetcher), state, fetcher, files, bytes, rows, sessions, counts: () => ({ creates, generated }) };
}

test("Drive archives answers, original bytes, assessments and history in stable application folders", async () => {
  const f = fixture({ createConflict: true });
  const first = await f.workspace.archiveApplication(detail, [original]);
  assert.equal(f.files.get(first.folderId)?.name, "Same Candidate–app-one");
  assert.equal(first.archivedRevision, detail.revision);
  const snapshotFile = [...f.files.values()].find((file) => file.name === "application-r1.json")!;
  const snapshot = JSON.parse(new TextDecoder().decode(f.bytes.get(snapshotFile.id as string)!));
  assert.deepEqual(snapshot.application.answers, detail.answers); assert.deepEqual(snapshot.application.assessment, detail.assessment); assert.deepEqual(snapshot.application.history, detail.history);
  assert.equal(snapshot.application.files[0].url, undefined);
  const archivedResume = [...f.files.values()].find((file) => file.name === "resume.pdf")!;
  assert.deepEqual(f.bytes.get(archivedResume.id as string), original.bytes);
  const sessions = f.sessions.size;
  const recreated = new GoogleWorkspace({ ...baseConfig, archiveState: f.state }, f.fetcher);
  const retry = await recreated.archiveApplication(detail, [original], first.folderId);
  assert.equal(retry.folderId, first.folderId); assert.equal(f.sessions.size, sessions);
  const second = await recreated.archiveApplication({ ...detail, id: "app-two" }, [original]);
  assert.notEqual(second.folderId, first.folderId);
});

test("Drive resumable upload recovers after worker restart with provider-confirmed offset", async () => {
  const f = fixture({ interrupt: true }), large = new Uint8Array(1024 * 1024 + 17).fill(7);
  const largeDetail = { ...detail, files: [{ ...detail.files[0], size: large.length }] };
  await assert.rejects(() => f.workspace.archiveApplication(largeDetail, [{ ...original, bytes: large }]), /google_drive_400/);
  assert.ok([...f.rows.values()].some((row) => row.session_url));
  const recreated = new GoogleWorkspace({ ...baseConfig, archiveState: f.state }, f.fetcher);
  await recreated.archiveApplication(largeDetail, [{ ...original, bytes: large }]);
  const resume = [...f.files.values()].find((file) => file.name === "resume.pdf")!;
  assert.deepEqual(f.bytes.get(resume.id as string), large); assert.equal(f.sessions.size, 2);
});

test("Drive rejects public roots and mismatched files without creating private hiring exports", async () => {
  const f = fixture({ publicRoot: true });
  await assert.rejects(() => f.workspace.archiveApplication(detail, [original]), /drive_root_is_public/);
  assert.equal(f.counts().creates, 0);
  const missing = new GoogleWorkspace({ ...baseConfig, archiveState: f.state }, async () => assert.fail("validation must precede Google"));
  await assert.rejects(() => missing.archiveApplication(detail, []), /original_file_set_mismatch/);
  await assert.rejects(() => missing.archiveApplication(detail, [{ ...original, bytes: new Uint8Array([1]) }]), /original_file_metadata_mismatch/);
  await assert.rejects(() => missing.archiveApplication(detail, [{ ...original, id: "wrong-application-file" }]), /identity_missing_or_ambiguous/);
  const noState = new GoogleWorkspace(baseConfig, async () => assert.fail("must not call Google"));
  await assert.rejects(() => noState.archiveApplication(detail, [original]), /drive_durable_state_required/);
});

test("existing Drive metadata with the wrong parent is never overwritten", async () => {
  const f = fixture(); const first = await f.workspace.archiveApplication(detail, [original]);
  f.files.get(first.folderId)!.parents = ["different-parent"];
  await assert.rejects(() => f.workspace.archiveApplication(detail, [original]), /drive_identity_mismatch/);
});

test("a late old worker cannot overwrite the newer application revision", async () => {
  const f = fixture();
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const delayed: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const session = f.sessions.get(url.searchParams.get("upload_id") ?? "");
    if (init.method === "PUT" && session?.metadata.name === "application-r1.json") {
      entered();
      await held;
    }
    return f.fetcher(input, init);
  };
  const oldWorker = new GoogleWorkspace({ ...baseConfig, archiveState: f.state }, delayed);
  const old = oldWorker.archiveApplication(detail, [original]);
  await ready;
  const current = { ...detail, revision: 2, history: [...detail.history, { type: "note", text: "Latest authoritative note" }] };
  try {
    const newer = await f.workspace.archiveApplication(current, [original]);
    assert.equal(newer.archivedRevision, 2);
    release();
    const older = await old;
    assert.equal(older.archivedRevision, 1);
    assert.equal(older.folderId, newer.folderId);
    const snapshots = [...f.files.values()].filter((file) => /^application-r\d+\.json$/.test(String(file.name)));
    assert.equal(snapshots.length, 2);
    const latest = snapshots.find((file) => file.name === "application-r2.json")!;
    const saved = JSON.parse(new TextDecoder().decode(f.bytes.get(latest.id as string)!));
    assert.equal(saved.application.revision, 2);
    assert.deepEqual(saved.application.history, current.history);
    assert.equal([...f.files.values()].some((file) => file.name === "application.json"), false);
    const sessions = f.sessions.size;
    await f.workspace.archiveApplication(current, [original], newer.folderId);
    assert.equal(f.sessions.size, sessions, "a repeated revision creates no second file or upload");
  } finally {
    release();
    await old;
  }
});

test("invalid snapshot revisions are rejected before Google requests and Drive metadata cannot change snapshot bytes", async () => {
  const offline = new GoogleWorkspace({ ...baseConfig, archiveState: fixture().state }, async () => assert.fail("invalid revision must fail before Google"));
  for (const revision of [undefined, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(() => offline.archiveApplication({ ...detail, revision: revision as number }, [original]), /drive_application_revision_missing_or_invalid/);
  }
  const f = fixture();
  const first = await f.workspace.archiveApplication({ ...detail, updatedAt: 10, driveFolderUrl: "https://drive.google.com/old" }, [original]);
  const sessions = f.sessions.size;
  await f.workspace.archiveApplication({ ...detail, updatedAt: 20, driveFolderUrl: first.folderUrl }, [original], first.folderId);
  assert.equal(f.sessions.size, sessions);
  const snapshot = [...f.files.values()].find((file) => file.name === "application-r1.json")!;
  const saved = JSON.parse(new TextDecoder().decode(f.bytes.get(snapshot.id as string)!));
  assert.equal(saved.application.updatedAt, undefined);
  assert.equal(saved.application.driveFolderUrl, undefined);
});

test("101 originals load sequentially after the preceding file is durably archived", async () => {
  const f = fixture();
  const descriptors = Array.from({ length: 101 }, (_, index) => ({ id: `file-${index}`, filename: `file-${index}.pdf`, contentType: "application/pdf", size: 3 }));
  const loads: number[] = [], checkpoints: number[] = [];
  const sources = descriptors.map((file, index) => ({ id: file.id, name: file.filename, mimeType: file.contentType, size: file.size, async load() {
    if (index > 0) {
      const previous = [...f.files.values()].find(item => item.name === descriptors[index - 1].filename);
      assert.ok(previous && f.bytes.has(String(previous.id)), "previous original must finish before the next R2 read");
      assert.equal(checkpoints.at(-1), index);
    }
    loads.push(index);
    return new Uint8Array([1, 2, 3]);
  } }));
  await f.workspace.archiveApplication({ ...detail, files: descriptors }, sources, undefined, { async read() { return 0; }, async write(nextIndex) { checkpoints.push(nextIndex); } });
  assert.deepEqual(loads, Array.from({ length: 101 }, (_, index) => index));
  assert.equal(checkpoints.at(-1), 101);
  assert.equal([...f.files.values()].filter(file => /^file-\d+\.pdf$/.test(String(file.name))).length, 101);
});

test("a saved original checkpoint resumes without rereading earlier files", async () => {
  const f = fixture(); let nextIndex = 0, interrupted = false;
  const loads = [0, 0];
  const descriptors = [detail.files[0], { ...detail.files[0], id: "second-id", filename: "portfolio.pdf" }];
  const sources = descriptors.map((file, index) => ({ id: file.id, name: file.filename, mimeType: file.contentType, size: file.size, async load() {
    loads[index]++;
    if (index === 1 && !interrupted) { interrupted = true; throw new Error("synthetic storage interruption"); }
    return original.bytes;
  } }));
  const continuation = { async read() { return nextIndex; }, async write(index: number) { nextIndex = index; } };
  await assert.rejects(() => f.workspace.archiveApplication({ ...detail, files: descriptors }, sources, undefined, continuation), /synthetic storage interruption/);
  assert.equal(nextIndex, 1);
  const recreated = new GoogleWorkspace({ ...baseConfig, archiveState: f.state }, f.fetcher);
  await recreated.archiveApplication({ ...detail, files: descriptors }, sources, undefined, continuation);
  assert.deepEqual(loads, [1, 2]);
  assert.equal(nextIndex, 2);
  assert.equal([...f.files.values()].filter(file => file.name === "resume.pdf").length, 1);
  assert.equal([...f.files.values()].filter(file => file.name === "portfolio.pdf").length, 1);
});

test("archives all assessments and interviews while removing every private capability URL", async () => {
  const f = fixture();
  const history = {
    ...detail,
    assessments: [{ id: "first", answer: "First answer", assessmentUrl: "/assessment/secret-one" }, { id: "second", answer: "Second answer", assessmentUrl: "/assessment/secret-two" }],
    interviews: [{ id: "first", attended: false, bookingUrl: "/interview/secret-one" }, { id: "second", attended: true, bookingUrl: "/interview/secret-two" }],
  };
  await f.workspace.archiveApplication(history, [original]);
  const snapshot = [...f.files.values()].find(file => file.name === "application-r1.json")!;
  const text = new TextDecoder().decode(f.bytes.get(String(snapshot.id))!);
  assert.equal(text.includes("secret-one"), false); assert.equal(text.includes("secret-two"), false);
  assert.deepEqual(JSON.parse(text).application.assessments, [{ id: "first", answer: "First answer" }, { id: "second", answer: "Second answer" }]);
  assert.deepEqual(JSON.parse(text).application.interviews, [{ id: "first", attended: false }, { id: "second", attended: true }]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { GoogleWorkspace, type ArchiveItem, type ItemState } from "../../lib/google/workspace";
import { hash } from "../../lib/google/http";
import { readablePdf } from "../pdf/readable";
import { GoogleDriveArchive } from "../../lib/archive/drive";

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
      const q = url.searchParams.get("q")!;
      if(q.includes("mimeType =")) { const parent = /^'([^']+)'/.exec(q)![1]; return response({files:[...files.values()].filter(file=>file.mimeType===(q.includes("application/pdf")?"application/pdf":"application/json")&&!file.trashed&&(file.parents as string[])?.includes(parent))}); }
      const key = /value='([a-f0-9]+)'/.exec(q)![1], parent = /^'([^']+)'/.exec(q)![1];
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
    if (url.pathname.startsWith("/drive/v3/files/")) {
      const id=url.pathname.split("/").at(-1)!;
      if(method==="PATCH") { if(!files.has(id))return response({},404);Object.assign(files.get(id)!,JSON.parse(String(init.body)));const target=files.get(id)!;if(url.searchParams.has("addParents"))target.parents=[url.searchParams.get("addParents")!];return response({id,trashed:target.trashed,parents:target.parents}); }
      if(url.searchParams.get("alt")==="media")return bytes.has(id)?new Response(bytes.get(id)! as BodyInit):response({},404);
      return files.has(id)?response(files.get(id)):response({},404);
    }
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
  const snapshotFile = [...f.files.values()].find((file) => (file.name === "Application.pdf" || file.name === "Application-r1.pdf"))!;
  const snapshot = await readablePdf(f.bytes.get(snapshotFile.id as string)!);
  assert.ok(snapshot.text.includes("https://portfolio.example")); assert.ok(snapshot.text.includes("Completed")); assert.ok(snapshot.text.includes("Screening"));
  assert.ok(!snapshot.text.includes("/private/secret"));
  assert.equal(first.archiveFormat,"pdf-current-v3"); assert.deepEqual(first.legacyJsonFileIds,[]);
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
    if (init.method === "PUT" && session?.metadata.name === "Application-r1.pdf") {
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
    const snapshots = [...f.files.values()].filter((file) => /^Application(?:-r\d+)?\.pdf$/.test(String(file.name)));
    assert.equal(snapshots.length, 2);
    const latest = snapshots.find((file) => file.name === "Application.pdf")!;
    const saved = await readablePdf(f.bytes.get(latest.id as string)!);
    assert.match(saved.text,/Record revision\s+2/);
    assert.ok(saved.text.includes("Latest authoritative note"));
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
  const snapshot = [...f.files.values()].find((file) => (file.name === "Application.pdf" || file.name === "Application-r1.pdf"))!;
  const saved = await readablePdf(f.bytes.get(snapshot.id as string)!);
  assert.ok(!saved.text.includes("https://drive.google.com/old"));
  assert.ok(!saved.text.includes(first.folderUrl));
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
  await assert.rejects(() => f.workspace.archiveApplication({ ...detail, files: descriptors }, sources, undefined, continuation), {code:"drive_archive_failed",phase:"originals"});
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
  const snapshot = [...f.files.values()].find(file => (file.name === "Application.pdf" || file.name === "Application-r1.pdf"))!;
  const text = (await readablePdf(f.bytes.get(String(snapshot.id))!)).text;
  assert.equal(text.includes("secret-one"), false); assert.equal(text.includes("secret-two"), false);
  assert.ok(text.includes("First answer"));assert.ok(text.includes("Second answer"));
  assert.match(text,/Attended\s+No/);assert.match(text,/Attended\s+Yes/);
});

test("Drive groups projects and countries while retaining independent hiring rounds and retries", async () => {
  const f=fixture();
  const snapshot={...detail,archiveProject:"Creative Strategist",archiveCountry:"Spain",hiringRound:"October"};
  const first=await f.workspace.archiveApplication(snapshot,[original]);
  const parent=(id:string)=>f.files.get((f.files.get(id)?.parents as string[])[0])!;
  assert.equal(parent(first.folderId).name,"October–job-one");
  const round=parent(first.folderId),country=parent(round.id as string),project=parent(country.id as string);
  assert.equal(country.name,"Spain");assert.equal(project.name,"Creative Strategist");
  const again=await f.workspace.archiveApplication(snapshot,[original],first.folderId);
  assert.equal(again.folderId,first.folderId);
  const second=await f.workspace.archiveApplication({...snapshot,id:"app-two",jobId:"job-two"},[original]);
  assert.notEqual(parent(second.folderId).id,round.id);
  assert.equal(parent(parent(second.folderId).id as string).id,country.id);
  const usa=await f.workspace.archiveApplication({...snapshot,id:"app-three",jobId:"job-three",archiveCountry:"USA"},[original]);
  assert.equal(parent(parent(usa.folderId).id as string).name,"USA");
  assert.ok(f.files.has(first.folderId));
});

test("legacy JSON revisions become readable PDFs before recoverable cleanup; unrelated JSONs and originals remain",async()=>{
 const f=fixture(),first=await f.workspace.archiveApplication(detail,[original]);
 const archive=new GoogleDriveArchive(baseConfig,f.state,f.fetcher);
 const legacyBytes=new TextEncoder().encode(JSON.stringify({schemaVersion:1,application:{...detail,revision:2,history:[{type:'note',text:'Historical revision two note'}]}}));
 const legacyId=await archive.file(`hub:application:${detail.id}:snapshot:revision:2`,'application-r2.json','application/json',first.folderId,legacyBytes);
 const unrelated=await archive.file('unrelated-json','application-r3.json','application/json',first.folderId,new TextEncoder().encode('{"internal":"unrelated"}'));
 const migrated=await f.workspace.archiveApplication({...detail,revision:3},[original],first.folderId);
 assert.equal(migrated.archiveFormat,'pdf-current-v3');assert.deepEqual(migrated.legacyJsonFileIds,[legacyId]);
 assert.equal(f.files.get(legacyId)?.trashed,true);assert.equal(f.files.get(unrelated)?.trashed,undefined);assert.deepEqual(f.bytes.get(legacyId),legacyBytes,'JSON is still recoverable in Drive Trash');
 assert.ok([...f.rows.values()].some(row=>row.drive_id===legacyId&&row.content_hash),'original internal identity and checksum remain retained');
 const replacement=[...f.files.values()].find(file=>file.name==='Application-r2.pdf')!;
 assert.equal(replacement.mimeType,'application/pdf');const parsed=await readablePdf(f.bytes.get(String(replacement.id))!);assert.ok(parsed.text.includes('Historical revision two note'));
 const sessions=f.sessions.size;
 const retried=await f.workspace.archiveApplication({...detail,revision:3},[original],first.folderId);
 assert.equal(f.sessions.size,sessions);assert.deepEqual(retried.legacyJsonFileIds,[]);
 assert.equal([...f.files.values()].filter(file=>file.name==='resume.pdf').length,1);
});
test("legacy conversion validates candidate/job identity and retains JSON on failed replacement or cleanup",async()=>{
 const f=fixture(),first=await f.workspace.archiveApplication(detail,[original]);
 const archive=new GoogleDriveArchive(baseConfig,f.state,f.fetcher);
 const invalid=await archive.file(`hub:application:${detail.id}:snapshot:revision:2`,'application-r2.json','application/json',first.folderId,new TextEncoder().encode(JSON.stringify({schemaVersion:1,application:{...detail,revision:2,jobId:'wrong-job'}})));
 await assert.rejects(f.workspace.archiveApplication({...detail,revision:3},[original],first.folderId),/drive_legacy_snapshot_identity_mismatch/);
 assert.equal(f.files.get(invalid)?.trashed,undefined);
 // Repair the controlled test fixture, then fail only the recoverable retirement request.
 await archive.file(`hub:application:${detail.id}:snapshot:revision:2`,'application-r2.json','application/json',first.folderId,new TextEncoder().encode(JSON.stringify({schemaVersion:1,application:{...detail,revision:2}})));
 let fail=true;
 const failRetirement:typeof fetch=async(input,init={})=>{if(fail&&init.method==='PATCH'&&new URL(String(input)).pathname===`/drive/v3/files/${invalid}`){fail=false;return response({},400);}return f.fetcher(input,init);};
 const interrupted=new GoogleWorkspace({...baseConfig,archiveState:f.state},failRetirement);
 await assert.rejects(interrupted.archiveApplication({...detail,revision:3},[original],first.folderId),/google_drive_400/);
 assert.equal(f.files.get(invalid)?.trashed,undefined);assert.ok([...f.files.values()].some(file=>(file.name==='Application.pdf'||file.name==='Application-r2.pdf')));
 const sessions=f.sessions.size;
 await interrupted.archiveApplication({...detail,revision:3},[original],first.folderId);
 assert.equal(f.files.get(invalid)?.trashed,true);assert.equal(f.sessions.size,sessions,'retry uses the already verified PDF');
});

test('current-only candidate folder keeps originals and moves verified revisions into sibling history',async()=>{
 const f=fixture(),first=await f.workspace.archiveApplication(detail,[original]);
 const originalId=[...f.files.values()].find(file=>file.name==='resume.pdf')!.id as string;
 const archive=new GoogleDriveArchive(baseConfig,f.state,f.fetcher);
 const lookalike=await archive.file('unrelated-original','Application-r999.pdf','application/pdf',first.folderId,new Uint8Array([9,9,9]));
 await f.workspace.archiveApplication({...detail,revision:2},[original],first.folderId);
 const inCandidate=[...f.files.values()].filter(file=>!file.trashed&&(file.parents as string[]|undefined)?.includes(first.folderId));
 assert.deepEqual(inCandidate.map(file=>file.name).sort(),['Application-r999.pdf','Application.pdf','resume.pdf'].sort());
 assert.deepEqual(f.files.get(originalId)!.parents,[first.folderId]);assert.deepEqual(f.bytes.get(originalId),original.bytes);assert.deepEqual(f.files.get(lookalike)!.parents,[first.folderId]);
 const older=[...f.files.values()].find(file=>file.name==='Application-r1.pdf')!;
 const history=f.files.get((older.parents as string[])[0])!,historyRoot=f.files.get((history.parents as string[])[0])!;
 assert.equal(historyRoot.name,'Application history');assert.deepEqual(historyRoot.parents,[baseConfig.driveRootId]);assert.notEqual(history.id,first.folderId);
 const previousHash=await hash(f.bytes.get(older.id as string)!);
 assert.equal(await archive.confirmFile(`hub:application:${detail.id}:pdf:v1:revision:1`,first.folderId,String(older.id),previousHash),true);
 const count=f.files.size;await f.workspace.archiveApplication(detail,[original],first.folderId);assert.equal(f.files.size,count,'Replaying an old worker creates no extra files or folder');
 const current=[...f.files.values()].find(file=>file.name==='Application.pdf'&&(file.parents as string[])?.includes(first.folderId))!;
 assert.equal((current.appProperties as Record<string,string>).aclApplicationRevision,'2');
});

test('an interrupted history move resumes without replacing the latest PDF bytes',async()=>{
 const f=fixture(),first=await f.workspace.archiveApplication(detail,[original]);let fail=true;
 const fetcher:typeof fetch=async(input,init={})=>{if(fail&&init.method==='PATCH'&&new URL(String(input)).searchParams.has('addParents')){fail=false;return response({},400);}return f.fetcher(input,init);};
 const worker=new GoogleWorkspace({...baseConfig,archiveState:f.state},fetcher),newer={...detail,revision:2};
 await assert.rejects(worker.archiveApplication(newer,[original],first.folderId));
 const current=[...f.files.values()].find(file=>(file.appProperties as Record<string,string>)?.aclApplicationRevision==='2')!;
 const content=f.bytes.get(String(current.id))!.slice();
 await worker.archiveApplication(newer,[original],first.folderId);
 assert.deepEqual(f.bytes.get(String(current.id)),content);
 assert.equal([...f.files.values()].filter(file=>file.name==='Application.pdf'&&(file.parents as string[])?.includes(first.folderId)).length,1);
});

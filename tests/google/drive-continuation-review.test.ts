import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GoogleWorkspace, type ArchiveItem, type ItemState } from '../../lib/google/workspace';
import { GoogleDriveArchive } from '../../lib/archive/drive';
import { DriveArchiveContinuation, DriveArchiveFailure, type DriveArchiveProgress, type ArchiveContinuation, type ApplicationSnapshot } from '../../lib/google/drive';
import { createStore, jobInput, applicationInput } from '../hub/fixtures';
import { processHubTasks, reconcileLegacyPdfArchives } from '../../lib/task-runner';

type Metadata = { id: string; name?: string; mimeType?: string; parents?: string[]; trashed?: boolean; sha256Checksum?: string; size?: string; appProperties?: Record<string, string> };
const config = { clientId: 'synthetic', clientSecret: 'synthetic', refreshToken: 'synthetic', sender: 'synthetic@example.invalid', driveRootId: 'root' };
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function fakeDrive() {
  const rows = new Map<string, ArchiveItem>(), files = new Map<string, Metadata>([['root', { id: 'root', name: 'Private root', mimeType: 'application/vnd.google-apps.folder' }]]), bytes = new Map<string, Uint8Array>();
  const sessions = new Map<string, { metadata: Metadata; total: number; offset: number; chunks: Uint8Array[] }>();
  const state: ItemState = {
    async get(key) { return rows.get(key) || null; },
    async reserve(key, driveId, parentId) {
      if (!rows.has(key)) rows.set(key, { key, drive_id: driveId, parent_id: parentId, content_hash: null, session_url: null, updated_at: Date.now() });
      return rows.get(key)!;
    },
    async update(key, hash, session) { Object.assign(rows.get(key)!, { content_hash: hash, session_url: session }); },
  };
  let generated = 0, latency = 0, clock = Date.now(), calls = 0, failQuota = false, retireDeadline: number | null = null;
  const fetcher: typeof fetch = async (input, init = {}) => {
    const began = clock; await Promise.resolve(); clock = Math.max(clock, began + latency); calls++;
    const url = new URL(String(input)), method = init.method || 'GET';
    if (url.hostname === 'oauth2.googleapis.com') return json({ access_token: 'synthetic', expires_in: 3600 });
    if (failQuota) return new Response(null, { status: 429, headers: { 'Retry-After': '60' } });
    if (url.pathname.endsWith('/permissions')) return json({ permissions: [{ type: 'user' }] });
    if (url.pathname.endsWith('/generateIds')) return json({ ids: ['synthetic-' + ++generated] });
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q')!, parent = /^'([^']+)'/.exec(q)![1], key = /value='([a-f0-9]+)'/.exec(q)?.[1];
      return json({ files: [...files.values()].filter(file => !file.trashed && file.parents?.includes(parent) && (key ? file.appProperties?.aclArchiveKey === key : file.mimeType === (q.includes('application/pdf')?'application/pdf':'application/json'))) });
    }
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const metadata = JSON.parse(String(init.body)) as Metadata;
      assert.equal(rows.get(metadata.appProperties!.aclArchiveKey)?.drive_id, metadata.id, 'Provider creation follows durable reservation.');
      if (files.has(metadata.id)) return json({}, 409);
      files.set(metadata.id, metadata); return json(metadata);
    }
    if (url.pathname.startsWith('/drive/v3/files/')) {
      const id = url.pathname.split('/').at(-1)!, metadata = files.get(id);
      if (!metadata) return json({}, 404);
      if (method === 'PATCH') { Object.assign(metadata, JSON.parse(String(init.body))); if(url.searchParams.has('addParents'))metadata.parents=[url.searchParams.get('addParents')!]; if (retireDeadline !== null) { clock = Math.max(clock, retireDeadline - 1000); retireDeadline = null; } return json({ id, trashed: metadata.trashed, parents:metadata.parents }); }
      return url.searchParams.get('alt') === 'media' ? new Response(bytes.get(id)! as BodyInit) : json(metadata);
    }
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      if (method === 'POST' || method === 'PATCH') {
        const metadata = JSON.parse(String(init.body)) as Metadata;
        if (method === 'PATCH') { metadata.id = url.pathname.split('/').at(-1)!; metadata.parents = files.get(metadata.id)!.parents; }
        assert.equal(rows.get(metadata.appProperties!.aclArchiveKey)?.drive_id, metadata.id);
        const session = 'session-' + (sessions.size + 1);
        sessions.set(session, { metadata, total: Number(new Headers(init.headers).get('X-Upload-Content-Length')), offset: 0, chunks: [] });
        return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=' + session } });
      }
      const session = sessions.get(url.searchParams.get('upload_id')!)!, range = new Headers(init.headers).get('Content-Range')!;
      if (!range.startsWith('bytes */')) { const chunk = new Uint8Array(init.body as Uint8Array); session.chunks.push(chunk); session.offset += chunk.length; }
      if (session.offset < session.total) return new Response(null, { status: 308, headers: session.offset ? { Range: `bytes=0-${session.offset - 1}` } : {} });
      const body = new Uint8Array(session.total); let position = 0;
      for (const chunk of session.chunks) { body.set(chunk, position); position += chunk.length; }
      files.set(session.metadata.id, { ...session.metadata, sha256Checksum: digest(body), size: String(body.length) }); bytes.set(session.metadata.id, body);
      return json({ id: session.metadata.id });
    }
    throw new Error('Unexpected synthetic request: ' + url.pathname);
  };
  return { state, files, bytes, rows, sessions, fetcher, now: () => clock, calls: () => calls, slow: (ms: number) => { latency = ms; }, quota: () => { failQuota = true; }, retireNearDeadline: (deadline: number) => { retireDeadline = deadline; }, workspace: () => new GoogleWorkspace({ ...config, archiveState: state }, fetcher) };
}
const detail: ApplicationSnapshot = { id: 'synthetic-app', jobId: 'synthetic-job', jobTitle: 'Synthetic Engineer', name: 'Synthetic Candidate', revision: 20, createdAt: 1, fields: [], answers: [{ path: 'experience', value: 'Synthetic evidence' }], history: [], files: [{ id: 'original', filename: 'Original.pdf', contentType: 'application/pdf', size: 3 }] };
const original = { id: 'original', name: 'Original.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) };
function checkpoint() {
  let progress: DriveArchiveProgress | null = null, index = 0;
  const continuation: ArchiveContinuation = { read: async () => index, write: async next => { index = next; }, readProgress: async () => structuredClone(progress), writeProgress: async next => { progress = structuredClone(next); } };
  return { continuation, progress: () => progress, index: () => index };
}
async function legacy(f: ReturnType<typeof fakeDrive>, folder: string, revision: number) {
  return new GoogleDriveArchive(config, f.state, f.fetcher).file(`hub:application:${detail.id}:snapshot:revision:${revision}`, `application-r${revision}.json`, 'application/json', folder,
    new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, application: { ...detail, revision, history: [{ type: 'note', text: 'Historical revision ' + revision }] } })));
}

test('realistic API latency and worker restarts finish more than eight legacy steps without duplicate PDFs or originals', async () => {
  const f = fakeDrive(), first = await f.workspace().archiveApplication(detail, [original]);
  const legacyIds = [];
  for (let revision = 1; revision <= 12; revision++) legacyIds.push(await legacy(f, first.folderId, revision));
  const beforeUploads = f.sessions.size, cp = checkpoint(), originalNow = Date.now;
  f.slow(700); Date.now = f.now;
  let yields = 0, completed, injected = false, originalLoads = 0;
  try {
    for (let cycle = 0; cycle < 40; cycle++) {
      const workspace = f.workspace(); workspace.setDeadline(f.now() + 40000);
      try {
        completed = await workspace.archiveApplication(detail, [{ id: original.id, name: original.name, mimeType: original.mimeType, size: original.bytes.length, load: async () => { originalLoads++; return original.bytes; } }], first.folderId, cp.continuation);
        break;
      } catch (error) {
        assert.ok(error instanceof DriveArchiveContinuation, String(error)); yields++;
        assert.ok(cp.progress()?.folderId);
        assert.ok(cp.progress()?.legacyNext !== undefined);
        if (!injected && cp.progress()?.legacy?.length) { f.slow(0); legacyIds.push(await legacy(f, first.folderId, 13)); f.slow(700); injected = true; }
      }
    }
    assert.ok(completed, 'Durable migration must terminate.');
    assert.ok(yields > 8, 'Continuation remains viable after the ordinary failure-attempt limit.');
    assert.equal(completed.archiveFormat, 'pdf-current-v3'); assert.equal(completed.archivedRevision, detail.revision);
    assert.equal(completed.legacyJsonFileIds.length, 13, 'Final scan includes the late old-worker snapshot.');
    assert.equal(cp.index(), 1); assert.equal(originalLoads, 1, 'Original checkpoint survives every new workspace instance.');
    assert.equal([...f.sessions.values()].slice(beforeUploads).filter(session => session.metadata.mimeType === 'application/pdf').length, 13, 'Each legacy PDF uploads once; cached current PDF does not re-upload.');
    assert.equal([...f.files.values()].filter(file => file.name === 'Original.pdf').length, 1);
    for (const id of legacyIds) assert.equal(f.files.get(id)?.trashed, true);
    assert.equal(new Set([...f.files.values()].filter(file => file.mimeType === 'application/pdf').map(file => file.name)).size, 15);
  } finally { Date.now = originalNow; }
});

test('a no-progress quota/backoff deadline is a genuine failure rather than endless refunded continuation', async () => {
  const f = fakeDrive(), first = await f.workspace().archiveApplication(detail, [original]), cp = checkpoint(), originalNow = Date.now;
  f.quota(); Date.now = f.now;
  try {
    const workspace = f.workspace(); workspace.setDeadline(f.now() + 40000);
    await assert.rejects(workspace.archiveApplication(detail, [original], first.folderId, cp.continuation), error => {
      assert.ok(!(error instanceof DriveArchiveContinuation));
      assert.equal((error as { diagnostics?: Record<string, unknown> }).diagnostics?.providerStatus, 429);
      return true;
    });
    assert.equal(cp.progress(), null);
  } finally { Date.now = originalNow; }
});

test('repeated startup latency with no durable advancement cannot yield forever', async () => {
  const f = fakeDrive(), first = await f.workspace().archiveApplication(detail, [original]), cp = checkpoint(), originalNow = Date.now;
  f.slow(8000); Date.now = f.now;
  try {
    for (let cycle = 0; cycle < 3; cycle++) {
      const workspace = f.workspace(); workspace.setDeadline(f.now() + 40000);
      let caught: unknown;
      try { await workspace.archiveApplication(detail, [original], first.folderId, cp.continuation); } catch (error) { caught = error; }
      if (cycle === 0) assert.ok(caught instanceof DriveArchiveContinuation, 'The initial folder checkpoint is real progress.');
      else assert.ok(caught && !(caught instanceof DriveArchiveContinuation), 'An unchanged checkpoint needs actionable budget failure/backoff.');
    }
  } finally { Date.now = originalNow; }
});

test('real SQLite queue persists twelve continuations without exhausting retries or claiming partial completion', async () => {
  const { store, database, db } = createStore(), originalNow = Date.now;
  let clock = originalNow(), calls = 0;
  try {
    const job = await store.saveJob(jobInput()), app = await store.acceptApplication(applicationInput(job.id));
    database.exec("DELETE FROM hub_communications; DELETE FROM hub_tasks WHERE kind='gmail'");
    clock = originalNow(); Date.now = () => clock;
    const workspace = {
      async archiveApplication(record: ApplicationSnapshot, _files: unknown[], _folder: unknown, continuation: ArchiveContinuation) {
        calls++;
        if (calls <= 12) {
          await continuation.writeProgress!({ version: 1, applicationId: record.id, revision: record.revision, rendererVersion: 'readable-v2', contentFingerprint: 'a'.repeat(64), legacyNext: calls, legacyJsonFileIds: [] });
          throw new DriveArchiveContinuation('legacy_next', { reason: 'one_revision_per_cycle' });
        }
        return { folderId: 'synthetic-folder', folderUrl: 'https://drive.google.com/drive/folders/synthetic-folder', archivedRevision: record.revision, archiveFormat: 'pdf-current-v3', legacyJsonFileIds: [] };
      },
    } as unknown as GoogleWorkspace;
    for (let cycle = 0; cycle < 12; cycle++) {
      const result = await processHubTasks(store, db, {} as R2Bucket, workspace, 5, [], async () => null);
      assert.equal(result.failed, 0);
      assert.equal(calls, cycle + 1, 'Future run_after prevents a spin in the same worker invocation.');
      const task = database.prepare("SELECT status,attempts,run_after,result_json FROM hub_tasks WHERE application_id=? AND kind='drive'").get(app.id)!;
      assert.equal(task.status, 'pending'); assert.equal(task.attempts, 0);
      assert.ok(Number(task.run_after) > clock);
      const savedResult = JSON.parse(String(task.result_json));
      assert.equal(savedResult.continuation, true);
      assert.equal(savedResult.archivedRevision, undefined); assert.equal(savedResult.archiveFormat, undefined);
      assert.equal(database.prepare("SELECT drive_folder_url FROM hub_applications WHERE id=?").get(app.id)!.drive_folder_url, null);
      clock += 31000;
    }
    await processHubTasks(store, db, {} as R2Bucket, workspace, 5, [], async () => null);
    assert.equal(calls, 13);
    const finished = database.prepare("SELECT status,attempts,result_json FROM hub_tasks WHERE application_id=? AND kind='drive'").get(app.id)!;
    assert.equal(finished.status, 'done'); assert.equal(finished.attempts, 1);
    assert.equal(JSON.parse(String(finished.result_json)).archiveFormat, 'pdf-current-v3');
    assert.equal(await reconcileLegacyPdfArchives(db, store), 0, 'The new complete format must suppress duplicate backfill.');
  } finally { Date.now = originalNow; database.close(); }
});

test('provider failures consume retries and backfill priority lets fresh applicant tasks run first', async () => {
  const { store, database, db } = createStore();
  try {
    const job = await store.saveJob(jobInput()), app = await store.acceptApplication(applicationInput(job.id));
    database.exec("DELETE FROM hub_communications; DELETE FROM hub_tasks WHERE kind='gmail'");
    const failedWorkspace = { async archiveApplication() { throw new DriveArchiveFailure('deadline_exceeded', 'legacy_read', { provider: 'google_drive', providerStatus: 429 }); } } as unknown as GoogleWorkspace;
    await processHubTasks(store, db, {} as R2Bucket, failedWorkspace, 5, [], async () => null);
    const failed = database.prepare("SELECT status,attempts,result_json FROM hub_tasks WHERE application_id=? AND kind='drive'").get(app.id)!;
    assert.equal(failed.status, 'failed'); assert.equal(failed.attempts, 1);
    assert.equal(JSON.parse(String(failed.result_json)).diagnostics.providerStatus, 429);
    const fresh = await store.acceptApplication(applicationInput(job.id));
    database.exec("DELETE FROM hub_communications; DELETE FROM hub_tasks WHERE kind='gmail'");
    await store.taskStatement('synthetic-old-backfill', app.id, 'drive', { applicationId: app.id, pdfBackfill: true }, 0).run();
    const selected = await store.claimTask(Date.now());
    assert.equal(selected!.applicationId, fresh.id, 'Old backfill cannot starve a fresh applicant archive.');
  } finally { database.close(); }
});

test('tampered cached historical source is rejected before uploading its PDF or retiring the JSON', async () => {
  const f = fakeDrive(), first = await f.workspace().archiveApplication(detail, [original]), legacyId = await legacy(f, first.folderId, 1);
  const archive = new GoogleDriveArchive(config, f.state, f.fetcher), snapshot = await archive.readLegacyApplicationSnapshot(detail.id, first.folderId, { fileId: legacyId, revision: 1 });
  const currentPdf = [...f.files.values()].find(file => (file.name === 'Application.pdf'||file.name === 'Application-r20.pdf'))!;
  const cp = checkpoint(), progress: DriveArchiveProgress = {
    version: 1, applicationId: detail.id, revision: detail.revision, rendererVersion: 'readable-v2', contentFingerprint: digest(new TextEncoder().encode(JSON.stringify(detail))),
    folderId: first.folderId, currentPdf: { id: currentPdf.id, hash: currentPdf.sha256Checksum! }, legacy: [{ fileId: legacyId, revision: 1 }], legacyNext: 0, legacyJsonFileIds: [],
    legacySource: { ...snapshot!, sourceFingerprint: digest(new TextEncoder().encode(JSON.stringify(snapshot!.application))) },
  };
  progress.legacySource!.application.name = 'Synthetic forged cached name';
  await cp.continuation.writeProgress!(progress);
  const uploads = f.sessions.size, workspace = f.workspace(); workspace.setDeadline(Date.now() + 40000);
  await assert.rejects(workspace.archiveApplication(detail, [original], first.folderId, cp.continuation), { code: 'drive_legacy_snapshot_identity_mismatch' });
  assert.equal(f.sessions.size, uploads);
  assert.equal(f.files.get(legacyId)?.trashed, undefined);
  assert.ok(f.bytes.has(legacyId), 'Original historical source remains recoverable.');
});

test('a different historical snapshot of the current revision cannot overwrite its authoritative PDF or poison the next continuation', async () => {
  const f = fakeDrive(), current = { ...detail, aiMatch: { status: 'failed', error: 'synthetic_provider_outage' } }, first = await f.workspace().archiveApplication(current, [original]);
  const currentFile = [...f.files.values()].find(file => (file.name === 'Application.pdf'||file.name === 'Application-r20.pdf'))!, currentBytes = f.bytes.get(currentFile.id)!.slice();
  const legacyId = await legacy(f, first.folderId, 20), cp = checkpoint(), originalNow = Date.now;
  f.slow(700); Date.now = f.now;
  try {
    const deadline = f.now() + 40000;
    f.retireNearDeadline(deadline);
    const initial = f.workspace(); initial.setDeadline(deadline);
    await assert.rejects(initial.archiveApplication(current, [original], first.folderId, cp.continuation), DriveArchiveContinuation);
    assert.equal(f.files.get(legacyId)?.trashed, true, 'The first slice confirms the historical replacement before retirement.');
    const resumed = f.workspace(); resumed.setDeadline(f.now() + 40000);
    const completed = await resumed.archiveApplication(current, [original], first.folderId, cp.continuation);
    assert.equal(completed.archiveFormat, 'pdf-current-v3');
    assert.deepEqual(f.bytes.get(currentFile.id), currentBytes, 'Current and historical content need separate file identities.');
    assert.equal([...f.files.values()].filter(file => file.mimeType === 'application/pdf').length, 3, 'Current PDF, historical PDF and original are all preserved.');
  } finally { Date.now = originalNow; }
});

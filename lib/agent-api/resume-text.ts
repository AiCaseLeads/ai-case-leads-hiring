import {DeadlineError} from '../hiring/deadline';
import {HiringError} from '../hiring/errors';
import type {HubStore} from '../hub/store';
import {claimFileText, queueFileText, readCachedFileTexts, type CacheFileIdentity} from '../resume-text/cache';
import {processClaimedFileText} from '../resume-text/worker';
import {AgentReadError} from './errors';

type ReadContext = {
  store: HubStore;
  bucket?: Pick<R2Bucket, 'get'>;
  applicationId: string;
  file: CacheFileIdentity;
  deadline: number;
  storageTimeoutMs?: number;
};

// Bulk export/search never come through this path. A single authorized read
// can fill exactly its requested cache row, even with the background loop off.
export async function readSingleResumeText({store,bucket,applicationId,file,deadline,storageTimeoutMs}: ReadContext) {
  const read = async () => (await readCachedFileTexts(store,[file])).get(file.id)!;
  let cached = await read();
  if (cached.status !== 'pending' && cached.status !== 'running') return cached;
  if (!bucket) throw new HiringError('storage_unavailable',503,'File storage is unavailable.');
  await queueFileText(store.db,file.id);

  while (Date.now() < deadline) {
    // A file can be trashed or reassigned while a parser runs. Validate
    // ownership again before returning its result to a waiting request.
    const visible = await store.stmt(`SELECT 1 FROM hub_files f WHERE f.id=? AND f.application_id=?
      AND f.uploaded_at=? AND f.size=? AND f.content_type=?
      AND NOT EXISTS(SELECT 1 FROM hub_settings WHERE key='application_trash:'||f.application_id)`,
      file.id,applicationId,file.uploaded_at,file.size,file.content_type).first();
    if (!visible) throw new HiringError('file_not_found',404,'This file is unavailable.');
    cached = await read();
    if (cached.status !== 'pending' && cached.status !== 'running') return cached;
    if (cached.status === 'pending' && cached.errorCode && cached.retryAfterSeconds && cached.retryAfterSeconds*1000 > deadline-Date.now()) {
      throw new AgentReadError('resume_text_retry',503,'The extraction service is retrying this file.',{retryAfterSeconds:cached.retryAfterSeconds});
    }
    // Another request or the worker may own the lease. Attempting an exact
    // claim also recovers a crashed worker's expired lease on this file.
    const row = await claimFileText(store,Date.now(),file);
    if (row) {
      await processClaimedFileText({store,bucket,storageTimeoutMs},row);
    } else {
      await new Promise(resolve=>setTimeout(resolve,Math.min(300,Math.max(0,deadline-Date.now()))));
    }
  }
  throw new DeadlineError('agent_read_timeout');
}

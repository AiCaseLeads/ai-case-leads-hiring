import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, jobInput, applicationInput, MANAGER } from './fixtures';
import { applicationTrash, changeApplicationTrash } from '../../lib/hub/application-lifecycle';
import { changeJobLifecycle } from '../../lib/hub/job-lifecycle';

test('concurrent Trash and Restore each have one winner and record one history event', async () => {
  const { store, database } = createStore();
  try {
    const job = await store.saveJob(jobInput()), app = await store.acceptApplication(applicationInput(job.id));
    const trash = await Promise.allSettled([1, 2].map(() => changeApplicationTrash(store, app.id, 'trash', 1, MANAGER)));
    assert.equal(trash.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(trash.filter(result => result.status === 'rejected').length, 1);
    assert.equal((await store.getApplication(app.id)).revision, 2);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM hub_history WHERE application_id=? AND type='trash'").get(app.id)!.n, 1);
    const restore = await Promise.allSettled([1, 2].map(() => changeApplicationTrash(store, app.id, 'restore', 2, MANAGER)));
    assert.equal(restore.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(restore.filter(result => result.status === 'rejected').length, 1);
    assert.equal(await applicationTrash(store, app.id), null);
    assert.equal((await store.getApplication(app.id)).revision, 3);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM hub_history WHERE application_id=? AND type='restore'").get(app.id)!.n, 1);
  } finally { database.close(); }
});

test('a competing recruiter update during deletion rolls back Trash and all email cancellations', async () => {
  const { store, database } = createStore();
  try {
    const job = await store.saveJob(jobInput()), app = await store.acceptApplication(applicationInput(job.id));
    const batch = store.db.batch.bind(store.db);
    store.db.batch = async statements => {
      database.prepare("UPDATE hub_applications SET revision=revision+1,stage='Screening' WHERE id=?").run(app.id);
      return batch(statements);
    };
    await assert.rejects(changeApplicationTrash(store, app.id, 'trash', 1, MANAGER), { code: 'application_changed' });
    assert.equal(await applicationTrash(store, app.id), null);
    assert.equal((await store.getApplication(app.id)).stage, 'Screening');
    assert.equal(database.prepare("SELECT COUNT(*) n FROM hub_tasks WHERE application_id=? AND kind='gmail' AND status='pending'").get(app.id)!.n, 1);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM hub_history WHERE application_id=? AND type='trash'").get(app.id)!.n, 0);
  } finally { database.close(); }
});

test('a worker starting Gmail between the initial read and delete transaction blocks removal without cancelling its lease', async () => {
  const { store, database } = createStore();
  try {
    const job = await store.saveJob(jobInput()), app = await store.acceptApplication(applicationInput(job.id));
    const batch = store.db.batch.bind(store.db);
    store.db.batch = async statements => {
      database.prepare("UPDATE hub_tasks SET status='running',lease_token='synthetic-worker',lease_until=? WHERE application_id=? AND kind='gmail'").run(Date.now() + 60000, app.id);
      return batch(statements);
    };
    await assert.rejects(changeApplicationTrash(store, app.id, 'trash', 1, MANAGER), { code: 'application_changed' });
    assert.equal(await applicationTrash(store, app.id), null);
    assert.equal((await store.getApplication(app.id)).stage, 'Application Review');
    assert.equal(database.prepare("SELECT lease_token FROM hub_tasks WHERE application_id=? AND kind='gmail'").get(app.id)!.lease_token, 'synthetic-worker');
    assert.equal(database.prepare("SELECT status FROM hub_communications WHERE application_id=?").get(app.id)!.status, 'pending');
  } finally { database.close(); }
});

test('a stale recruiter action cannot queue mail after Trash wins the write race', async () => {
  const { store, database } = createStore();
  try {
    const job = await store.saveJob(jobInput()), app = await store.acceptApplication(applicationInput(job.id));
    const batch = store.db.batch.bind(store.db);
    let injecting = false;
    store.db.batch = async statements => {
      if (!injecting) {
        injecting = true;
        await changeApplicationTrash(store, app.id, 'trash', 1, MANAGER);
      }
      return batch(statements);
    };
    await assert.rejects(store.action(app.id, { action: 'email', expectedRevision: 1, actionId: crypto.randomUUID(), subject: 'Race message', body: 'Never send this message.' }, MANAGER));
    assert.equal((await store.getApplication(app.id)).trashed, true);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM hub_tasks WHERE application_id=? AND id LIKE '%:manual:%'").get(app.id)!.n, 0);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM hub_communications WHERE application_id=? AND status='pending'").get(app.id)!.n, 0);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM hub_history WHERE application_id=? AND type='email'").get(app.id)!.n, 0);
  } finally { database.close(); }
});

test('a job paused between validation and application commit rejects acceptance with no orphan queue or records', async () => {
  const { store, database } = createStore();
  try {
    const job = await store.saveJob(jobInput()), input = applicationInput(job.id);
    const batch = store.db.batch.bind(store.db);
    let injecting = false;
    store.db.batch = async statements => {
      if (!injecting) {
        injecting = true;
        await changeJobLifecycle(store, job.id, { action: 'pause', formVersion: job.formVersion, lifecycleRevision: 0 }, MANAGER);
      }
      return batch(statements);
    };
    await assert.rejects(store.acceptApplication(input), { code: 'submission_conflict' });
    assert.equal((await store.getJob(job.id)).status, 'closed');
    for (const table of ['hub_applications', 'hub_tasks', 'hub_communications', 'hub_history']) {
      assert.equal(database.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n, 0, table);
    }
  } finally { database.close(); }
});

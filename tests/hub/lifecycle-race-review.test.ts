import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, jobInput, applicationInput, MANAGER } from './fixtures';
import { applicationTrash, changeApplicationTrash } from '../../lib/hub/application-lifecycle';
import { changeJobLifecycle } from '../../lib/hub/job-lifecycle';
import { processHubTasks } from '../../lib/task-runner';
import type { GoogleWorkspace } from '../../lib/google/workspace';

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

test('the worker suppresses stale repaired Gmail and Calendar work for Trash while archiving retained records', async () => {
  const { store, database, db } = createStore();
  try {
    const job = await store.saveJob(jobInput()), app = await store.acceptApplication(applicationInput(job.id));
    await changeApplicationTrash(store, app.id, 'trash', 1, MANAGER);
    // Simulate a delayed repair/recovery enqueue that arrives after deletion.
    database.prepare("UPDATE hub_tasks SET status='pending',run_after=0 WHERE application_id=? AND kind='gmail'").run(app.id);
    await store.taskStatement('calendar:synthetic-stale-task', app.id, 'calendar', { operation: 'create', interviewId: 'synthetic-old-interview', revision: 1 }, 0).run();
    let archives = 0;
    const google = {
      async archiveApplication(detail: { id: string; revision: number }) {
        archives++;
        assert.equal(detail.id, app.id);
        return { folderId: 'synthetic-folder', folderUrl: 'https://drive.google.com/drive/folders/synthetic-folder', archivedRevision: detail.revision, archiveFormat: 'pdf-v1' };
      },
      async sendMail() { assert.fail('Trashed applicants must not receive stale email.'); },
      async createInterview() { assert.fail('Trashed applicants must not receive stale calendar events.'); },
      async updateInterview() { assert.fail('Trashed applicants must not receive stale calendar updates.'); },
    } as unknown as GoogleWorkspace;
    await processHubTasks(store, db, {} as R2Bucket, google, 5, [], async () => null);
    assert.ok(archives >= 1, 'Files/hiring records remain eligible for durable archival.');
    const tasks = database.prepare("SELECT kind,status,result_json FROM hub_tasks WHERE application_id=? AND kind IN ('gmail','calendar')").all(app.id);
    assert.equal(tasks.length, 2);
    for (const task of tasks) {
      assert.equal(task.status, 'done');
      assert.equal(JSON.parse(String(task.result_json)).applicationTrashed, true);
    }
    assert.equal((await store.getApplication(app.id)).trashed, true);
  } finally { database.close(); }
});

test('failed cancellation cannot be hidden in Trash while its external interview may still exist', async () => {
  const { store, database } = createStore();
  try {
    const job = await store.saveJob(jobInput()), app = await store.acceptApplication(applicationInput(job.id));
    database.prepare("INSERT INTO hub_interviews(id,application_id,status,start,end,calendar_id,provider_id,created_at,updated_at) VALUES('synthetic-failed-cancel',?,'failed',?,?,'synthetic-calendar','external-event',?,?)")
      .run(app.id, new Date(Date.now() + 3600000).toISOString(), new Date(Date.now() + 5400000).toISOString(), Date.now(), Date.now());
    await store.taskStatement('calendar:synthetic-failed-cancel:2', app.id, 'calendar', { operation: 'cancel', interviewId: 'synthetic-failed-cancel', calendarId: 'synthetic-calendar', revision: 2 }, 0).run();
    database.prepare("UPDATE hub_tasks SET status='failed',last_error='google_authorization_required' WHERE id='calendar:synthetic-failed-cancel:2'").run();
    await assert.rejects(changeApplicationTrash(store, app.id, 'trash', 1, MANAGER), { code: 'cancel_interview_first' });
    assert.equal(await applicationTrash(store, app.id), null);
    assert.equal(database.prepare("SELECT status FROM hub_tasks WHERE id='calendar:synthetic-failed-cancel:2'").get()!.status, 'failed');
    assert.equal(database.prepare("SELECT provider_id FROM hub_interviews WHERE id='synthetic-failed-cancel'").get()!.provider_id, 'external-event');
  } finally { database.close(); }
});

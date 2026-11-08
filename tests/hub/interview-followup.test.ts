import assert from 'node:assert/strict';
import test from 'node:test';
import { bookingFollowupDueAt, bookingFollowupIsCurrent } from '../../lib/hub/interview-reminders';
import { approveScheduling, applicationInput, createStore, currentAction, jobInput, MANAGER } from './fixtures';

test('two business days preserves the Eastern wall time through weekends and both clock changes', () => {
  const dates = [
    ['2026-10-28T14:30:05.123Z', '2026-10-30T14:30:05.123Z'],
    ['2026-10-30T14:30:05.123Z', '2026-11-03T15:30:05.123Z'],
    ['2026-03-06T15:30:00.000Z', '2026-03-10T14:30:00.000Z'],
    ['2026-11-01T16:00:00.000Z', '2026-11-03T16:00:00.000Z'],
  ];
  for (const [sent, expected] of dates) assert.equal(new Date(bookingFollowupDueAt(Date.parse(sent))).toISOString(), expected);
});

async function makeInvitation() {
  const fixture = createStore();
  const { store } = fixture;
  const job = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(job.id));
  await approveScheduling(store);
  await currentAction(store, id, {action: 'interview'}, MANAGER);
  const original = (await store.tasks()).find(t => t.id.includes(':interview:'))!;
  const delivery = await store.claimInterviewMail(original.id, id, Date.now());
  assert.ok(delivery?.leaseToken);
  return { ...fixture, id, original, lease: delivery.leaseToken };
}

test('a provider-confirmed invitation schedules just one follow-up with the same booking link; revalidate before delivery', async t => {
  const { store, database, id, original, lease } = await makeInvitation();
  t.after(()=>database.close());
  assert.equal((await store.tasks()).filter(t => t.payload.bookingFollowup).length, 0);
  await store.finishTask(original.id, lease, {status:'done', result:{id:'accepted-by-provider'}});
  const followups = (await store.tasks()).filter(t => t.payload.bookingFollowup);
  assert.equal(followups.length, 1);
  const [message] = followups;
  const sentAt = database.prepare('SELECT updated_at FROM hub_communications WHERE task_id=?').get(original.id)!.updated_at as number;
  assert.equal(message.runAfter, bookingFollowupDueAt(sentAt));
  const url = String(original.payload.body).match(/https:\/\/[^\s]+\/interview\/[a-f0-9]{64}/)![0];
  assert.ok(String(message.payload.body).includes(url));
  assert.equal(message.payload.actor, original.payload.actor);
  const history = (await store.getApplication(id)).communications.find(row=>row.subject === message.payload.subject);
  assert.ok(history && !history.body.includes(url));
  assert.equal(await bookingFollowupIsCurrent(store, message, message.runAfter - 1), false);
  assert.equal(await bookingFollowupIsCurrent(store, message, message.runAfter), true);
  assert.equal(await bookingFollowupIsCurrent(store, message, Number(message.payload.expiresAt)), false);
  await assert.rejects(store.finishTask(original.id,lease,{status:'done',result:{id:'same-provider-id'}}), {code:'task_lease_lost'});
  assert.equal((await store.tasks()).filter(t=>t.payload.bookingFollowup).length,1);

  await store.setSetting('interview_reminders_enabled', false);
  assert.equal(await bookingFollowupIsCurrent(store, message, message.runAfter), false);
  await store.setSetting('interview_reminders_enabled', true);
  database.prepare("UPDATE hub_interviews SET status='pending' WHERE application_id=?").run(id);
  assert.equal(await bookingFollowupIsCurrent(store, message, message.runAfter), false);
  database.prepare("UPDATE hub_interviews SET status='invited' WHERE application_id=?").run(id);
  database.prepare("UPDATE hub_applications SET stage='Rejected' WHERE id=?").run(id);
  assert.equal(await bookingFollowupIsCurrent(store, message, message.runAfter), false);
  database.prepare("UPDATE hub_applications SET stage='Interview' WHERE id=?").run(id);
  database.prepare('UPDATE hub_links SET used_at=? WHERE token_hash=?').run(Date.now(), String(message.payload.invitationHash));
  assert.equal(await bookingFollowupIsCurrent(store, message, message.runAfter), false);
});

test('uncertain and stale invitations never trigger a follow-up, and an explicit opt-out is respected', async t => {
  for (const scenario of ['uncertain','stale','opted-out'] as const) {
    const {store,database,original,lease} = await makeInvitation();
    t.after(()=>database.close());
    if (scenario === 'opted-out') await store.setSetting('interview_reminders_enabled', false);
    await store.finishTask(original.id, lease, scenario === 'uncertain' ? {status:'uncertain'}
      : {status:'done', result:{id:'synthetic-provider-id', stale:scenario === 'stale'}});
    assert.equal((await store.tasks()).filter(task=>task.payload.bookingFollowup).length,0);
  }
});

test('the worker sends one due follow-up with the interviewer as Reply-To and original sender in CC', async t => {
  const { store, database, db, original, lease } = await makeInvitation();
  t.after(()=>database.close());
  const interviewer = 'recruiter@example.invalid';
  const envelope = {sender: MANAGER.email, to: original.payload.to, cc:[MANAGER.email], replyTo:[interviewer]};
  database.prepare("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES ('second',?,'recruiter',1,0,0)").run(interviewer);
  database.prepare("UPDATE hub_tasks SET payload_json=? WHERE id=?").run(JSON.stringify({
    ...original.payload, approvedEnvelope:envelope, interviewerEmail:interviewer,
  }),original.id);
  await store.finishTask(original.id, lease, {status:'done',result:{id:'provider-id'}});
  const message = (await store.tasks()).find(task=>task.payload.bookingFollowup)!;
  assert.ok(message);
  database.prepare("UPDATE hub_tasks SET status='done' WHERE id<>?").run(message.id);
  t.mock.timers.enable({apis:['Date'],now:message.runAfter});
  const {processHubTasks}=await import('../../lib/task-runner');
  const mail: import('../../lib/google/workspace').MailInput[]=[];
  const client={sendMail: async (payload:import('../../lib/google/workspace').MailInput) => {
    mail.push(payload);return {id:'followup-provider-id',threadId:'followup-thread'};
  }} as import('../../lib/google/workspace').GoogleWorkspace;
  await processHubTasks(store,db,undefined,undefined,1,[MANAGER.email],async()=>client);
  assert.equal(mail.length,1);
  assert.equal(mail[0].sender,envelope.sender);
  assert.deepEqual(mail[0].cc,envelope.cc);
  assert.deepEqual(mail[0].replyTo,envelope.replyTo);
  assert.equal(mail[0].to,envelope.to);
  assert.equal(database.prepare('SELECT status FROM hub_communications WHERE task_id=?').get(message.id)!.status,'sent');
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM hub_tasks WHERE json_extract(payload_json,\'$.bookingFollowup\')=1').get()!.n,1);
});

test('a pre-release invitation finishing after backfill gets a follow-up only with its approved envelope', async t => {
  const {backfillInterviewEmails} = await import('../../lib/hub/interview-email-backfill');
  for (const approved of [true, false]) {
    const {store,database,original,lease} = await makeInvitation();
    t.after(()=>database.close());
    const payload = {...original.payload};
    delete payload.followupOnDelivery;
    if (approved) payload.approvedEnvelope = {sender:MANAGER.email,to:payload.to,cc:[MANAGER.email],replyTo:[MANAGER.email]};
    database.prepare("UPDATE hub_tasks SET payload_json=? WHERE id=?").run(JSON.stringify(payload),original.id);
    await backfillInterviewEmails(store);
    assert.equal((await store.tasks()).some(task=>task.payload.bookingFollowup),false);
    // The scan already passed the row; later confirmation must schedule on its own.
    await store.finishTask(original.id,lease,{status:'done',result:{id:'provider-confirmed-later'}});
    assert.equal((await store.tasks()).filter(task=>task.payload.bookingFollowup).length,approved ? 1 : 0);
  }
});

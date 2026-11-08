import assert from "node:assert/strict";
import test from "node:test";
import { backfillInterviewEmails } from "../../lib/hub/interview-email-backfill";
import { approveScheduling, currentAction, MANAGER, applicationInput, createStore, jobInput } from "./fixtures";

test("existing bookings get each remaining reminder once across batches, including when another worker resumes", async t => {
  const {store, database} = createStore();
  t.after(() => database.close());
  const job = await store.saveJob(jobInput());
  const app = await store.acceptApplication(applicationInput(job.id));
  const now = Date.now();
  const start = (minutes: number) => new Date(now + minutes * 60000).toISOString();
  const insert = database.prepare(`INSERT INTO hub_interviews
    (id,application_id,status,start,time_zone,meet_url,provider_id,calendar_id,created_at,updated_at)
    VALUES(?,?,?,?,'America/New_York','https://meet.google.com/abc-defg-hij',?,'recruiter@example.invalid',?,?)`);
  for (let i=0; i<9; i++) insert.run('future-'+i,app.id,'booked',start(90),'event-'+i,now,now);
  insert.run('past',app.id,'booked',start(-60),'past-event',now,now);
  insert.run('unlinked',app.id,'booked',start(120),null,now,now);
  insert.run('cancelled',app.id,'cancelled',start(120),'cancelled-event',now,now);
  database.prepare("UPDATE hub_interviews SET end=strftime('%Y-%m-%dT%H:%M:%fZ',start,'+30 minutes') WHERE application_id=?").run(app.id);
  const reminders = () => database.prepare("SELECT id FROM hub_tasks WHERE id LIKE '%:reminder:%' ORDER BY id").all().map(row => row.id);
  await store.setSetting('interview_reminders_enabled',false);
  await backfillInterviewEmails(store,now);
  assert.deepEqual(reminders(),[]);
  await store.setSetting('interview_reminders_enabled',true);
  await backfillInterviewEmails(store,now);
  assert.equal(reminders().length,16);
  await Promise.all([backfillInterviewEmails(store,now),backfillInterviewEmails(store,now)]);
  const expected = Array.from({length:9},(_,i)=>['1h','5m'].map(offset=>`gmail:${app.id}:reminder:future-${i}:1:${offset}`)).flat().sort();
  assert.deepEqual(reminders(),expected);
  await backfillInterviewEmails(store,now);
  assert.deepEqual(reminders(),expected);
});

test("an old verified invitation receives one follow-up with its actual usable link; an unverified invitation receives none", async t => {
  const {store,database} = createStore();
  t.after(() => database.close());
  const job = await store.saveJob(jobInput());
  await approveScheduling(store);
  const sentAt = Date.now() - 5 * 86400_000;
  const recipients = [];
  for (const delivered of [true, false]) {
    const app = await store.acceptApplication(applicationInput(job.id));
    await currentAction(store, app.id, {action:"interview"}, MANAGER);
    const invitation = (await store.tasks()).find(row=>row.applicationId===app.id && row.id.includes(":invitation:"))!;
    const token = String(invitation.payload.body).match(/\/interview\/([a-f0-9]{64})/)![1];
    const target = invitation.payload.to;
    const approvedEnvelope = {sender:MANAGER.email, to:target, cc:[MANAGER.email], replyTo:[MANAGER.email]};
    const hash = database.prepare("SELECT token_hash FROM hub_links WHERE application_id=? AND kind='interview'").get(app.id)!.token_hash;
    // Emulate the authenticated composer's original task format before follow-ups existed.
    database.prepare("UPDATE hub_tasks SET status=?,payload_json=json_set(payload_json,'$.approvedEnvelope',json(?),'$.invitationHash',?) WHERE id=?")
      .run(delivered ? 'done' : 'uncertain',JSON.stringify(approvedEnvelope),hash,invitation.id);
    database.prepare("UPDATE hub_communications SET status=?,provider_id=?,updated_at=? WHERE task_id=?")
      .run(delivered ? 'sent' : 'uncertain',delivered ? 'mock-provider-id' : null,sentAt,invitation.id);
    recipients.push({id:app.id,token});
  }
  await backfillInterviewEmails(store);
  await backfillInterviewEmails(store);
  const messages = (await store.tasks()).filter(row=>row.payload.bookingFollowup);
  assert.equal(messages.length,1);
  assert.equal(messages[0].applicationId,recipients[0].id);
  assert.ok(String(messages[0].payload.body).includes('/interview/'+recipients[0].token));
  assert.ok(messages[0].runAfter<=Date.now());
});

import test from "node:test";
import assert from "node:assert/strict";
import { applicationInput, approveScheduling, createStore, currentAction, jobInput, MANAGER } from "./fixtures";
import { handleHubRequest } from "../../lib/hub/http";
import type { InterviewProgress } from "../../lib/hub/interview-progress";

test("the applicant filter, detail and interview history track delivery, booking and attendance for the latest round", async () => {
  const {store,database} = createStore();
  try {
    const job = await store.saveJob(jobInput());
    const {id} = await store.acceptApplication(applicationInput(job.id));
    await approveScheduling(store);
    async function check(expected: InterviewProgress) {
      const filter = {jobId:job.id,interviewProgress:expected};
      const list = await store.applications(filter);
      assert.equal(list.total,1);
      assert.deepEqual(list.items.map(item=>[item.id,item.interviewProgress]),[[id,expected]]);
      const detail=await store.getApplication(id);
      assert.equal(detail.interviewProgress,expected);
      if(expected !== "none")assert.equal(detail.interview?.interviewProgress,expected);
      assert.deepEqual(await store.exportIds(filter),[id]);
    }
    await check("none");
    await currentAction(store,id,{action:"interview"},MANAGER);
    await check("delivery_pending");
    const interview=await store.latestInterview(id);
    const invite=(await store.tasks()).find(t=>t.id.includes(`:interview:${interview!.id}:invitation:`))!;
    await store.stmt("UPDATE hub_communications SET status='failed' WHERE task_id=?",invite.id).run();
    await check("failed");
    await store.stmt("UPDATE hub_communications SET status='uncertain' WHERE task_id=?",invite.id).run();
    await check("unverified");
    await store.stmt("UPDATE hub_communications SET status='sent' WHERE task_id=?",invite.id).run();
    await check("requested");
    assert.equal((await store.applications({interviewProgress:"awaiting_booking"})).total,1);
    await store.stmt("UPDATE hub_links SET expires_at=0 WHERE application_id=? AND kind='interview'",id).run();
    await check("link_inactive");
    assert.equal((await store.applications({interviewProgress:"awaiting_booking"})).total,0);
    assert.equal((await store.applications({interviewProgress:"needs_review"})).total,1);
    await store.stmt("UPDATE hub_interviews SET status='pending',start='2090-01-01T17:00:00Z',end='2090-01-01T17:30:00Z' WHERE id=?",interview!.id).run();
    await check("pending");
    await store.stmt("UPDATE hub_interviews SET status='booked',provider_id='calendar-event' WHERE id=?",interview!.id).run();
    await check("booked");
    await assert.rejects(currentAction(store,id,{action:"attendance",attended:true},MANAGER),{code:"interview_not_started"});
    await store.stmt("UPDATE hub_interviews SET start='2020-01-01T17:00:00Z',end='2020-01-01T17:30:00Z' WHERE id=?",interview!.id).run();
    await check("attendance_due");
    await currentAction(store,id,{action:"attendance",attended:false},MANAGER);
    await check("no_show");
    await currentAction(store,id,{action:"attendance",attended:true},MANAGER);
    await check("completed");
    await currentAction(store,id,{action:"interview"},MANAGER);
    await check("delivery_pending");
    assert.equal((await store.applications({interviewProgress:"completed"})).total,0);
    assert.deepEqual((await store.getApplication(id)).interviews?.map(i=>i.interviewProgress),["delivery_pending","completed"]);
    const response=await handleHubRequest(new Request("https://jobs.test/api/hub/applications?interviewProgress=other"),["applications"],MANAGER,store);
    assert.equal(response.status,422);
  } finally {
    database.close();
  }
});

test("schedule filters use the confirmed slot end and expose legacy applicants separately", async () => {
  const {store,database} = createStore();
  try {
    const job = await store.saveJob(jobInput());
    const add = async () => (await store.acceptApplication(applicationInput(job.id))).id;
    const ongoing = await add(), future = await add(), past = await add();
    const pending = await add(), missing = await add(), unrelated = await add();
    const now = Date.now();
    async function appointment(applicationId: string, status: string, from: number, to: number) {
      await store.stmt(`INSERT INTO hub_interviews(id,application_id,status,start,end,created_at,updated_at,provider_id)
        VALUES(?,?,?,?,?,?,?,?)`, crypto.randomUUID(), applicationId, status,
        new Date(now + from * 60000).toISOString(), new Date(now + to * 60000).toISOString(), now, now, status==='booked' ? crypto.randomUUID() : null).run();
    }
    await appointment(ongoing,'booked',-10,20);
    await appointment(future,'booked',60,90);
    await appointment(past,'booked',-120,-90);
    await appointment(pending,'pending',60,90);
    await store.stmt("UPDATE hub_interviews SET attended=1 WHERE application_id=?",ongoing).run();
    await store.stmt("UPDATE hub_applications SET stage='Interview' WHERE id=?",missing).run();

    for (const [filter,expected] of [
      ['upcoming',[ongoing,future]], ['past',[past]], ['needs_review',[missing]],
      ['pending',[pending]], ['attendance_due',[past]], ['awaiting_booking',[]],
    ] as const) {
      const applicants=await store.applications({jobId:job.id,interviewProgress:filter});
      assert.deepEqual(applicants.items.map(row=>row.id).sort(),[...expected].sort(),filter);
      const response=await handleHubRequest(new Request(`https://jobs.test/api/hub/interviews?progress=${filter}&jobId=${job.id}`),['interviews'],MANAGER,store);
      const {data}=await response.json() as {data:{items:{applicationId:string}[]}};
      assert.equal(response.status,200);
      assert.deepEqual(data.items.map(row=>row.applicationId),expected,filter);
    }
    assert.equal((await store.getApplication(missing)).interviewProgress,'unlinked');
    assert.equal((await store.getApplication(unrelated)).interviewProgress,'none');
    // Imported "booked" rows without an event cannot establish a calendar booking.
    await store.stmt("UPDATE hub_interviews SET provider_id=NULL WHERE status='booked'").run();
    assert.equal((await store.applications({interviewProgress:'needs_review'})).total,4);
    assert.equal((await store.applications({interviewProgress:'upcoming'})).total,0);
    assert.equal((await store.getApplication(ongoing)).interviewProgress,'completed');
    assert.equal((await store.getApplication(future)).interviewProgress,'unlinked');
    await store.stmt("UPDATE hub_interviews SET provider_id=id WHERE status='booked'").run();
    // Interview history keeps the past first round after the next round is booked.
    await appointment(past,'booked',180,210);
    await store.stmt("UPDATE hub_interviews SET created_at=? WHERE application_id=? AND start>?",now+1,past,new Date(now).toISOString()).run();
    assert.equal((await store.applications({interviewProgress:'past'})).total,0);
    const oldSessions=await handleHubRequest(new Request('https://jobs.test/api/hub/interviews?progress=past'),['interviews'],MANAGER,store);
    assert.equal(((await oldSessions.json()) as {data:{total:number}}).data.total,1);
  } finally {
    database.close();
  }
});

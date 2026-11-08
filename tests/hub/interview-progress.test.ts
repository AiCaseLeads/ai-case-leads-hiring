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
    await store.stmt("UPDATE hub_interviews SET status='pending',start='2090-01-01T17:00:00Z',end='2090-01-01T17:30:00Z' WHERE id=?",interview!.id).run();
    await check("pending");
    await store.stmt("UPDATE hub_interviews SET status='booked' WHERE id=?",interview!.id).run();
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

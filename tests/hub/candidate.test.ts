import assert from "node:assert/strict";
import { test } from "node:test";
import { handleCandidateRequest } from "../../lib/hub/candidate";
import { sha256 } from "../../lib/hiring/crypto";
import {
  createStore,
  MANAGER,
  applicationInput,
  jobInput,
  approveScheduling,
  currentAction,
  addReviewedNote,
} from "./fixtures";
const req = (token: string, body?: unknown) =>
  new Request(
    `https://jobs.example.invalid/api/candidate/${token}`,
    body
      ? {
          method: "POST",
          headers: {
            Origin: "https://jobs.example.invalid",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      : {},
  );
async function invitation(
  store: ReturnType<typeof createStore>["store"],
  id: string,
  kind: "assessment" | "interview",
) {
  await currentAction(store, id, { action: kind }, MANAGER);
  const mail = (await store.tasks()).find(
    (task) => task.kind === "gmail" && task.id.includes(`:${kind}:`),
  )!;
  const token = String(mail.payload.body).match(
    new RegExp(`/${kind}/([a-f0-9]{64})`),
  )![1];
  return token;
}
const calendar = { busy: async () => [] };
test("stored bookings stay visible and cancellable when Calendar availability fails", async () => {
  const {store,database} = createStore();
  try {
    const posting = await store.saveJob(jobInput()), {id} = await store.acceptApplication(applicationInput(posting.id));
    await approveScheduling(store);
    const token = await invitation(store,id,"interview");
    const {data} = await (await handleCandidateRequest(req(token),token,store,calendar)).json() as {data:{slots:{start:string}[]}};
    assert.equal((await handleCandidateRequest(req(token,{action:"book",start:data.slots[0].start,timeZone:"UTC"}),token,store,calendar)).status,202);
    database.prepare("UPDATE hub_tasks SET status='done' WHERE kind<>'calendar'").run();
    const task = await store.claimTask(Date.now());
    await store.finishTask(task!.id,task!.leaseToken!,{status:"done",result:{id:"synthetic-event",meetUrl:"https://meet.google.com/synthetic-booking"}});
    const outage = {busy:async()=>{throw Error("Synthetic outage");}};
    const response = await handleCandidateRequest(req(token),token,store,outage);
    assert.equal(response.status,200);
    const body = await response.json() as {data:{status:string;interview:{start:string;meetUrl:string};slots:unknown[];availabilityError:string}};
    assert.equal(body.data.status,"booked"); assert.equal(body.data.interview.start,data.slots[0].start);
    assert.equal(body.data.interview.meetUrl,"https://meet.google.com/synthetic-booking");
    assert.equal(body.data.slots.length,0); assert.ok(body.data.availabilityError);
    assert.equal((await handleCandidateRequest(req(token,{action:"cancel"}),token,store,outage)).status,202);
  } finally {database.close();}
});

test("rescheduling keeps the original Calendar destination and extends the private link through the booking", async () => {
  const {store,database} = createStore();
  try {
    const posting = await store.saveJob(jobInput()), {id} = await store.acceptApplication(applicationInput(posting.id));
    await approveScheduling(store);
    const token = await invitation(store,id,"interview");
    const {data} = await (await handleCandidateRequest(req(token),token,store,calendar)).json() as {data:{slots:{start:string;end:string}[]}};
    const first = data.slots[0];
    database.prepare("UPDATE hub_links SET expires_at=?").run(Date.now()+3600000);
    await handleCandidateRequest(req(token,{action:"book",start:first.start,timeZone:"UTC"}),token,store,calendar);
    const link = database.prepare("SELECT expires_at FROM hub_links").get()!;
    assert.ok(Number(link.expires_at)>=Date.parse(first.end)+86400000);
    const booked = await store.latestInterview(id);
    database.prepare("UPDATE hub_interviews SET status='booked',provider_id='synthetic-event' WHERE id=?").run(booked!.id);
    database.prepare("INSERT INTO hub_settings(key,value,updated_at) VALUES ('google_calendar_id','\"changed@example.invalid\"',0) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    let checked: string[]|undefined;
    const response = await handleCandidateRequest(req(token,{action:"reschedule",start:data.slots[1].start,timeZone:"UTC"}),token,store,{busy:async(input)=>{checked=input.calendarIds;return[];}});
    assert.equal(response.status,202); assert.deepEqual(checked,["synthetic@example.invalid"]);
    const current = await store.latestInterview(id);
    assert.equal(current!.calendar_id,"synthetic@example.invalid");
    const task = (await store.tasks()).find((item)=>item.kind==="calendar" && item.payload.revision===current!.revision)!;
    assert.equal(task.payload.calendarId,"synthetic@example.invalid");
  } finally {database.close();}
});
test("assessment invitations keep token hashes, reveal only own prompt, and accept one private answer", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(posting.id));
  const token = await invitation(store, id, "assessment");
  const row = database
    .prepare("SELECT token_hash,payload_json FROM hub_links")
    .get();
  assert.equal(row!.token_hash, await sha256(token));
  assert.ok(!String(row!.payload_json).includes(token));
  const response = await handleCandidateRequest(req(token), token, store);
  const body = (await response.json()) as {
    data: { jobTitle: string; prompt: string; email?: string };
  };
  assert.equal(body.data.jobTitle, posting.title);
  assert.ok(body.data.prompt);
  assert.equal(body.data.email, undefined);
  assert.equal(
    (
      await handleCandidateRequest(
        req(token, { action: "assessment", answer: "Synthetic work sample" }),
        token,
        store,
      )
    ).status,
    200,
  );
  assert.equal(
    (await store.getApplication(id)).assessment!.status,
    "submitted",
  );
  assert.equal(
    (
      await handleCandidateRequest(
        req(token, { action: "assessment", answer: "Synthetic work sample" }),
        token,
        store,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await handleCandidateRequest(
        req(token, { action: "assessment", answer: "Changed answer" }),
        token,
        store,
      )
    ).status,
    409,
  );
  assert.equal(
    (await store.getApplication(id)).history.filter(
      (h) => h.type === "assessment" && h.actor === "candidate",
    ).length,
    1,
  );
  database.close();
});
test("expired/revoked invitations and wrong-kind actions cannot access or change candidate records", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(posting.id));
  const token = await invitation(store, id, "assessment");
  assert.equal(
    (
      await handleCandidateRequest(
        req(token, {
          action: "book",
          start: new Date(Date.now() + 86400000).toISOString(),
          timeZone: "UTC",
        }),
        token,
        store,
        calendar,
      )
    ).status,
    404,
  );
  database.prepare("UPDATE hub_links SET expires_at=0").run();
  assert.equal(
    (await handleCandidateRequest(req(token), token, store)).status,
    404,
  );
  assert.equal(
    (await handleCandidateRequest(req("a".repeat(64)), "a".repeat(64), store))
      .status,
    404,
  );
  database.close();
});
test("interview invitations and availability require explicit policy and a live calendar availability hook", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(posting.id));
  await assert.rejects(currentAction(store, id, { action: "interview" }, MANAGER), {
    code: "scheduling_not_configured",
  });
  await approveScheduling(store);
  const token = await invitation(store, id, "interview");
  assert.equal(
    (await handleCandidateRequest(req(token), token, store)).status,
    503,
  );
  const result = await handleCandidateRequest(
    req(token),
    token,
    store,
    calendar,
  );
  assert.equal(result.status, 200);
  const data = (await result.json()) as {
    data: { slots: { start: string; end: string }[] };
  };
  assert.ok(data.data.slots.length);
  database.close();
});
test("two candidates cannot reserve one time; booking is pending until Calendar effect confirms it", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const app1 = await store.acceptApplication(applicationInput(posting.id)),
    app2 = await store.acceptApplication(applicationInput(posting.id));
  await approveScheduling(store);
  const token1 = await invitation(store, app1.id, "interview"),
    token2 = await invitation(store, app2.id, "interview");
  const response = await handleCandidateRequest(
    req(token1),
    token1,
    store,
    calendar,
  );
  const { data } = (await response.json()) as {
    data: { slots: { start: string; end: string }[] };
  };
  const start = data.slots[0].start;
  const results = await Promise.all([
    handleCandidateRequest(
      req(token1, { action: "book", start, timeZone: "UTC" }),
      token1,
      store,
      calendar,
    ),
    handleCandidateRequest(
      req(token2, { action: "book", start, timeZone: "UTC" }),
      token2,
      store,
      calendar,
    ),
  ]);
  assert.equal(results.filter((r) => r.status === 202).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 1);
  const winningApp = results[0].status === 202 ? app1.id : app2.id;
  assert.equal(
    (await store.getApplication(winningApp)).interview!.status,
    "pending",
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM hub_reservations").get()!.n,
    1,
  );
  database
    .prepare("UPDATE hub_tasks SET status='done' WHERE kind<>'calendar'")
    .run();
  const claimed = await store.claimTask(Date.now());
  assert.equal(claimed!.kind, "calendar");
  await store.finishTask(claimed!.id, claimed!.leaseToken!, {
    status: "done",
    result: {
      id: "synthetic-event",
      meetUrl: "https://meet.google.com/test-fixture",
    },
  });
  assert.equal(
    (await store.getApplication(winningApp)).interview!.status,
    "booked",
  );
  assert.equal(
    (await store.getApplication(winningApp)).interview!.meetUrl,
    "https://meet.google.com/test-fixture",
  );
  database.close();
});
test("calendar uncertainty keeps the reservation protected; stale completions cannot replace newer state", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(posting.id));
  await approveScheduling(store);
  const token = await invitation(store, id, "interview");
  const { data } = (await (
    await handleCandidateRequest(req(token), token, store, calendar)
  ).json()) as { data: { slots: { start: string }[] } };
  await handleCandidateRequest(
    req(token, { action: "book", start: data.slots[0].start, timeZone: "UTC" }),
    token,
    store,
    calendar,
  );
  database
    .prepare("UPDATE hub_tasks SET status='done' WHERE kind<>'calendar'")
    .run();
  const claimed = await store.claimTask(Date.now());
  await store.finishTask(claimed!.id, claimed!.leaseToken!, {
    status: "uncertain",
    error: "Synthetic unknown outcome",
    runAfter: Date.now() + 60000,
  });
  assert.equal((await store.getApplication(id)).interview!.status, "pending");
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM hub_reservations").get()!.n,
    1,
  );
  assert.equal(
    (
      await handleCandidateRequest(
        req(token, { action: "cancel" }),
        token,
        store,
        calendar,
      )
    ).status,
    409,
  );
  database
    .prepare("UPDATE hub_tasks SET run_after=0 WHERE kind='calendar'")
    .run();
  const retry = await store.claimTask(Date.now());
  await store.finishTask(retry!.id, retry!.leaseToken!, {
    status: "done",
    result: { stale: true },
  });
  assert.equal((await store.getApplication(id)).interview!.status, "pending");
  database.close();
});

test("withdrawal during live availability lookup cannot commit a candidate booking", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(posting.id));
  await approveScheduling(store);
  const token = await invitation(store, id, "interview");
  const { data } = (await (
    await handleCandidateRequest(req(token), token, store, calendar)
  ).json()) as { data: { slots: { start: string }[] } };
  const race = {
    busy: async () => {
      await currentAction(store, id, { action: "stage", stage: "Withdrawn" }, MANAGER);
      return [];
    },
  };
  const response = await handleCandidateRequest(
    req(token, { action: "book", start: data.slots[0].start, timeZone: "UTC" }),
    token,
    store,
    race,
  );
  assert.equal(response.status, 409);
  assert.equal((await store.getApplication(id)).stage, "Withdrawn");
  assert.equal((await store.getApplication(id)).interview!.status, "invited");
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM hub_reservations").get()!.n,
    0,
  );
  assert.equal(
    database
      .prepare("SELECT COUNT(*) AS n FROM hub_tasks WHERE kind='calendar'")
      .get()!.n,
    0,
  );
  assert.equal(
    (await handleCandidateRequest(req(token), token, store, calendar)).status,
    404,
  );
  database.close();
});
test("rejecting a pending future interview revokes invitations and cancels only after Calendar confirms", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(posting.id));
  await approveScheduling(store);
  const assessmentToken = await invitation(store, id, "assessment"),
    token = await invitation(store, id, "interview");
  const { data } = (await (
    await handleCandidateRequest(req(token), token, store, calendar)
  ).json()) as { data: { slots: { start: string }[] } };
  await handleCandidateRequest(
    req(token, { action: "book", start: data.slots[0].start, timeZone: "UTC" }),
    token,
    store,
    calendar,
  );
  await currentAction(store,
    id,
    { action: "reject", reason: "Recorded hiring decision" },
    MANAGER,
  );
  const detail = await store.getApplication(id);
  assert.equal(detail.interview!.status, "cancel_pending");
  assert.equal(
    detail.communications.filter((c) => c.status === "cancelled").length,
    2,
  );
  assert.equal(
    detail.communications.find(
      (c) => c.subject === `Application received: ${posting.title}`,
    )?.status,
    "pending",
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM hub_reservations").get()!.n,
    1,
  );
  assert.equal(
    (await handleCandidateRequest(req(token), token, store, calendar)).status,
    404,
  );
  assert.equal(
    (await handleCandidateRequest(req(assessmentToken), assessmentToken, store))
      .status,
    404,
  );
  database
    .prepare("UPDATE hub_tasks SET status='done' WHERE kind<>'calendar'")
    .run();
  const previous = await store.claimTask(Date.now());
  assert.equal(previous!.payload.operation, "create");
  await store.finishTask(previous!.id, previous!.leaseToken!, {
    status: "done",
    result: { stale: true },
  });
  assert.equal(
    (await store.getApplication(id)).interview!.status,
    "cancel_pending",
  );
  const cancel = await store.claimTask(Date.now());
  assert.equal(cancel!.payload.operation, "cancel");
  await store.finishTask(cancel!.id, cancel!.leaseToken!, {
    status: "done",
    result: { cancelled: true },
  });
  assert.equal((await store.getApplication(id)).interview!.status, "cancelled");
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM hub_reservations").get()!.n,
    0,
  );
  database.close();
});
test("concurrent staff rejection fences candidate cancellation and assessment transactions", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(posting.id));
  await approveScheduling(store);
  const token = await invitation(store, id, "interview");
  const { data } = (await (
    await handleCandidateRequest(req(token), token, store, calendar)
  ).json()) as { data: { slots: { start: string }[] } };
  await handleCandidateRequest(
    req(token, { action: "book", start: data.slots[0].start, timeZone: "UTC" }),
    token,
    store,
    calendar,
  );
  database
    .prepare("UPDATE hub_tasks SET status='done' WHERE kind<>'calendar'")
    .run();
  const create = await store.claimTask(Date.now());
  await store.finishTask(create!.id, create!.leaseToken!, {
    status: "done",
    result: { id: "synthetic-event" },
  });
  const originalBatch = store.db.batch.bind(store.db);
  store.db.batch = async (statements) => {
    store.db.batch = originalBatch;
    await currentAction(store,
      id,
      { action: "reject", reason: "Concurrent decision" },
      MANAGER,
    );
    return originalBatch(statements);
  };
  assert.equal(
    (
      await handleCandidateRequest(
        req(token, { action: "cancel" }),
        token,
        store,
        calendar,
      )
    ).status,
    409,
  );
  assert.equal((await store.getApplication(id)).stage, "Rejected");
  assert.equal(
    (await store.getApplication(id)).interview!.status,
    "cancel_pending",
  );
  assert.equal(
    database
      .prepare(
        "SELECT COUNT(*) AS n FROM hub_tasks WHERE kind='calendar' AND json_extract(payload_json,'$.operation')='cancel'",
      )
      .get()!.n,
    1,
  );
  const second = await store.acceptApplication(applicationInput(posting.id)),
    assessment = await invitation(store, second.id, "assessment");
  store.db.batch = async (statements) => {
    store.db.batch = originalBatch;
    await currentAction(store,
      second.id,
      { action: "stage", stage: "Withdrawn" },
      MANAGER,
    );
    return originalBatch(statements);
  };
  assert.equal(
    (
      await handleCandidateRequest(
        req(assessment, { action: "assessment", answer: "A late response" }),
        assessment,
        store,
      )
    ).status,
    409,
  );
  assert.equal(
    (await store.getApplication(second.id)).assessment!.status,
    "invited",
  );
  assert.equal(
    (await store.getApplication(second.id)).history.filter(
      (h) => h.actor === "candidate" && h.type === "assessment",
    ).length,
    0,
  );
  database.close();
});

test("hiring an applicant also resolves future pending interview reservations through cancellation", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(posting.id));
  await approveScheduling(store);
  const token = await invitation(store, id, "interview");
  const { data } = (await (
    await handleCandidateRequest(req(token), token, store, calendar)
  ).json()) as { data: { slots: { start: string }[] } };
  await handleCandidateRequest(
    req(token, { action: "book", start: data.slots[0].start, timeZone: "UTC" }),
    token,
    store,
    calendar,
  );
  await addReviewedNote(store,id);
  await currentAction(store, id, { action: "stage", stage: "Hired" }, MANAGER);
  assert.equal(
    (await store.getApplication(id)).interview!.status,
    "cancel_pending",
  );
  assert.equal(
    database
      .prepare(
        "SELECT COUNT(*) AS n FROM hub_tasks WHERE kind='calendar' AND json_extract(payload_json,'$.operation')='cancel'",
      )
      .get()!.n,
    1,
  );
  database.close();
});

import { currentAction, currentSettings } from "./fixtures";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createStore,
  applicationInput,
  jobInput,
  MANAGER,
  approveScheduling,
} from "./fixtures";

test("outbox claims use atomic leases and only one concurrent worker receives an application task", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  await store.acceptApplication(applicationInput(posting.id));
  const now = Date.now();
  const claims = await Promise.all(
    Array.from({ length: 20 }, () => store.claimTask(now)),
  );
  assert.equal(claims.filter(Boolean).length, 1);
  const winner = claims.find(Boolean)!;
  assert.ok(winner.leaseToken);
  assert.ok(winner.leaseUntil! >= now + 600000);
  await assert.rejects(
    store.finishTask(winner.id, "wrong-lease", { status: "done" }),
    { code: "task_lease_lost" },
  );
  await store.finishTask(winner.id, winner.leaseToken!, {
    status: "done",
    result: {
      folderId: "fixture-folder",
      folderUrl: "https://drive.google.com/drive/folders/fixture-folder",
    },
  });
  assert.ok(await store.claimTask(Date.now()));
  database.close();
});
test("expired Gmail leases become uncertain and never resend; staff cannot blindly retry uncertain delivery", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(posting.id));
  database
    .prepare("UPDATE hub_tasks SET status='done' WHERE kind='drive'")
    .run();
  const mail = await store.claimTask(Date.now());
  assert.equal(mail!.kind, "gmail");
  database
    .prepare("UPDATE hub_tasks SET lease_until=? WHERE id=?")
    .run(Date.now() - 1, mail!.id);
  assert.equal(await store.claimTask(Date.now()), null);
  assert.equal(
    (await store.tasks()).find((t) => t.id === mail!.id)!.status,
    "uncertain",
  );
  assert.equal(
    (await store.getApplication(id)).communications[0].status,
    "uncertain",
  );
  await assert.rejects(store.retryTask(mail!.id), { code: "task_uncertain" });
  database.close();
});
test("finishTask saves delivered email identifiers and a Drive folder in the same committed task result", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(posting.id));
  const first = await store.claimTask(Date.now());
  assert.equal(first!.kind, "drive");
  await store.finishTask(first!.id, first!.leaseToken!, {
    status: "done",
    result: {
      folderId: "folder",
      folderUrl: "https://drive.google.com/drive/folders/folder",
    },
  });
  assert.equal(
    (await store.getApplication(id)).driveFolderUrl,
    "https://drive.google.com/drive/folders/folder",
  );
  const mail = await store.claimTask(Date.now());
  await store.finishTask(mail!.id, mail!.leaseToken!, {
    status: "done",
    result: { id: "synthetic-message", threadId: "synthetic-thread" },
  });
  assert.equal(
    (await store.getApplication(id)).communications[0].status,
    "sent",
  );
  const row = database
    .prepare("SELECT provider_id,thread_id FROM hub_communications")
    .get();
  assert.equal(row!.provider_id, "synthetic-message");
  assert.equal(row!.thread_id, "synthetic-thread");
  await assert.rejects(
    store.finishTask(mail!.id, mail!.leaseToken!, { status: "done" }),
    { code: "task_lease_lost" },
  );
  database.close();
});
test("known failed tasks retry within the bounded attempt policy", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  await store.acceptApplication(applicationInput(posting.id));
  database
    .prepare("UPDATE hub_tasks SET status='done' WHERE kind='gmail'")
    .run();
  const pending = await store.claimTask(Date.now());
  await store.finishTask(pending!.id, pending!.leaseToken!, {
    status: "failed",
    error: "Synthetic temporary outage",
    runAfter: Date.now() + 60000,
  });
  assert.equal(await store.claimTask(Date.now()), null);
  database
    .prepare("UPDATE hub_tasks SET run_after=0 WHERE id=?")
    .run(pending!.id);
  const retry = await store.claimTask(Date.now());
  assert.equal(retry!.id, pending!.id);
  assert.equal(retry!.attempts, 2);
  assert.notEqual(retry!.leaseToken, pending!.leaseToken);
  await store.finishTask(retry!.id, retry!.leaseToken!, {
    status: "failed",
    error: "Still unavailable",
  });
  database.prepare("UPDATE hub_tasks SET attempts=8 WHERE id=?").run(retry!.id);
  assert.equal(await store.claimTask(Date.now()), null);
  await store.retryTask(retry!.id);
  assert.equal(
    (await store.tasks()).find((t) => t.id === retry!.id)!.attempts,
    0,
  );
  database.close();
});

test("concurrent conflicting task completions commit exactly one result and its application effect", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(posting.id));
  const claimed = await store.claimTask(Date.now());
  assert.equal(claimed!.kind, "drive");
  const finishes = await Promise.allSettled([
    store.finishTask(claimed!.id, claimed!.leaseToken!, {
      status: "done",
      result: {
        folderId: "first",
        folderUrl: "https://drive.google.com/drive/folders/first",
      },
    }),
    store.finishTask(claimed!.id, claimed!.leaseToken!, {
      status: "done",
      result: {
        folderId: "second",
        folderUrl: "https://drive.google.com/drive/folders/second",
      },
    }),
  ]);
  assert.equal(finishes.filter((f) => f.status === "fulfilled").length, 1);
  assert.equal(finishes.filter((f) => f.status === "rejected").length, 1);
  const saved = (await store.tasks()).find((t) => t.id === claimed!.id)!;
  assert.equal(
    (await store.getApplication(id)).driveFolderUrl,
    saved.result!.folderUrl,
  );
  database.close();
});
test("stale invitation mail completions record cancellation instead of delivery", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(posting.id));
  database
    .prepare("UPDATE hub_tasks SET status='done' WHERE kind='drive'")
    .run();
  const task = await store.claimTask(Date.now());
  await store.finishTask(task!.id, task!.leaseToken!, {
    status: "done",
    result: { stale: true },
  });
  assert.equal(
    (await store.getApplication(id)).communications[0].status,
    "cancelled",
  );
  const row = database
    .prepare("SELECT provider_id,thread_id FROM hub_communications")
    .get();
  assert.equal(row!.provider_id, null);
  assert.equal(row!.thread_id, null);
  database.close();
});

test("old failed and uncertain tasks remain visible and all failure pages are reachable", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(posting.id));
  database.prepare("UPDATE hub_tasks SET status='done'").run();
  await store.db.batch(
    Array.from({ length: 400 }, (_, index) =>
      store.taskStatement(
        `done:${index}`,
        id,
        "drive",
        { applicationId: id },
        1000 + index,
      ),
    ),
  );
  database.prepare("UPDATE hub_tasks SET status='done'").run();
  await store.db.batch([
    store.taskStatement("old-failed", id, "drive", { applicationId: id }, 1),
    store.taskStatement("old-uncertain", id, "gmail", { applicationId: id }, 2),
  ]);
  database
    .prepare("UPDATE hub_tasks SET status='failed' WHERE id='old-failed'")
    .run();
  database
    .prepare("UPDATE hub_tasks SET status='uncertain' WHERE id='old-uncertain'")
    .run();
  const first = await store.tasks();
  assert.equal(first[0].id, "old-failed");
  assert.equal(first[1].id, "old-uncertain");
  await store.db.batch(
    Array.from({ length: 250 }, (_, index) =>
      store.taskStatement(
        `failure:${index}`,
        id,
        "drive",
        { applicationId: id },
        500 + index,
      ),
    ),
  );
  database
    .prepare("UPDATE hub_tasks SET status='failed' WHERE id LIKE 'failure:%'")
    .run();
  const page1 = await store.tasks(1),
    page2 = await store.tasks(2);
  assert.equal(page1.length, 200);
  assert.equal(
    page1.filter((t) => t.status === "failed" || t.status === "uncertain")
      .length,
    200,
  );
  assert.equal(
    page2.filter((t) => t.status === "failed" || t.status === "uncertain")
      .length,
    52,
  );
  assert.equal(
    new Set(
      [...page1, ...page2]
        .filter((t) => t.status === "failed" || t.status === "uncertain")
        .map((t) => t.id),
    ).size,
    252,
  );
  database.close();
});

async function calendarFixture(hours = 24) {
  const fixture = createStore(),
    { store, database } = fixture;
  const posting = await store.saveJob(jobInput()),
    { id } = await store.acceptApplication(applicationInput(posting.id));
  await approveScheduling(store);
  await currentAction(store, id, { action: "interview" }, MANAGER);
  database.prepare("UPDATE hub_tasks SET status='done'").run();
  const interview = (await store.latestInterview(id))!,
    start = new Date(Date.now() + hours * 3600000).toISOString(),
    end = new Date(Date.now() + hours * 3600000 + 1800000).toISOString(),
    key = `synthetic@example.invalid:${start}`;
  database
    .prepare(
      "UPDATE hub_interviews SET status='pending',start=?,end=?,revision=2,reservation_key=? WHERE id=?",
    )
    .run(start, end, key, interview.id);
  database
    .prepare(
      "INSERT INTO hub_reservations (key,interview_id,calendar_id,start,end,created_at) VALUES (?,?,?,?,?,?)",
    )
    .run(
      key,
      interview.id,
      "synthetic@example.invalid",
      start,
      end,
      Date.now(),
    );
  const taskId = `calendar:${interview.id}:revision:2`,
    payload = {
      operation: "create",
      interviewId: interview.id,
      id: interview.id,
      title: posting.title,
      email: "synthetic@example.invalid",
      start,
      end,
      timeZone: "UTC",
      revision: 2,
    };
  await store.taskStatement(taskId, id, "calendar", payload, Date.now()).run();
  return {
    ...fixture,
    applicationId: id,
    interviewId: interview.id,
    taskId,
    payload,
  };
}
test("exhausted expired Drive leases park as failed and permit a fresh explicit recovery budget", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  await store.acceptApplication(applicationInput(posting.id));
  database
    .prepare("UPDATE hub_tasks SET status='done' WHERE kind='gmail'")
    .run();
  const original = await store.claimTask(Date.now());
  database
    .prepare("UPDATE hub_tasks SET attempts=8,lease_until=? WHERE id=?")
    .run(Date.now() - 1, original!.id);
  assert.equal(await store.claimTask(Date.now()), null);
  const exhausted = (await store.tasks()).find((t) => t.id === original!.id)!;
  assert.equal(exhausted.status, "failed");
  assert.match(exhausted.lastError!, /lease expired.*retry limit/);
  assert.equal(exhausted.leaseUntil, null);
  await assert.rejects(
    store.finishTask(original!.id, original!.leaseToken!, { status: "done" }),
    { code: "task_lease_lost" },
  );
  await store.retryTask(original!.id);
  const recovered = await store.claimTask(Date.now());
  assert.equal(recovered!.id, original!.id);
  assert.equal(recovered!.attempts, 1);
  database.close();
});
test("exhausted expired Calendar leases preserve the reservation and recover the same event identity", async () => {
  const { store, database, applicationId, taskId, payload } =
    await calendarFixture();
  const original = await store.claimTask(Date.now());
  assert.equal(original!.id, taskId);
  database
    .prepare("UPDATE hub_tasks SET attempts=8,lease_until=? WHERE id=?")
    .run(Date.now() - 1, taskId);
  assert.equal(await store.claimTask(Date.now()), null);
  assert.equal(
    (await store.tasks()).find((t) => t.id === taskId)!.status,
    "failed",
  );
  assert.equal(
    (await store.getApplication(applicationId)).interview!.status,
    "pending",
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM hub_reservations").get()!.n,
    1,
  );
  await store.retryTask(taskId);
  const recovered = await store.claimTask(Date.now());
  assert.equal(recovered!.id, taskId);
  assert.deepEqual(recovered!.payload, payload);
  assert.equal(recovered!.attempts, 1);
  await store.finishTask(taskId, recovered!.leaseToken!, {
    status: "done",
    result: {
      id: "same-stable-provider-id",
      meetUrl: "https://meet.google.com/synthetic-test",
    },
  });
  assert.equal(
    (await store.getApplication(applicationId)).interview!.status,
    "booked",
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM hub_interviews").get()!.n,
    1,
  );
  database.close();
});
test("exhausted uncertain Calendar tasks can reconcile the same mutation while uncertain Gmail stays search-only", async () => {
  const { store, database, applicationId, taskId, payload } =
    await calendarFixture();
  database.prepare("UPDATE hub_tasks SET attempts=7 WHERE id=?").run(taskId);
  const original = await store.claimTask(Date.now());
  assert.equal(original!.attempts, 8);
  await store.finishTask(taskId, original!.leaseToken!, {
    status: "uncertain",
    error: "Unknown Calendar outcome",
  });
  const archive = await store.claimTask(Date.now());
  assert.equal(archive!.kind, "drive");
  await store.finishTask(archive!.id, archive!.leaseToken!, {
    status: "done",
    result: {
      folderId: "fixture-folder",
      folderUrl: "https://drive.google.com/drive/folders/fixture-folder",
    },
  });
  assert.equal(await store.claimTask(Date.now()), null);
  const recovered = await store.retryTask(taskId);
  assert.equal(recovered.status, "pending");
  assert.equal(recovered.attempts, 0);
  assert.deepEqual(recovered.payload, payload);
  assert.equal(
    (await store.getApplication(applicationId)).interview!.status,
    "pending",
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM hub_reservations").get()!.n,
    1,
  );
  database
    .prepare(
      "UPDATE hub_tasks SET status='uncertain',attempts=8 WHERE kind='gmail'",
    )
    .run();
  const gmail = (await store.tasks()).find((t) => t.kind === "gmail")!;
  await assert.rejects(store.retryTask(gmail.id), { code: "task_uncertain" });
  database.close();
});
test("a retry racing with uncertain delivery rolls back before changing communication state", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(posting.id));
  database
    .prepare("UPDATE hub_tasks SET status='failed' WHERE kind='gmail'")
    .run();
  database.prepare("UPDATE hub_communications SET status='failed'").run();
  const mail = (await store.tasks()).find((t) => t.kind === "gmail")!;
  const originalBatch = store.db.batch.bind(store.db);
  store.db.batch = async (statements) => {
    store.db.batch = originalBatch;
    database
      .prepare("UPDATE hub_tasks SET status='uncertain' WHERE id=?")
      .run(mail.id);
    database
      .prepare(
        "UPDATE hub_communications SET status='uncertain' WHERE task_id=?",
      )
      .run(mail.id);
    return originalBatch(statements);
  };
  await assert.rejects(store.retryTask(mail.id), { code: "task_changed" });
  assert.equal(
    (await store.tasks()).find((t) => t.id === mail.id)!.status,
    "uncertain",
  );
  assert.equal(
    (await store.getApplication(id)).communications[0].status,
    "uncertain",
  );
  database.close();
});
test("Calendar recovery is fenced against a superseding interview revision", async () => {
  const { store, database, interviewId, taskId } = await calendarFixture();
  database
    .prepare("UPDATE hub_tasks SET status='uncertain',attempts=8 WHERE id=?")
    .run(taskId);
  const originalBatch = store.db.batch.bind(store.db);
  store.db.batch = async (statements) => {
    store.db.batch = originalBatch;
    database
      .prepare(
        "UPDATE hub_interviews SET revision=revision+1,status='cancel_pending' WHERE id=?",
      )
      .run(interviewId);
    return originalBatch(statements);
  };
  await assert.rejects(store.retryTask(taskId), { code: "task_changed" });
  const current = (await store.tasks()).find((t) => t.id === taskId)!;
  assert.equal(current.status, "uncertain");
  assert.equal(current.attempts, 8);
  assert.equal(
    database
      .prepare("SELECT status,revision FROM hub_interviews WHERE id=?")
      .get(interviewId)!.status,
    "cancel_pending",
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM hub_reservations").get()!.n,
    1,
  );
  database.close();
});

test("Gmail delivery after initial archival atomically versions and queues a fresh snapshot without a Drive loop", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(posting.id));
  const initial = await store.getApplication(id),
    drive = await store.claimTask(Date.now());
  assert.equal(drive!.kind, "drive");
  await store.finishTask(drive!.id, drive!.leaseToken!, {
    status: "done",
    result: {
      folderId: "fixture-folder",
      folderUrl: "https://drive.google.com/drive/folders/fixture-folder",
    },
  });
  const afterDrive = await store.getApplication(id);
  assert.equal(afterDrive.revision, initial.revision);
  assert.equal(afterDrive.updatedAt, initial.updatedAt);
  assert.equal(
    database
      .prepare("SELECT COUNT(*) AS n FROM hub_tasks WHERE kind='drive'")
      .get()!.n,
    1,
  );
  const mail = await store.claimTask(Date.now());
  assert.equal(mail!.kind, "gmail");
  await store.finishTask(mail!.id, mail!.leaseToken!, {
    status: "done",
    result: { id: "sent-fixture-message", threadId: "sent-fixture-thread" },
  });
  const sent = await store.getApplication(id);
  assert.equal(sent.revision, initial.revision + 1);
  assert.equal(sent.communications[0].status, "sent");
  const snapshot = await store.claimTask(Date.now());
  assert.equal(snapshot!.id, `drive:${id}:effect:${sent.revision}`);
  assert.equal(snapshot!.kind, "drive");
  assert.deepEqual(snapshot!.payload, { applicationId: id });
  await store.finishTask(snapshot!.id, snapshot!.leaseToken!, {
    status: "done",
    result: {
      folderId: "fixture-folder",
      folderUrl: "https://drive.google.com/drive/folders/fixture-folder",
      archivedRevision: sent.revision,
    },
  });
  const archived = await store.getApplication(id);
  assert.equal(archived.revision, sent.revision);
  assert.equal(archived.updatedAt, sent.updatedAt);
  assert.equal(await store.claimTask(Date.now()), null);
  assert.equal(
    database
      .prepare("SELECT COUNT(*) AS n FROM hub_tasks WHERE kind='drive'")
      .get()!.n,
    2,
  );
  database.close();
});
test("Calendar booking and cancellation results each atomically queue their current revised snapshot", async () => {
  const { store, database, applicationId, taskId } = await calendarFixture();
  const initial = await store.getApplication(applicationId),
    create = await store.claimTask(Date.now());
  await store.finishTask(taskId, create!.leaseToken!, {
    status: "done",
    result: {
      id: "fixture-calendar-event",
      meetUrl: "https://meet.google.com/synthetic-test",
    },
  });
  const booked = await store.getApplication(applicationId);
  assert.equal(booked.revision, initial.revision + 1);
  assert.equal(booked.interview!.status, "booked");
  assert.ok(
    (await store.tasks()).some(
      (t) =>
        t.id === `drive:${applicationId}:effect:${booked.revision}` &&
        t.status === "pending",
    ),
  );
  await currentAction(store,
    applicationId,
    { action: "stage", stage: "Withdrawn" },
    MANAGER,
  );
  database
    .prepare("UPDATE hub_tasks SET status='done' WHERE kind='drive'")
    .run();
  const beforeCancel = await store.getApplication(applicationId),
    cancel = await store.claimTask(Date.now());
  assert.equal(cancel!.payload.operation, "cancel");
  await store.finishTask(cancel!.id, cancel!.leaseToken!, {
    status: "done",
    result: { cancelled: true },
  });
  const cancelled = await store.getApplication(applicationId);
  assert.equal(cancelled.revision, beforeCancel.revision + 1);
  assert.equal(cancelled.interview!.status, "cancelled");
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM hub_reservations").get()!.n,
    0,
  );
  assert.ok(
    (await store.tasks()).some(
      (t) =>
        t.id === `drive:${applicationId}:effect:${cancelled.revision}` &&
        t.status === "pending",
    ),
  );
  database.close();
});
test("losing same-millisecond Gmail completion cannot bump revision or queue another snapshot", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(posting.id));
  database
    .prepare("UPDATE hub_tasks SET status='done' WHERE kind='drive'")
    .run();
  const initial = await store.getApplication(id),
    mail = await store.claimTask(Date.now()),
    originalNow = Date.now,
    frozen = originalNow();
  Date.now = () => frozen;
  try {
    const attempts = await Promise.allSettled([
      store.finishTask(mail!.id, mail!.leaseToken!, {
        status: "done",
        result: { id: "winner-a", threadId: "thread-a" },
      }),
      store.finishTask(mail!.id, mail!.leaseToken!, {
        status: "done",
        result: { id: "winner-b", threadId: "thread-b" },
      }),
    ]);
    assert.equal(attempts.filter((a) => a.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((a) => a.status === "rejected").length, 1);
  } finally {
    Date.now = originalNow;
  }
  assert.equal((await store.getApplication(id)).revision, initial.revision + 1);
  assert.equal(
    database
      .prepare(
        "SELECT COUNT(*) AS n FROM hub_tasks WHERE kind='drive' AND id LIKE '%:effect:%'",
      )
      .get()!.n,
    1,
  );
  const saved = (await store.tasks()).find((t) => t.id === mail!.id)!;
  assert.equal(
    database
      .prepare("SELECT provider_id FROM hub_communications WHERE task_id=?")
      .get(mail!.id)!.provider_id,
    saved.result!.id,
  );
  database.close();
});
test("a failed provider-result archive insertion rolls back delivery and revision changes together", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(posting.id));
  database
    .prepare("UPDATE hub_tasks SET status='done' WHERE kind='drive'")
    .run();
  const initial = await store.getApplication(id),
    mail = await store.claimTask(Date.now());
  database.exec(
    "CREATE TRIGGER fixture_archive_failure BEFORE INSERT ON hub_tasks WHEN NEW.kind='drive' BEGIN SELECT RAISE(ABORT,'fixture_archive_failure'); END",
  );
  await assert.rejects(
    store.finishTask(mail!.id, mail!.leaseToken!, {
      status: "done",
      result: { id: "fixture-message", threadId: "fixture-thread" },
    }),
    { code: "task_lease_lost" },
  );
  const unchanged = await store.getApplication(id);
  assert.equal(unchanged.revision, initial.revision);
  assert.equal(unchanged.communications[0].status, "pending");
  assert.equal(
    (await store.tasks()).find((t) => t.id === mail!.id)!.status,
    "running",
  );
  assert.equal(
    database
      .prepare(
        "SELECT COUNT(*) AS n FROM hub_tasks WHERE kind='drive' AND id LIKE '%:effect:%'",
      )
      .get()!.n,
    0,
  );
  database.close();
});

test("reminders default on; an explicit opt-out suppresses confirmed booking reminders", async () => {
  const { store, database, taskId } = await calendarFixture(48);
  assert.equal((await store.settings()).scheduling.remindersEnabled, true);
  await currentSettings(store, { interviewRemindersEnabled: false }, MANAGER);
  assert.equal(
    (await store.tasks()).filter((t) => t.payload.reminder).length,
    0,
  );
  const booking = await store.claimTask(Date.now());
  await store.finishTask(taskId, booking!.leaseToken!, {
    status: "done",
    result: {
      id: "fixture-event",
      meetUrl: "https://meet.google.com/synthetic-test",
    },
  });
  assert.equal(
    (await store.tasks()).filter((t) => t.payload.reminder).length,
    0,
  );
  database.close();
});
test("explicitly enabled reminders queue at the three future offsets with the confirmed Meet link and interview revision", async () => {
  const { store, database, applicationId, interviewId, taskId, payload } =
    await calendarFixture(48);
  await currentSettings(store, { interviewRemindersEnabled: true }, MANAGER);
  assert.equal((await store.settings()).scheduling.remindersEnabled, true);
  assert.equal(
    (await store.tasks()).filter((t) => t.payload.reminder).length,
    0,
  );
  const booking = await store.claimTask(Date.now());
  await store.finishTask(taskId, booking!.leaseToken!, {
    status: "done",
    result: {
      id: "fixture-event",
      meetUrl: "https://meet.google.com/synthetic-test",
    },
  });
  const reminders = (await store.tasks()).filter((t) => t.payload.reminder);
  assert.equal(reminders.length, 3);
  for (const [hours, label] of [
    [24, "24h"],
    [1, "1h"],
    [1/12, "5m"],
  ] as const) {
    const reminder = reminders.find((t) => t.id.endsWith(`:${label}`))!;
    assert.equal(
      reminder.id,
      `gmail:${applicationId}:reminder:${interviewId}:2:${label}`,
    );
    assert.equal(
      reminder.runAfter,
      Date.parse(payload.start) - hours * 3600000,
    );
    assert.equal(reminder.payload.interviewId, interviewId);
    assert.equal(reminder.payload.revision, 2);
    assert.equal(reminder.payload.interviewStart, payload.start);
    assert.ok(
      String(reminder.payload.body).includes(
        "https://meet.google.com/synthetic-test",
      ),
    );
    assert.ok(String(reminder.payload.body).includes("UTC"));
    assert.ok(!String(reminder.payload.body).includes("/interview/"));
    assert.equal(reminder.status, "pending");
  }
  const archive = await store.claimTask(Date.now());
  assert.equal(archive!.kind, "drive");
  await store.finishTask(archive!.id, archive!.leaseToken!, { status: "done" });
  assert.equal(await store.claimTask(Date.now()), null);
  database.close();
});
test("late bookings schedule only remaining future reminder times", async () => {
  const first = await calendarFixture(2);
  await currentSettings(first.store, { interviewRemindersEnabled: true }, MANAGER);
  const booking = await first.store.claimTask(Date.now());
  await first.store.finishTask(first.taskId, booking!.leaseToken!, {
    status: "done",
    result: {
      id: "fixture-event",
      meetUrl: "https://meet.google.com/synthetic-test",
    },
  });
  const reminders = (await first.store.tasks()).filter(
    (t) => t.payload.reminder,
  );
  assert.deepEqual(reminders.map(t=>t.id.split(":").pop()).sort(), ["1h","5m"]);
  first.database.close();
  const second = await calendarFixture(0.5);
  await currentSettings(second.store, { interviewRemindersEnabled: true }, MANAGER);
  const late = await second.store.claimTask(Date.now());
  await second.store.finishTask(second.taskId, late!.leaseToken!, {
    status: "done",
    result: {
      id: "fixture-event",
      meetUrl: "https://meet.google.com/synthetic-test",
    },
  });
  assert.deepEqual(
    (await second.store.tasks()).filter((t) => t.payload.reminder).map(t=>t.id.split(":").pop()),
    ["5m"],
  );
  second.database.close();
});
test("conflicting Calendar completions create one set of reminders reflecting the winning result", async () => {
  const { store, database, taskId, applicationId } = await calendarFixture(48);
  await currentSettings(store, { interviewRemindersEnabled: true }, MANAGER);
  const initial = await store.getApplication(applicationId),
    booking = await store.claimTask(Date.now());
  const results = await Promise.allSettled([
    store.finishTask(taskId, booking!.leaseToken!, {
      status: "done",
      result: {
        id: "fixture-event",
        meetUrl: "https://meet.google.com/winner-a",
      },
    }),
    store.finishTask(taskId, booking!.leaseToken!, {
      status: "done",
      result: {
        id: "fixture-event",
        meetUrl: "https://meet.google.com/winner-b",
      },
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  const current = await store.getApplication(applicationId);
  assert.equal(current.revision, initial.revision + 1);
  const reminders = (await store.tasks()).filter((t) => t.payload.reminder);
  assert.equal(reminders.length, 3);
  assert.ok(
    reminders.every((t) =>
      String(t.payload.body).includes(current.interview!.meetUrl!),
    ),
  );
  database.close();
});
test("turning reminders off before the result commits atomically suppresses reminder tasks and communications", async () => {
  const { store, database, taskId, applicationId } = await calendarFixture(48);
  await currentSettings(store, { interviewRemindersEnabled: true }, MANAGER);
  const booking = await store.claimTask(Date.now()),
    originalBatch = store.db.batch.bind(store.db);
  store.db.batch = async (statements) => {
    store.db.batch = originalBatch;
    database
      .prepare(
        "UPDATE hub_settings SET value='false' WHERE key='interview_reminders_enabled'",
      )
      .run();
    return originalBatch(statements);
  };
  await store.finishTask(taskId, booking!.leaseToken!, {
    status: "done",
    result: {
      id: "fixture-event",
      meetUrl: "https://meet.google.com/synthetic-test",
    },
  });
  assert.equal(
    (await store.getApplication(applicationId)).interview!.status,
    "booked",
  );
  assert.equal(
    (await store.tasks()).filter((t) => t.payload.reminder).length,
    0,
  );
  assert.equal(
    database
      .prepare(
        "SELECT COUNT(*) AS n FROM hub_communications WHERE task_id LIKE '%:reminder:%'",
      )
      .get()!.n,
    0,
  );
  database.close();
});
test("rescheduling queues a new reminder generation without rewriting old payload identities", async () => {
  const { store, database, applicationId, interviewId, taskId, payload } =
    await calendarFixture(48);
  await currentSettings(store, { interviewRemindersEnabled: true }, MANAGER);
  const booking = await store.claimTask(Date.now());
  await store.finishTask(taskId, booking!.leaseToken!, {
    status: "done",
    result: {
      id: "fixture-event",
      meetUrl: "https://meet.google.com/synthetic-test",
    },
  });
  database
    .prepare("UPDATE hub_tasks SET status='done' WHERE kind='drive'")
    .run();
  const start = new Date(Date.parse(payload.start) + 86400000).toISOString(),
    end = new Date(Date.parse(payload.end) + 86400000).toISOString();
  database
    .prepare(
      "UPDATE hub_interviews SET status='pending',start=?,end=?,revision=3 WHERE id=?",
    )
    .run(start, end, interviewId);
  const updateId = `calendar:${interviewId}:revision:3`;
  await store
    .taskStatement(
      updateId,
      applicationId,
      "calendar",
      { ...payload, operation: "update", start, end, revision: 3 },
      Date.now(),
    )
    .run();
  const update = await store.claimTask(Date.now());
  assert.equal(update!.id, updateId);
  await store.finishTask(updateId, update!.leaseToken!, {
    status: "done",
    result: {
      id: "fixture-event",
      meetUrl: "https://meet.google.com/synthetic-test",
    },
  });
  const reminders = (await store.tasks()).filter((t) => t.payload.reminder);
  assert.equal(reminders.length, 6);
  assert.equal(
    reminders.filter(
      (t) =>
        t.payload.revision === 2 && t.payload.interviewStart === payload.start,
    ).length,
    3,
  );
  assert.equal(
    reminders.filter(
      (t) => t.payload.revision === 3 && t.payload.interviewStart === start,
    ).length,
    3,
  );
  database.close();
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore, applicationInput, jobInput } from "./fixtures";

test("3000 synthetic applications in bursts of 100 retain complete records and one initial task pair each", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  for (let offset = 0; offset < 3000; offset += 100) {
    const inputs = Array.from({ length: 100 }, () =>
      applicationInput(posting.id),
    );
    const results = await Promise.all(
      inputs.map((input) => store.acceptApplication(input)),
    );
    assert.equal(new Set(results.map((result) => result.id)).size, 100);
  }
  const count = (table: string) =>
    Number(database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
  assert.equal(count("hub_applications"), 3000);
  assert.equal(count("hub_tasks"), 6000);
  assert.equal(count("hub_communications"), 3000);
  assert.equal(count("hub_history"), 3000);
  const applications = await store.applications({ page: 100 });
  assert.equal(applications.items.length, 30);
  assert.equal(applications.total, 3000);
  assert.equal((await store.reports()).applications, 3000);
  database.close();
});
test("100 simultaneous first submissions share one application and preserve the winning payload on conflict", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput()),
    input = applicationInput(posting.id);
  const results = await Promise.all(
    Array.from({ length: 100 }, () => store.acceptApplication(input)),
  );
  assert.equal(new Set(results.map((result) => result.id)).size, 1);
  assert.equal(
    Number(
      database.prepare("SELECT COUNT(*) AS n FROM hub_applications").get()!.n,
    ),
    1,
  );
  assert.equal((await store.tasks()).length, 2);
  const fresh = applicationInput(posting.id),
    different = {
      ...fresh,
      fieldSubmissions: fresh.fieldSubmissions.map((field) =>
        field.path === "_systemfield_name"
          ? { ...field, value: "Conflicting Applicant" }
          : field,
      ),
    };
  const raced = await Promise.allSettled([
    store.acceptApplication(fresh),
    store.acceptApplication(different),
  ]);
  assert.equal(
    raced.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    raced.filter((result) => result.status === "rejected").length,
    1,
  );
  assert.equal(
    Number(
      database.prepare("SELECT COUNT(*) AS n FROM hub_applications").get()!.n,
    ),
    2,
  );
  database.close();
});

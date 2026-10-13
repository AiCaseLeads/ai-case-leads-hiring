import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore, MANAGER, RECRUITER, jobInput } from "./fixtures";
import { handleJobSetup } from "../../lib/job-setup/http";
import { defaultAnchors, type SetupCatalog } from "../../lib/job-setup/model";
import type { Catalog } from "../../lib/scorecards/model";
function fixtureJob(patch: Partial<ReturnType<typeof jobInput>> = {}) {
  return { ...jobInput(), ...patch };
}
function request(method: string, data?: unknown) {
  return new Request("https://jobs.example.invalid/api/job-setup", {
    method,
    headers: {
      Origin: "https://jobs.example.invalid",
      "Content-Type": "application/json",
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}
function command(extra: Record<string, unknown> = {}) {
  return {
    action: "save",
    creationId: crypto.randomUUID(),
    job: { ...fixtureJob({ slug: "new-posting" }), status: "draft" },
    location: { workModel: "remote", country: "Spain", city: "" },
    expectedBinding: null,
    scorecard: null,
    ...extra,
  };
}
test("wizard save atomically stores posting, reusable rubric, request and retry ledger", async () => {
  const { store } = createStore();
  let response = await handleJobSetup(
    request("PATCH", {
      action: "request",
      expectedRevision: 0,
      title: "Requested role",
      location: { workModel: "hybrid", country: "Spain", city: "Madrid" },
      description: "Approved description",
      reason: "Growth",
    }),
    MANAGER,
    store,
  );
  assert.equal(response.status, 200);
  const setup = ((await response.json()) as { data: SetupCatalog }).data;
  const input = command({
    requestId: setup.requests[0].id,
    rubric: {
      name: "Approved evidence review",
      criteria: [{ label: "Work sample", weight: 1, anchors: defaultAnchors }],
    },
  });
  response = await handleJobSetup(request("POST", input), MANAGER, store);
  assert.equal(response.status, 200);
  const job = (
    (await response.json()) as { data: { id: string; location: string } }
  ).data;
  assert.equal(job.id, input.creationId);
  assert.equal(job.location, "Remote · Spain");
  const stored = await store.setting<SetupCatalog>("job_setup_v1", setup);
  assert.equal(stored.requests[0].status, "used");
  assert.equal(stored.requests[0].jobId, job.id);
  assert.equal(stored.locations[job.id].country, "Spain");
  const scores = await store.setting<Catalog>(
    "scorecard_templates_v1",
    null as unknown as Catalog,
  );
  assert.equal(scores.templates.length, 1);
  assert.equal(scores.bindings[job.id].templateId, scores.templates[0].id);
  response = await handleJobSetup(request("POST", input), MANAGER, store);
  assert.equal(response.status, 200);
  assert.equal((await store.listJobs()).length, 1);
  assert.equal((await store.getJob(job.id)).formVersion, 1);
  assert.equal(
    (await store.setting<Catalog>("scorecard_templates_v1", scores)).templates
      .length,
    1,
  );
  response = await handleJobSetup(
    request("POST", {
      ...input,
      job: { ...input.job, title: "Changed after accepted save" },
    }),
    MANAGER,
    store,
  );
  assert.equal(response.status, 409);
});
test("a conflicting page address rolls back rubric, request use and metadata", async () => {
  const { store } = createStore();
  await store.saveJob(fixtureJob({ slug: "new-posting" }));
  const before = await store.setting("job_setup_v1", null);
  const response = await handleJobSetup(
    request(
      "POST",
      command({
        rubric: {
          name: "Must not persist",
          criteria: [{ label: "Evidence", weight: 1, anchors: defaultAnchors }],
        },
      }),
    ),
    MANAGER,
    store,
  );
  assert.equal(response.status, 409);
  assert.equal((await store.listJobs()).length, 1);
  assert.equal(await store.setting("job_setup_v1", null), before);
  assert.equal(await store.setting("scorecard_templates_v1", null), null);
  assert.equal(
    (await store.rows("SELECT * FROM hub_settings WHERE key LIKE 'job_save_%'"))
      .length,
    0,
  );
});
test("legacy posting edits preserve public location and archive hierarchy unless explicitly changed", async () => {
  const { store } = createStore();
  const prior = await store.saveJob(
    fixtureJob({
      slug: "legacy",
      location: "Approved custom location",
      archiveCountry: "USA",
      hiringRound: "October hiring",
      archiveProject: "Project",
    }),
  );
  const input = command({
    jobId: prior.id,
    formVersion: prior.formVersion,
    job: {
      ...fixtureJob({ slug: prior.slug }),
      location: prior.location,
      archiveCountry: prior.archiveCountry,
      archiveProject: prior.archiveProject,
      hiringRound: prior.hiringRound,
    },
    location: null,
  });
  const response = await handleJobSetup(request("POST", input), MANAGER, store);
  assert.equal(response.status, 200);
  const saved = await store.getJob(prior.id);
  assert.equal(saved.location, prior.location);
  assert.equal(saved.hiringRound, prior.hiringRound);
  assert.equal(saved.archiveCountry, prior.archiveCountry);
  const stale = await handleJobSetup(
    request("POST", { ...input, creationId: crypto.randomUUID() }),
    MANAGER,
    store,
  );
  assert.equal(stale.status, 409);
  assert.equal((await store.getJob(prior.id)).formVersion, 2);
});
test("saved job templates are immutable snapshots and copies disable automatic rejection", async () => {
  const { store } = createStore();
  const prior = await store.saveJob(
    fixtureJob({
      slug: "source",
      descriptionHtml: "Original",
      autoReject: true,
      rules: [
        {
          fieldPath: "experience",
          operator: "gte",
          value: 1,
          reason: "Eligible requirement",
          enabled: true,
        },
      ],
    }),
  );
  const response = await handleJobSetup(
    request("PATCH", {
      action: "template",
      expectedRevision: 0,
      sourceJobId: prior.id,
      name: "Reusable job",
    }),
    MANAGER,
    store,
  );
  assert.equal(response.status, 200);
  const saved = ((await response.json()) as { data: SetupCatalog }).data;
  assert.equal(saved.templates[0].job.autoReject, false);
  assert.equal(saved.templates[0].job.status, "draft");
  await store.saveJob(
    fixtureJob({ slug: "source", descriptionHtml: "Edited source" }),
    prior.id,
    prior.formVersion,
  );
  assert.equal(
    (await store.setting<SetupCatalog>("job_setup_v1", saved)).templates[0].job
      .descriptionHtml,
    "Original",
  );
  const stale = await handleJobSetup(
    request("PATCH", {
      action: "template",
      expectedRevision: 0,
      sourceJobId: prior.id,
      name: "Stale",
    }),
    MANAGER,
    store,
  );
  assert.equal(stale.status, 409);
});
test("staff mutate setup and new jobs require real structured locations", async () => {
  const { store } = createStore();
  assert.equal(
    (await handleJobSetup(request("POST", command()), null, store)).status,
    403,
  );
  assert.equal(
    (await handleJobSetup(request("POST", command()), RECRUITER, createStore().store)).status,
    200,
  );
  assert.equal(
    (
      await handleJobSetup(
        request("POST", command({ location: null })),
        MANAGER,
        store,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await handleJobSetup(
        request(
          "POST",
          command({
            location: { workModel: "onsite", country: "Spain", city: "" },
          }),
        ),
        MANAGER,
        store,
      )
    ).status,
    422,
  );
  const cross = new Request("https://jobs.example.invalid/api/job-setup", {
    method: "POST",
    headers: {
      Origin: "https://evil.invalid",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command()),
  });
  assert.equal((await handleJobSetup(cross, MANAGER, store)).status, 403);
});
test("a changed existing scorecard assignment is rejected without overwriting or changing the job", async () => {
  const { store } = createStore();
  const existing = await store.saveJob(fixtureJob({ slug: "bound" }));
  const original = { templateId: crypto.randomUUID(), version: 1 };
  const replacement = { templateId: crypto.randomUUID(), version: 1 };
  await store.setSetting("scorecard_templates_v1", {
    revision: 2,
    templates: [
      {
        ...replacement,
        id: replacement.templateId,
        name: "Replacement",
        criteria: [{ label: "Evidence", weight: 1, anchors: defaultAnchors }],
        createdAt: 1,
        createdBy: MANAGER.email,
      },
    ],
    archived: [],
    bindings: { [existing.id]: replacement },
  });
  const response = await handleJobSetup(
    request(
      "POST",
      command({
        jobId: existing.id,
        formVersion: existing.formVersion,
        job: fixtureJob({ slug: existing.slug }),
        expectedBinding: original,
        scorecard: original,
      }),
    ),
    MANAGER,
    store,
  );
  assert.equal(response.status, 409);
  assert.equal((await store.getJob(existing.id)).formVersion, 1);
  assert.equal(
    (await store.rows("SELECT * FROM hub_settings WHERE key LIKE 'job_save_%'"))
      .length,
    0,
  );
});
test("a catalog race detected by the transaction guard cannot leave a partial posting", async () => {
  const { store } = createStore();
  const originalBatch = store.db.batch.bind(store.db);
  store.db.batch = async (statements) => {
    await store.setSetting("job_setup_v1", {
      revision: 1,
      templates: [],
      requests: [],
      locations: {},
    });
    return originalBatch(statements);
  };
  const response = await handleJobSetup(
    request(
      "POST",
      command({
        rubric: {
          name: "Not saved",
          criteria: [{ label: "Evidence", weight: 1, anchors: defaultAnchors }],
        },
      }),
    ),
    MANAGER,
    store,
  );
  assert.equal(response.status, 409);
  assert.equal((await store.listJobs()).length, 0);
  assert.equal(await store.setting("scorecard_templates_v1", null), null);
  assert.equal(
    (await store.rows("SELECT * FROM hub_settings WHERE key LIKE 'job_save_%'"))
      .length,
    0,
  );
  assert.equal(
    (
      await store.setting<SetupCatalog>(
        "job_setup_v1",
        null as unknown as SetupCatalog,
      )
    ).revision,
    1,
  );
});

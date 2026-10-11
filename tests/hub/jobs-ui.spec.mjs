import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";
const prior = {
  id: "existing-job",
  title: "Creative Strategist",
  slug: "creative-strategist-spain",
  department: "Creative",
  location: "Spain — approved location",
  status: "open",
  descriptionHtml: "Approved creative role description",
  fields: [
    {
      path: "_systemfield_name",
      title: "Full name",
      type: "String",
      required: true,
    },
    {
      path: "_systemfield_email",
      title: "Email",
      type: "Email",
      required: true,
    },
    {
      path: "_systemfield_resume",
      title: "Resume",
      type: "File",
      required: false,
    },
  ],
  rules: [],
  autoReject: false,
  rejectionTemplate: "Thank you",
  assessmentPrompt: "Creative task",
  formVersion: 3,
  archiveProject: "Creative Strategist",
  archiveCountry: "Spain",
  hiringRound: "Previous round",
};
const anchors = [
  "No evidence",
  "Limited evidence",
  "Meets criterion",
  "Strong evidence",
  "Exceptional evidence",
];
const scores = {
  revision: 0,
  templates: [
    {
      id: "a9e065f9-1e11-49bd-8b5c-882e057e49b2",
      name: "Approved portfolio review",
      version: 1,
      criteria: [{ label: "Personal contribution", weight: 1, anchors }],
      createdAt: 1,
      createdBy: "manager@example.invalid",
    },
  ],
  archived: [],
  bindings: {
    "existing-job": {
      templateId: "a9e065f9-1e11-49bd-8b5c-882e057e49b2",
      version: 1,
    },
  },
};
const savedTemplate = {
  id: "e06b3a35-806b-4ab6-bd9a-07d183fb87a8",
  name: "Creative template",
  sourceJobId: prior.id,
  job: prior,
  location: { workModel: "remote", country: "Spain", city: "" },
  scorecard: scores.bindings[prior.id],
  createdAt: 1,
};
async function setup(
  t,
  {
    mobile = false,
    startCreating = false,
    jobs = [prior],
    catalog = {
      revision: 0,
      templates: [savedTemplate],
      requests: [],
      locations: {},
    },
    scoreCatalog = scores,
    failFirst = false,
  } = {},
) {
  const { outputFiles } = await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{Jobs}from'./components/hub/jobs';createRoot(document.getElementById('root')).render(<Jobs admin refresh={0} changed={()=>{}} startCreating={${startCreating}}/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
  });
  const server = createServer((req, res) => {
    res.setHeader(
      "Content-Type",
      req.url === "/bundle.js" ? "text/javascript" : "text/html",
    );
    res.end(
      req.url === "/bundle.js"
        ? outputFiles[0].text
        : '<div id="root"></div><script src="/bundle.js"></script>',
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    browser = await chromium.launch({
      headless: true,
      ...(existsSync(chrome) ? { executablePath: chrome } : {}),
    });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const page = await browser.newPage({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 900 },
    }),
    writes = [],
    catalogWrites = [];
  await page.route("**/api/hub/jobs", (route) =>
    route.fulfill({ json: { data: jobs } }),
  );
  await page.route("**/api/scorecards", (route) =>
    route.fulfill({ json: { data: scoreCatalog } }),
  );
  await page.route("**/api/job-setup", async (route) => {
    const req = route.request();
    if (req.method() === "GET")
      return route.fulfill({ json: { data: catalog } });
    const input = req.postDataJSON();
    if (req.method() === "PATCH") {
      catalogWrites.push(input);
      catalog = { ...catalog, revision: catalog.revision + 1 };
      if (input.action === "request")
        catalog.requests = [
          ...catalog.requests,
          {
            ...input,
            id: "d7e206b0-20e8-46ac-b55f-7787803f2b96",
            createdAt: 1,
            createdBy: "manager@example.invalid",
            status: "pending",
          },
        ];
      if (input.action === "template")
        catalog.templates = [
          ...catalog.templates,
          { ...savedTemplate, name: input.name },
        ];
      return route.fulfill({ json: { data: catalog } });
    }
    writes.push(input);
    if (failFirst && writes.length === 1)
      return route.fulfill({
        status: 503,
        json: {
          error: {
            message: "Temporary save failure. Your draft is still here.",
          },
        },
      });
    return route.fulfill({
      json: {
        data: {
          ...input.job,
          id: input.jobId || input.creationId,
          formVersion: 4,
        },
      },
    });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page
    .getByRole("heading", {
      name: startCreating ? "Create a job" : "Jobs",
      exact: true,
    })
    .waitFor();
  return { page, writes, catalogWrites };
}
async function next(page) {
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}
test("mobile blank job follows real steps, required questions and scorecard; failed publication retains every entry and retry ID", async (t) => {
  const { page, writes } = await setup(t, {
    mobile: true,
    jobs: [],
    failFirst: true,
  });
  await page.getByRole("button", { name: "Create job", exact: true }).click();
  await page.getByRole("button", { name: "Create blank job" }).click();
  assert.equal(
    await page
      .getByText("What should applicants send?", { exact: true })
      .count(),
    0,
  );
  await next(page);
  await page
    .getByText("Add a job title, then choose a work arrangement", {
      exact: false,
    })
    .waitFor();
  await page
    .getByLabel("Job title", { exact: true })
    .fill("Synthetic Creative Strategist");
  await page.getByLabel("Work arrangement").selectOption("onsite");
  await page.getByLabel("Country", { exact: true }).selectOption("Spain");
  await next(page);
  await page
    .getByText("Office-based jobs need a country and city", { exact: false })
    .waitFor();
  await page.getByLabel("City", { exact: true }).fill("Madrid");
  await page
    .getByLabel("Job description", { exact: true })
    .fill("Approved synthetic responsibilities");
  await next(page);
  await page.getByLabel("Question 3 requirement").selectOption("required");
  await page
    .getByLabel("Add from the question library")
    .selectOption("linkedin_profile");
  await page.getByRole("button", { name: "Add selected question" }).click();
  assert.equal(
    await page.getByLabel("Question 5 requirement").inputValue(),
    "optional",
  );
  await page.getByRole("button", { name: "Add custom question" }).click();
  await page
    .getByLabel("Question 6 label")
    .fill("What did you personally contribute?");
  await page.getByLabel("Question 6 requirement").selectOption("required");
  await next(page);
  await page
    .getByLabel("Review scorecard", { exact: true })
    .selectOption("new");
  await page
    .getByLabel("Scorecard name", { exact: true })
    .fill("Synthetic work review");
  await page
    .getByLabel("Review criterion 1", { exact: true })
    .fill("Personal contribution to the work");
  await next(page);
  assert.equal(
    await page
      .getByText(
        "A new posting keeps a separate set of applicants automatically",
        { exact: false },
      )
      .count(),
    1,
  );
  await page
    .getByLabel(
      "I have reviewed the job description, questions and review criteria.",
    )
    .check();
  await page.getByRole("button", { name: "Publish job", exact: true }).click();
  await page
    .getByText("Temporary save failure. Your draft is still here.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page
      .getByRole("heading", {
        name: "Synthetic Creative Strategist",
        exact: true,
      })
      .count(),
    1,
  );
  await page.getByRole("button", { name: "Publish job", exact: true }).click();
  await page.getByText("Job published.", { exact: false }).waitFor();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[0].job.status, "open");
  assert.equal(writes[0].job.autoReject, false);
  assert.equal(writes[0].location.city, "Madrid");
  assert.equal(writes[0].rubric.criteria[0].weight, 1);
  assert.equal(writes[0].job.fields[2].required, true);
  assert.equal(writes[0].job.fields[3].required, false);
  assert.equal(writes[0].job.fields[4].required, false);
  assert.equal(writes[0].job.fields[5].required, true);
  assert.doesNotMatch(writes[0].job.hiringRound, /Batch/);
});
test("editing a legacy posting preserves its address, archive labels, form revision and unset location", async (t) => {
  const { page, writes } = await setup(t);
  await page.getByRole("button", { name: "Edit job", exact: true }).click();
  assert.equal(await page.getByLabel("Work arrangement").inputValue(), "");
  await page
    .getByRole("button", { name: "Save as draft (unpublish)", exact: true })
    .click();
  await page.getByText("Draft saved.", { exact: false }).waitFor();
  assert.equal(writes[0].jobId, prior.id);
  assert.equal(writes[0].formVersion, 3);
  assert.equal(writes[0].job.slug, prior.slug);
  assert.equal(writes[0].job.hiringRound, prior.hiringRound);
  assert.equal(writes[0].job.archiveCountry, prior.archiveCountry);
  assert.equal(writes[0].location, null);
  assert.deepEqual(writes[0].scorecard, scores.bindings[prior.id]);
});
test("duplicate and saved-template entry points create a separate posting with preserved criteria", async (t) => {
  const { page, writes } = await setup(t);
  const original = structuredClone(prior);
  await page
    .getByRole("button", { name: "Duplicate job", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Job title", { exact: true }).inputValue(),
    prior.title,
  );
  assert.equal(await page.getByLabel("Work arrangement").inputValue(), "");
  await page.getByLabel("Work arrangement").selectOption("remote");
  await page
    .getByLabel("Where can applicants work from?")
    .selectOption("United States");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByText("Draft saved.", { exact: false }).waitFor();
  assert.equal(writes[0].jobId, undefined);
  assert.equal(writes[0].job.autoReject, false);
  assert.notEqual(writes[0].job.slug, prior.slug);
  assert.notEqual(writes[0].job.hiringRound, prior.hiringRound);
  assert.deepEqual(writes[0].scorecard, scores.bindings[prior.id]);
  assert.deepEqual(prior, original);
  await page.getByRole("button", { name: "Create job", exact: true }).click();
  await page
    .getByRole("button", { name: "Choose template", exact: true })
    .click();
  await page
    .getByLabel("Job template", { exact: true })
    .selectOption(savedTemplate.id);
  await page
    .getByRole("button", { name: "Use this template", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Where can applicants work from?").inputValue(),
    "Spain",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByText("Draft saved.", { exact: false }).waitFor();
  assert.equal(writes[1].job.descriptionHtml, prior.descriptionHtml);
  assert.deepEqual(writes[1].scorecard, scores.bindings[prior.id]);
});
test("home shortcut opens creation and a saved form request becomes an editable draft", async (t) => {
  const { page, writes, catalogWrites } = await setup(t, {
    startCreating: true,
  });
  await page
    .getByRole("button", { name: "Open hiring requests", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create a hiring request", exact: true })
    .click();
  await page
    .getByLabel("Requested job title", { exact: true })
    .fill("Requested Engineer");
  await page.getByLabel("Work arrangement").selectOption("hybrid");
  await page.getByLabel("Country", { exact: true }).selectOption("Colombia");
  await page.getByLabel("City", { exact: true }).fill("Bogotá");
  await page
    .getByLabel("Why do we need this hire?", { exact: true })
    .fill("Approved growth request");
  await page
    .getByLabel("Draft responsibilities (optional)")
    .fill("Approved request responsibilities");
  await page
    .getByRole("button", { name: "Save hiring request", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create job from request", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Job title", { exact: true }).inputValue(),
    "Requested Engineer",
  );
  assert.equal(
    await page.getByLabel("City", { exact: true }).inputValue(),
    "Bogotá",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByText("Draft saved.", { exact: false }).waitFor();
  assert.equal(catalogWrites.length, 1);
  assert.equal(catalogWrites[0].action, "request");
  assert.equal(writes[0].requestId, "d7e206b0-20e8-46ac-b55f-7787803f2b96");
  assert.equal(writes[0].job.status, "draft");
  assert.equal(
    writes[0].job.descriptionHtml,
    "Approved request responsibilities",
  );
});
test("duplicating a posting visibly preserves its pinned rubric instead of silently using a newer version", async (t) => {
  const upgraded = {
    ...scores.templates[0],
    version: 2,
    criteria: [{ label: "New criteria", weight: 1, anchors }],
  };
  const { page, writes } = await setup(t, {
    scoreCatalog: { ...scores, templates: [...scores.templates, upgraded] },
  });
  await page
    .getByRole("button", { name: "Duplicate job", exact: true })
    .click();
  await page.getByLabel("Work arrangement").selectOption("remote");
  await next(page);
  await next(page);
  const select = page.getByLabel("Review scorecard", { exact: true });
  assert.equal(await select.inputValue(), scores.templates[0].id + ":1");
  assert.match(
    await select.locator("option:checked").textContent(),
    /copied version 1/,
  );
  assert.equal(
    await page
      .getByText("Personal contribution · weight 1", { exact: true })
      .count(),
    1,
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByText("Draft saved.", { exact: false }).waitFor();
  assert.equal(writes[0].scorecard.version, 1);
});

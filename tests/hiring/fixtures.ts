import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { D1HiringStore } from "../../lib/hiring/store";
import type {
  ApplicationInput,
  HiringProvider,
  JobDefinition,
  SubmissionOutcome,
} from "../../lib/hiring/types";

export const JOB_ID = "e9ed20fd-d45f-4aad-8a00-a19bfba0083e";
export const SESSION = "a".repeat(64);
export const definition: JobDefinition = {
  job: {
    id: JOB_ID,
    title: "Synthetic Engineering Role",
    slug: "synthetic-engineering-role",
    department: "Test",
    descriptionHtml: "<p>Synthetic fixture only.</p>",
  },
  fields: [
    {
      path: "_systemfield_name",
      title: "Name",
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
    { path: "available", title: "Available", type: "Boolean", required: true },
    {
      path: "specialty",
      title: "Specialty",
      type: "ValueSelect",
      required: true,
      options: [{ value: "web", label: "Web" }],
    },
  ],
};
export function applicationInput(): ApplicationInput {
  return {
    jobPostingId: JOB_ID,
    submissionKey: crypto.randomUUID(),
    fieldSubmissions: [
      { path: "_systemfield_name", value: "Synthetic Applicant" },
      { path: "_systemfield_email", value: "synthetic@example.invalid" },
      { path: "available", value: false },
      { path: "specialty", value: "web" },
    ],
    utmData: { utm_source: "fixture" },
  };
}
export class FixtureProvider implements HiringProvider {
  submitCalls = 0;
  uploadCalls = 0;
  jobs = [definition.job];
  outcome: SubmissionOutcome = {
    blocked: false,
    submittedFormInstanceId: "7a3d9986-a88a-49f4-b363-8da21b893e30",
  };
  failure?: Error;
  async listJobs() {
    return this.jobs;
  }
  async jobInfo() {
    return structuredClone(definition);
  }
  async createUpload() {
    this.uploadCalls++;
    return {
      url: "https://uploads.example.invalid/",
      fields: { key: "synthetic-file" },
      handle: `fixture-handle-${crypto.randomUUID()}`,
    };
  }
  async submit() {
    this.submitCalls++;
    await Promise.resolve();
    if (this.failure) throw this.failure;
    return this.outcome;
  }
  async resolveApplicationId() {
    return "7a3d9986-a88a-49f4-b363-8da21b893e31";
  }
}
/** Execute production D1 SQL through SQLite, not a fake idempotency implementation. */
export function sqliteStore() {
  const database = new DatabaseSync(":memory:");
  database.exec(
    readFileSync(
      new URL("../../drizzle/0000_hiring_tracking.sql", import.meta.url),
      "utf8",
    ),
  );
  const db = {
    async batch(statements: { run(): Promise<unknown> }[]) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(sql: string) {
      const statement = database.prepare(sql);
      let values: (string | number | null)[] = [];
      const prepared = {
        bind(...args: (string | number | null)[]) {
          values = args;
          return prepared;
        },
        async run() {
          const result = statement.run(...values);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
        async first() {
          return statement.get(...values) ?? null;
        },
        async all() {
          return { success: true, results: statement.all(...values) };
        },
      };
      return prepared;
    },
  } as unknown as D1Database;
  return { database, db, store: new D1HiringStore(db) };
}

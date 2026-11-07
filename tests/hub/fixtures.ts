import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import {
  HubStore,
  DEFAULT_REJECTION,
  type HubOptions,
} from "../../lib/hub/store";
import type { ApplicationInput } from "../../lib/hiring/types";
import type { JobInput, ActionInput, BulkInput, SettingsInput } from "../../lib/hub/validation";
import type { HubMember } from "../../lib/hub/auth";

export async function currentAction(store:HubStore,id:string,input:Omit<ActionInput,"expectedRevision"> & {expectedRevision?:number},member:HubMember) {
  return store.action(id,{...input,expectedRevision:input.expectedRevision ?? (await store.applicationRow(id)).revision,...(input.action === "email" && !input.actionId ? {actionId:crypto.randomUUID()} : {})},member);
}
export async function currentSettings(store:HubStore,input:Omit<SettingsInput,"settingsVersion"> & {settingsVersion?:number},member:HubMember) {
  return store.saveSettings({...input,settingsVersion:input.settingsVersion ?? (await store.settings()).settingsVersion},member);
}
export async function currentBulk(store:HubStore,ids:string[],input:Omit<BulkInput,"ids"|"expectedRevisions">,member:HubMember) {
  const expectedRevisions:Record<string,number>={};
  for(const id of ids) {try {expectedRevisions[id]=(await store.applicationRow(id)).revision;} catch {expectedRevisions[id]=1;}}
  return store.bulk(ids,{...input,expectedRevisions},member);
}

export const MANAGER = {
  email: "manager@example.invalid",
  userId: "manager",
  isOwner: true,
  role: "admin" as const,
};
export const RECRUITER = {
  email: "recruiter@example.invalid",
  userId: "recruiter",
  role: "recruiter" as const,
};
export const SESSION_HASH = "a".repeat(64);
export const GOOGLE_READY = {
  google: true,
  drive: true,
  applicationsEnabled: true,
};
export function createStore(options: HubOptions = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  const migrationDir = new URL("../../drizzle/", import.meta.url);
  for (const filename of readdirSync(migrationDir)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    database.exec(readFileSync(new URL(filename, migrationDir), "utf8"));
  const db = {
    prepare(sql: string) {
      let values: (string | number | null)[] = [];
      const statement = database.prepare(sql);
      const prepared = {
        bind(...args: (string | number | null)[]) {
          values = args;
          return prepared;
        },
        async run() {
          const result = statement.run(...values);
          return {
            success: true,
            results: [],
            meta: { changes: Number(result.changes) },
          };
        },
        async first() {
          return statement.get(...values) ?? null;
        },
        async all() {
          return {
            success: true,
            results: statement.all(...values),
            meta: { changes: 0 },
          };
        },
        execute() {
          if (
            /^\s*(?:SELECT|WITH)|RETURNING/i.test(sql) ||
            sql.includes("RETURNING")
          )
            return {
              success: true,
              results: statement.all(...values),
              meta: { changes: 0 },
            };
          const result = statement.run(...values);
          return {
            success: true,
            results: [],
            meta: { changes: Number(result.changes) },
          };
        },
      };
      return prepared;
    },
    async batch(statements: { execute: () => unknown }[]) {
      database.exec("BEGIN");
      try {
        const results = statements.map((s) => s.execute());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  return {
    db,
    database,
    store: new HubStore(db, {
      sessionHash: SESSION_HASH,
      origin: "https://jobs.example.invalid",
      integrations: GOOGLE_READY,
      ...options,
    }),
  };
}
export function jobInput(): JobInput {
  return {
    title: "Synthetic Engineer",
    slug: `synthetic-${crypto.randomUUID()}`,
    department: "Test",
    descriptionHtml: "<p>Approved synthetic role description.</p>",
    status: "open",
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
        path: "experience",
        title: "Years of experience",
        type: "Number",
        required: false,
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
    rejectionTemplate: DEFAULT_REJECTION,
    assessmentPrompt: "Write a synthetic assessment response.",
  };
}
export function applicationInput(jobId: string): ApplicationInput {
  return {
    jobPostingId: jobId,
    submissionKey: crypto.randomUUID(),
    fieldSubmissions: [
      { path: "_systemfield_name", value: "Synthetic Applicant" },
      {
        path: "_systemfield_email",
        value: `synthetic-${crypto.randomUUID()}@example.invalid`,
      },
      { path: "experience", value: 5 },
    ],
    utmData: { utm_source: "synthetic-test" },
  };
}
export async function approveScheduling(store: HubStore) {
  await currentSettings(store,
    {
      calendarId: "synthetic@example.invalid",
      interviewTimeZone: "UTC",
      interviewStartHour: 0,
      interviewEndHour: 24,
      interviewDurationMinutes: 30,
      interviewWeekdays: [0, 1, 2, 3, 4, 5, 6],
    },
    MANAGER,
  );
}

export async function addReviewedNote(store:HubStore,id:string,member:HubMember=MANAGER) {
 await currentAction(store,id,{action:"note",text:"Interview evidence reviewed for hiring decision."},member);
 const {markNotesReviewed}=await import("../../lib/hub/note-review");
 const review=(await store.getApplication(id,member.email)).notesReview!;
 await markNotesReviewed(store,id,member.email,review.version);
}

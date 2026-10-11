import { canonicalJson, privateToken, sha256 } from "../hiring/crypto";
import { HiringError } from "../hiring/errors";
import { validateAnswers, MAX_APPLICATION_FILE_BYTES } from "../hiring/validation";
import { gradeForScorecards } from "./grading";
import type {
  ApplicationInput,
  FieldSubmission,
  Job,
  JobDefinition,
} from "../hiring/types";
import type { HubMember } from "./auth";
import type {
  ApplicationDetail,
  ApplicationSummary,
  Assessment,
  Interview,
  HubJob,
  IntegrationStatus,
  Member,
  Scheduling,
  Stage,
  Task,
} from "./types";
import {
  evaluateRequirements,
  sanitizeDescription,
  validateJob,
  type ActionInput,
  type BulkInput,
  type JobInput,
  type SettingsInput,
} from "./validation";

export const DEFAULT_REJECTION =
  "Hi {{name}},\n\nThank you for applying for {{jobTitle}} at AI Case Leads. We appreciate your interest. We will not be moving forward with your application for this role.\n\nAI Case Leads Hiring Team";
type Bind = string | number | null;
export type ApplicationFilters = {
  q?:string;jobId?:string;stage?:string;assignee?:string;qualification?:"pass"|"review"|"fail";
  grade?:"reviewed"|"ungraded";sort?:"grade_desc";duplicate?:boolean;page?:number;
};
const SUMMARY_COLUMNS = "id,revision,name,email,job_id,job_title,stage,qualification,assignee,created_at,updated_at,source,drive_folder_url";
export type HubOptions = {
  sessionHash?: string;
  origin?: string;
  integrations?: IntegrationStatus;
  expectedRecruitingSender?: string;
};
type JobRow = {
  id: string;
  slug: string;
  title: string;
  department: string;
  description_html: string;
  location: string | null;
  status: HubJob["status"];
  fields_json: string;
  rules_json: string;
  auto_reject: number;
  rejection_template: string;
  assessment_prompt: string | null;
  archive_project: string | null;
  archive_country: string | null;
  hiring_round: string | null;
  form_version: number;
};
type ApplicationRow = {
  id: string;
  submission_key_hash: string;
  fingerprint: string;
  session_hash: string;
  job_id: string;
  job_title: string;
  name: string;
  email: string;
  stage: Stage;
  qualification: ApplicationSummary["qualification"];
  archive_project: string | null;
  archive_country: string | null;
  hiring_round: string | null;
  form_version: number;
  utm_json: string;
  qualification_json: string;
  answers_json: string;
  fields_json: string;
  source: string;
  assignee: string | null;
  created_at: number;
  updated_at: number;
  stage_entered_at: number;
  revision: number;
  drive_folder_id: string | null;
  drive_folder_url: string | null;
  rejection_reason: string | null;
  duplicate_application_count?: number;
};
export type InterviewRow = {
  id: string;
  application_id: string;
  status: ApplicationDetail["interview"] extends infer T
    ? T extends { status: infer S }
      ? S
      : string
    : string;
  start: string | null;
  end: string | null;
  time_zone: string | null;
  meet_url: string | null;
  provider_id: string | null;
  attended: number | null;
  calendar_id: string | null;
  reservation_key: string | null;
  revision: number;
  created_at: number;
  updated_at: number;
};
type TaskRow = {
  id: string;
  application_id: string;
  kind: Task["kind"];
  payload_json: string;
  status: Task["status"];
  attempts: number;
  run_after: number;
  lease_until: number | null;
  lease_token: string | null;
  last_error: string | null;
  result_json: string | null;
  created_at: number;
  updated_at: number;
};
export type LinkRow = {
  token_hash: string;
  application_id: string;
  kind: "assessment" | "interview";
  expires_at: number;
  used_at: number | null;
  payload_json: string;
};
function decode<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
function job(row: JobRow): HubJob {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    department: row.department,
    descriptionHtml: row.description_html,
    ...(row.location ? { location: row.location } : {}),
    status: row.status,
    fields: decode(row.fields_json, []),
    archiveProject: row.archive_project || undefined,
    archiveCountry: row.archive_country || undefined,
    hiringRound: row.hiring_round || undefined,
    formVersion: row.form_version,
    rules: decode(row.rules_json, []),
    autoReject: row.auto_reject === 1,
    rejectionTemplate: row.rejection_template,
    ...(row.assessment_prompt
      ? { assessmentPrompt: row.assessment_prompt }
      : {}),
  };
}
function summary(row: ApplicationRow): ApplicationSummary {
  return {
    id: row.id,
    revision: row.revision,
    name: row.name,
    email: row.email,
    jobId: row.job_id,
    jobTitle: row.job_title,
    stage: row.stage,
    qualification: row.qualification,
    assignee: row.assignee,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: row.source,
    duplicateEmail: (row.duplicate_application_count || 1) > 1,
    duplicateApplicationCount: row.duplicate_application_count || 1,
    grade: gradeForScorecards([]),
    ...(row.drive_folder_url ? { driveFolderUrl: row.drive_folder_url } : {}),
  };
}
function task(row: TaskRow): Task {
  return {
    id: row.id,
    applicationId: row.application_id,
    kind: row.kind,
    payload: decode(row.payload_json, {}),
    status: row.status,
    attempts: row.attempts,
    runAfter: row.run_after,
    leaseUntil: row.lease_until,
    leaseToken: row.lease_token,
    lastError: row.last_error,
    ...(row.result_json ? { result: decode(row.result_json, {}) } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export async function applicationIdForSubmissionKey(
  key: string,
): Promise<string> {
  return `app_${await sha256(key)}`;
}
function template(text: string, name: string, title: string): string {
  return text
    .replace(/\{\{name\}\}/g, name)
    .replace(/\{\{jobTitle\}\}/g, title);
}
function conflict(): HiringError {
  return new HiringError(
    "record_changed",
    409,
    "This record changed while you were working. Refresh it and try again.",
  );
}

export class HubStore {
  constructor(
    readonly db: D1Database,
    readonly options: HubOptions = {},
  ) {}
  stmt(sql: string, ...values: Bind[]): D1PreparedStatement {
    return this.db.prepare(sql).bind(...values);
  }
  async rows<T>(sql: string, ...values: Bind[]): Promise<T[]> {
    return (await this.stmt(sql, ...values).all<T>()).results || [];
  }
  async setting<T>(key: string, fallback: T): Promise<T> {
    const row = await this.stmt(
      "SELECT value FROM hub_settings WHERE key=?",
      key,
    ).first<{ value: string }>();
    return row ? decode(row.value, fallback) : fallback;
  }
  async setSetting(key: string, value: unknown): Promise<void> {
    await this.settingStatement(key, value).run();
  }
  settingStatement(key: string, value: unknown): D1PreparedStatement {
    return this.stmt(
      "INSERT INTO hub_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
      key,
      JSON.stringify(value),
      Date.now(),
    );
  }
  async listJobs(): Promise<HubJob[]> {
    return (
      await this.rows<JobRow>("SELECT * FROM hub_jobs ORDER BY created_at,id")
    ).map(job);
  }
  async listPublishedJobs(): Promise<Job[]> {
    return (
      await this.rows<JobRow>(
        "SELECT * FROM hub_jobs WHERE status='open' ORDER BY created_at,id",
      )
    ).map((row) => {
      const value = job(row);
      return {
        id: value.id,
        slug: value.slug,
        title: value.title,
        department: value.department,
        descriptionHtml: value.descriptionHtml,
        ...(value.location ? { location: value.location } : {}),
      };
    });
  }
  async getJob(id: string): Promise<HubJob> {
    const row = await this.stmt(
      "SELECT * FROM hub_jobs WHERE id=?",
      id,
    ).first<JobRow>();
    if (!row)
      throw new HiringError("job_not_found", 404, "This job was not found.");
    return job(row);
  }
  async jobDefinition(id: string): Promise<JobDefinition> {
    const value = await this.getJob(id);
    if (value.status !== "open")
      throw new HiringError(
        "job_closed",
        404,
        "This job is no longer accepting applications.",
      );
    return {
      job: {
        id: value.id,
        slug: value.slug,
        title: value.title,
        department: value.department,
        descriptionHtml: value.descriptionHtml,
        ...(value.location ? { location: value.location } : {}),
      },
      fields: value.fields,
      formVersion: value.formVersion,
    };
  }
  async saveJob(
    input: JobInput,
    id?: string,
    expectedFormVersion?: number,
  ): Promise<HubJob> {
    const now = Date.now();
    const previous = id ? await this.getJob(id) : null;
    const rejectionTemplate = input.rejectionTemplate ?? previous?.rejectionTemplate ?? await this.setting("rejection_template", DEFAULT_REJECTION);
    validateJob({ ...input, rejectionTemplate });
    const jobId = id || crypto.randomUUID();
    if (
      previous &&
      expectedFormVersion !== undefined &&
      previous.formVersion !== expectedFormVersion
    )
      throw conflict();
    const description =
      previous && input.descriptionHtml === previous.descriptionHtml
        ? input.descriptionHtml
        : sanitizeDescription(input.descriptionHtml);
    try {
      if (previous) {
        const result = await this.stmt(
          "UPDATE hub_jobs SET title=?,slug=?,department=?,description_html=?,location=?,status=?,fields_json=?,rules_json=?,auto_reject=?,rejection_template=?,assessment_prompt=?,archive_project=?,archive_country=?,hiring_round=?,form_version=form_version+1,updated_at=? WHERE id=? AND form_version=?",
          input.title,
          input.slug,
          input.department,
          description,
          input.location || null,
          input.status,
          JSON.stringify(input.fields),
          JSON.stringify(input.rules),
          input.autoReject ? 1 : 0,
          rejectionTemplate,
          input.assessmentPrompt || null,
          input.archiveProject?.trim() || null,
          input.archiveCountry?.trim() || null,
          input.hiringRound?.trim() || null,
          now,
          jobId,
          previous.formVersion,
        ).run();
        if (result.meta.changes !== 1) throw conflict();
      } else
        await this.stmt(
          "INSERT INTO hub_jobs (id,title,slug,department,description_html,location,status,fields_json,rules_json,auto_reject,rejection_template,assessment_prompt,archive_project,archive_country,hiring_round,form_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)",
          jobId,
          input.title,
          input.slug,
          input.department,
          description,
          input.location || null,
          input.status,
          JSON.stringify(input.fields),
          JSON.stringify(input.rules),
          input.autoReject ? 1 : 0,
          rejectionTemplate,
          input.assessmentPrompt || null,
          input.archiveProject?.trim() || null,
          input.archiveCountry?.trim() || null,
          input.hiringRound?.trim() || null,
          now,
          now,
        ).run();
    } catch (error) {
      if (error instanceof HiringError) throw error;
      throw new HiringError(
        "job_conflict",
        409,
        "That job URL is already in use or the job changed. Refresh and retry.",
      );
    }
    return this.getJob(jobId);
  }
  async seedDraftJobs(): Promise<HubJob[]> {
    const now = Date.now();
    const rejectionTemplate = await this.setting("rejection_template", DEFAULT_REJECTION);
    await this.db.batch(
      [
        [
          "1f93c067-7046-4c34-9c67-a6bb300bf0a1",
          "Full-stack Engineer",
          "full-stack-engineer",
        ],
        [
          "1f93c067-7046-4c34-9c67-a6bb300bf0a2",
          "Creative Strategist",
          "creative-strategist",
        ],
      ].map(([id, title, slug]) =>
        this.stmt(
          "INSERT INTO hub_jobs (id,title,slug,department,description_html,status,fields_json,rules_json,auto_reject,rejection_template,form_version,created_at,updated_at) VALUES (?,?,?,'','','draft','[]','[]',0,?,1,?,?) ON CONFLICT(slug) DO NOTHING",
          id,
          title,
          slug,
          rejectionTemplate,
          now,
          now,
        ),
      ),
    );
    return this.listJobs();
  }
  private historyStatement(
    id: string,
    appId: string,
    type: string,
    text: string,
    actor: string,
    now: number,
    from: Stage | null = null,
    to: Stage | null = null,
  ) {
    return this.stmt(
      "INSERT INTO hub_history (id,application_id,type,text,actor,from_stage,to_stage,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
      id,
      appId,
      type,
      text,
      actor,
      from,
      to,
      now,
    );
  }
  taskStatement(
    id: string,
    appId: string,
    kind: Task["kind"],
    payload: Record<string, unknown>,
    now: number,
  ) {
    return this.stmt(
      "INSERT INTO hub_tasks (id,application_id,kind,payload_json,status,attempts,run_after,created_at,updated_at) VALUES (?,?,?,?,'pending',0,?,?,?) ON CONFLICT(id) DO NOTHING",
      id,
      appId,
      kind,
      JSON.stringify(payload),
      now,
      now,
      now,
    );
  }
  private mailStatements(
    id: string,
    app: Pick<ApplicationSummary, "id" | "email">,
    subject: string,
    body: string,
    now: number,
    displayBody = body,
    options: {
      runAfter?: number;
      metadata?: Record<string, unknown>;
      guard?: { sql: string; values: Bind[] };
    } = {},
  ): D1PreparedStatement[] {
    const messageId = `<${id.replace(/[^a-zA-Z0-9]/g, "")}@jobs.aicaseleads.com>`;
    return [
      this.stmt(
        `INSERT INTO hub_tasks (id,application_id,kind,payload_json,status,attempts,run_after,created_at,updated_at) SELECT ?,?,'gmail',?,'pending',0,?,?,? WHERE ${options.guard?.sql || "1=1"} ON CONFLICT(id) DO NOTHING`,
        id,
        app.id,
        JSON.stringify({
          to: app.email,
          subject,
          body,
          messageId,
          ...options.metadata,
        }),
        options.runAfter ?? now,
        now,
        now,
        ...(options.guard?.values || []),
      ),
      this.stmt(
        "INSERT INTO hub_communications (id,application_id,task_id,subject,body,status,created_at,updated_at) SELECT ?,?,?,?,?,'pending',?,? WHERE EXISTS (SELECT 1 FROM hub_tasks WHERE id=? AND application_id=?) ON CONFLICT(task_id) DO NOTHING",
        `communication:${id}`,
        app.id,
        id,
        subject,
        displayBody,
        now,
        now,
        id,
        app.id,
      ),
    ];
  }
  async acceptApplication(
    input: ApplicationInput,
    sessionHash = this.options.sessionHash,
    acceptanceStatements: D1PreparedStatement[] = [],
  ): Promise<{ id: string }> {
    if (!sessionHash)
      throw new HiringError(
        "session_required",
        409,
        "Refresh the application before submitting.",
      );
    const id = await applicationIdForSubmissionKey(input.submissionKey),
      keyHash = await sha256(input.submissionKey);
    const fingerprint = await sha256(
      canonicalJson({
        jobPostingId: input.jobPostingId,
        fieldSubmissions: [...input.fieldSubmissions].sort((a, b) =>
          a.path.localeCompare(b.path),
        ),
        utmData: input.utmData || null,
        formVersion: input.formVersion ?? null,
      }),
    );
    const existing = await this.stmt(
      "SELECT * FROM hub_applications WHERE id=?",
      id,
    ).first<ApplicationRow>();
    if (existing) {
      if (
        existing.fingerprint !== fingerprint ||
        existing.session_hash !== sessionHash
      )
        throw new HiringError(
          "submission_conflict",
          409,
          "This submission is saved with different answers or belongs to another browser.",
        );
      if (acceptanceStatements.length)
        await this.db.batch(acceptanceStatements);
      return { id };
    }
    const posting = await this.getJob(input.jobPostingId);
    if (posting.status !== "open")
      throw new HiringError(
        "job_closed",
        404,
        "This job is no longer accepting applications.",
      );
    if (
      input.formVersion !== undefined &&
      input.formVersion !== posting.formVersion
    )
      throw new HiringError(
        "form_changed",
        422,
        "The application questions or requirements changed. Refresh the job before submitting.",
      );
    validateAnswers(input, posting.fields);
    const now = Date.now();
    const fileEntries: { path: string; id: string }[] = [];
    let applicationFileBytes = 0;
    const answers: FieldSubmission[] = [];
    for (const answer of input.fieldSubmissions) {
      if (
        posting.fields.find((f) => f.path === answer.path)?.type === "File" &&
        answer.value
      ) {
        const fileId = await sha256(String(answer.value));
        const uploaded = await this.stmt(
          "SELECT id,size FROM hub_files WHERE id=? AND job_id=? AND field_path=? AND session_hash=? AND uploaded_at>0 AND expires_at>? AND application_id IS NULL",
          fileId,
          posting.id,
          answer.path,
          sessionHash,
          now,
        ).first<{id:string;size:number}>();
        if (!uploaded)
          throw new HiringError(
            "invalid_upload",
            422,
            "Your upload expired or is unavailable. Select the file again.",
          );
        applicationFileBytes += uploaded.size;
        if (applicationFileBytes > MAX_APPLICATION_FILE_BYTES)
          throw new HiringError("application_files_too_large", 422, "Application files must total 25 MB or less.");
        fileEntries.push({ path: answer.path, id: fileId });
        answers.push({ path: answer.path, value: fileId });
      } else answers.push(answer);
    }
    const qualification = evaluateRequirements(
      posting.rules,
      input.fieldSubmissions,
      posting.fields,
    );
    const rejected =
      posting.autoReject && qualification.qualification === "fail";
    const stage: Stage = rejected ? "Rejected" : "Application Review";
    const reason = rejected
      ? qualification.evidence
          .filter((e) => !e.matched)
          .map((e) => e.reason)
          .join("; ")
      : null;
    const name = String(
      input.fieldSubmissions.find((a) => a.path === "_systemfield_name")
        ?.value || "",
    ).trim();
    const email = String(
      input.fieldSubmissions.find((a) => a.path === "_systemfield_email")
        ?.value || "",
    )
      .trim()
      .toLowerCase();
    const source = input.utmData?.utm_source?.trim() || "Direct";
    const guards: string[] = [
      "EXISTS (SELECT 1 FROM hub_jobs WHERE id=? AND status='open' AND form_version=?)",
    ];
    const guardValues: Bind[] = [posting.id, posting.formVersion];
    for (const file of fileEntries) {
      guards.push(
        "EXISTS (SELECT 1 FROM hub_files WHERE id=? AND job_id=? AND field_path=? AND session_hash=? AND uploaded_at>0 AND expires_at>? AND application_id IS NULL)",
      );
      guardValues.push(file.id, posting.id, file.path, sessionHash, now);
    }
    // A NOT NULL failure aborts the entire D1 batch if a posting/file changes between validation and commit.
    const insert = this.stmt(
      `INSERT INTO hub_applications (id,submission_key_hash,fingerprint,session_hash,job_id,job_title,form_version,name,email,stage,qualification,qualification_json,answers_json,fields_json,utm_json,source,rejection_reason,archive_project,archive_country,hiring_round,revision,stage_entered_at,created_at,updated_at) SELECT CASE WHEN EXISTS (SELECT 1 FROM hub_applications WHERE id=? AND fingerprint=? AND session_hash=?) OR (NOT EXISTS (SELECT 1 FROM hub_applications WHERE id=?) AND ${guards.join(" AND ")}) THEN ? ELSE NULL END,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,? ON CONFLICT(id) DO NOTHING`,
      id,
      fingerprint,
      sessionHash,
      id,
      ...guardValues,
      id,
      keyHash,
      fingerprint,
      sessionHash,
      posting.id,
      posting.title,
      posting.formVersion,
      name,
      email,
      stage,
      qualification.qualification,
      JSON.stringify(qualification.evidence),
      JSON.stringify(answers),
      JSON.stringify(posting.fields),
      JSON.stringify(input.utmData || {}),
      source,
      reason,
      posting.archiveProject || posting.title,
      posting.archiveCountry || "International",
      posting.hiringRound || posting.title,
      now,
      now,
      now,
    );
    const statements = [
      insert,
      ...fileEntries.map((file) =>
        this.stmt(
          "UPDATE hub_files SET application_id=? WHERE id=? AND session_hash=? AND (application_id IS NULL OR application_id=?)",
          id,
          file.id,
          sessionHash,
          id,
        ),
      ),
      this.historyStatement(
        `accepted:${id}`,
        id,
        "application",
        "Application received",
        "candidate",
        now,
      ),
      this.taskStatement(
        `drive:${id}:initial`,
        id,
        "drive",
        { applicationId: id },
        now,
      ),
      ...this.mailStatements(
        `gmail:${id}:confirmation`,
        { id, email },
        `Application received: ${posting.title}`,
        `Hi ${name},\n\nWe received your application for ${posting.title} at AI Case Leads. Our hiring team will review it and contact you about next steps.\n\nAI Case Leads Hiring Team`,
        now,
      ),
    ];
    if (rejected)
      statements.push(
        this.historyStatement(
          `rejected:${id}`,
          id,
          "stage",
          reason || "Approved requirements not met",
          "approved screening rules",
          now,
          "Application Review",
          "Rejected",
        ),
        ...this.mailStatements(
          `gmail:${id}:rejection`,
          { id, email },
          "Your application to AI Case Leads",
          template(posting.rejectionTemplate, name, posting.title),
          now,
        ),
      );
    try {
      await this.db.batch([...statements, ...acceptanceStatements]);
    } catch {
      throw new HiringError(
        "submission_conflict",
        409,
        "The job, upload, or submission changed. Refresh before trying again.",
      );
    }
    const saved = await this.stmt(
      "SELECT fingerprint,session_hash FROM hub_applications WHERE id=?",
      id,
    ).first<{ fingerprint: string; session_hash: string }>();
    if (
      !saved ||
      saved.fingerprint !== fingerprint ||
      saved.session_hash !== sessionHash
    )
      throw conflict();
    return { id };
  }
  async applicationRow(id: string): Promise<ApplicationRow> {
    const row = await this.stmt(
      "SELECT * FROM hub_applications WHERE id=?",
      id,
    ).first<ApplicationRow>();
    if (!row)
      throw new HiringError(
        "application_not_found",
        404,
        "This application was not found.",
      );
    return row;
  }
  private applicationSelection(filters:ApplicationFilters) {
    if ((filters.grade || filters.sort === "grade_desc") && !filters.jobId)
      throw new HiringError("job_required_for_grading",422,"Choose one role before filtering or sorting reviewer grades.");
    const where:string[] = [], values:Bind[] = [];
    if(filters.q) {where.push("(instr(lower(a.name),lower(?))>0 OR instr(lower(a.email),lower(?))>0)");values.push(filters.q,filters.q);}
    for(const [key,column] of [["jobId","job_id"],["stage","stage"],["assignee","assignee"],["qualification","qualification"]] as const)
      if(filters[key]) {where.push(`a.${column}=?`);values.push(filters[key]!);}
    if(filters.duplicate) where.push("EXISTS (SELECT 1 FROM hub_applications duplicate WHERE duplicate.email=a.email AND duplicate.id<>a.id)");
    const graded = !!filters.grade || filters.sort === "grade_desc";
    const cte = graded ? "WITH latest_scores AS (SELECT c.application_id,c.score,row_number() OVER (PARTITION BY c.application_id,lower(trim(c.actor)) ORDER BY c.created_at DESC,c.id DESC) AS n FROM hub_scorecards c JOIN hub_applications j ON j.id=c.application_id WHERE j.job_id=? AND c.score BETWEEN 1 AND 5 AND trim(c.actor)<>''), grades AS (SELECT application_id,AVG(score) AS average_score FROM latest_scores WHERE n=1 GROUP BY application_id) " : "";
    const join = graded ? " LEFT JOIN grades g ON g.application_id=a.id" : "";
    if(filters.grade) where.push(filters.grade === "reviewed" ? "g.average_score IS NOT NULL" : "g.average_score IS NULL");
    const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const order = filters.sort === "grade_desc" ? "CASE WHEN a.stage NOT IN ('Rejected','Withdrawn','Hired') AND g.average_score IS NOT NULL THEN 0 WHEN a.stage NOT IN ('Rejected','Withdrawn','Hired') THEN 1 ELSE 2 END,g.average_score DESC,a.created_at DESC,a.id" : "a.created_at DESC,a.id";
    return {cte,join,clause,order,values:graded?[filters.jobId!,...values]:values};
  }
  private async summaries(rows:ApplicationRow[]):Promise<ApplicationSummary[]> {
    const cards = new Map<string,{id:string;actor:string;score:number;criteria:string;text:string;createdAt:number}[]>();
    // D1 accepts at most 100 bound parameters per statement.
    for(let offset=0;offset<rows.length;offset+=100) {
      const ids=rows.slice(offset,offset+100).map((row)=>row.id);
      // List/export grades need numbers only. Full reviewer evidence stays in detail.
      const selected = await this.rows<{id:string;application_id:string;actor:string;score:number;created_at:number}>(`SELECT id,application_id,actor,score,created_at FROM hub_scorecards WHERE application_id IN (${ids.map(()=>"?").join(",")})`,...ids);
      for(const card of selected) {const bucket=cards.get(card.application_id)||[];bucket.push({id:card.id,actor:card.actor,score:card.score,criteria:"",text:"",createdAt:card.created_at});cards.set(card.application_id,bucket);}
    }
    return rows.map((row)=>({...summary(row),grade:gradeForScorecards(cards.get(row.id)||[])}));
  }
  async applications(filters:ApplicationFilters={}) {
    const selected=this.applicationSelection(filters), page=Math.max(1,Math.min(100000,filters.page||1)),pageSize=30;
    const count=await this.stmt(`${selected.cte}SELECT COUNT(*) AS total FROM hub_applications a${selected.join}${selected.clause}`,...selected.values).first<{total:number}>();
    const rows=await this.rows<ApplicationRow>(`${selected.cte}SELECT ${SUMMARY_COLUMNS.split(",").map((column)=>`a.${column}`).join(",")},(SELECT COUNT(*) FROM hub_applications d WHERE d.email=a.email) AS duplicate_application_count FROM hub_applications a${selected.join}${selected.clause} ORDER BY ${selected.order} LIMIT ? OFFSET ?`,...selected.values,pageSize,(page-1)*pageSize);
    return {items:await this.summaries(rows),total:count?.total||0,page,pageSize};
  }
  async exportApplications(filters:ApplicationFilters={}) {
    const selected=this.applicationSelection(filters),limit=1000;
    const count=await this.stmt(`${selected.cte}SELECT COUNT(*) AS total FROM hub_applications a${selected.join}${selected.clause}`,...selected.values).first<{total:number}>();
    const rows=await this.rows<ApplicationRow>(`${selected.cte}SELECT ${SUMMARY_COLUMNS.split(",").map((column)=>`a.${column}`).join(",")},(SELECT COUNT(*) FROM hub_applications d WHERE d.email=a.email) AS duplicate_application_count FROM hub_applications a${selected.join}${selected.clause} ORDER BY ${selected.order} LIMIT ?`,...selected.values,limit);
    return {items:await this.summaries(rows),total:count?.total||0,truncated:(count?.total||0)>limit,limit};
  }
  async getApplication(id: string): Promise<ApplicationDetail> {
    const app = await this.applicationRow(id);
    const [files,history,communications,assessments,interviews,scorecards,links] = await Promise.all([
      this.rows<{id:string;filename:string;content_type:string;size:number}>("SELECT id,filename,content_type,size FROM hub_files WHERE application_id=? ORDER BY filename",id),
      this.rows<{id:string;type:string;text:string;actor:string;created_at:number}>("SELECT * FROM hub_history WHERE application_id=? ORDER BY created_at,id",id),
      this.rows<{id:string;subject:string;body:string;status:string;created_at:number}>("SELECT * FROM hub_communications WHERE application_id=? ORDER BY created_at DESC,id",id),
      this.rows<{id:string;status:"invited"|"submitted";prompt:string;answer:string|null;submitted_at:number|null}>("SELECT * FROM hub_assessments WHERE application_id=? ORDER BY created_at DESC,id DESC",id),
      this.rows<InterviewRow>("SELECT * FROM hub_interviews WHERE application_id=? ORDER BY created_at DESC,id DESC",id),
      this.rows<{id:string;actor:string;score:number;criteria:string;text:string;created_at:number}>("SELECT * FROM hub_scorecards WHERE application_id=? ORDER BY created_at DESC,id",id),
      this.rows<{kind:string;payload_json:string;expires_at:number;used_at:number|null}>("SELECT kind,payload_json,expires_at,used_at FROM hub_links WHERE application_id=?",id),
    ]);
    const events = history.map((h) => ({id:h.id,type:h.type,text:h.text,actor:h.actor,createdAt:h.created_at}));
    const linkInfo = (kind:"assessment"|"interview",itemId:string) => {
      const matching = links.filter((link) => link.kind === kind && decode<Record<string,unknown>>(link.payload_json,{})[`${kind}Id`] === itemId);
      const current = matching.sort((a,b) => Number(b.used_at === null)-Number(a.used_at === null) || b.expires_at-a.expires_at)[0];
      return current ? {linkExpiresAt:current.expires_at,linkActive:current.used_at === null && current.expires_at > Date.now()} : {};
    };
    const allAssessments:Assessment[] = assessments.map((item) => ({id:item.id,status:item.status,prompt:item.prompt,...(item.answer !== null?{answer:item.answer}:{}),...(item.submitted_at?{submittedAt:item.submitted_at}:{}),...linkInfo("assessment",item.id)}));
    const allInterviews:Interview[] = interviews.map((item) => ({id:item.id,revision:item.revision,status:item.status as Interview["status"],...(item.start?{start:item.start}:{}),...(item.end?{end:item.end}:{}),...(item.time_zone?{timeZone:item.time_zone}:{}),...(item.calendar_id?{calendarId:item.calendar_id}:{}),...(item.meet_url?{meetUrl:item.meet_url}:{}),...(item.attended !== null?{attended:!!item.attended}:{}),...linkInfo("interview",item.id)}));
    const duplicateCount = await this.stmt("SELECT COUNT(*) AS count FROM hub_applications WHERE email=?",app.email).first<{count:number}>();
    const cards = scorecards.map((card) => ({id:card.id,actor:card.actor,score:card.score,criteria:card.criteria,text:card.text,createdAt:card.created_at}));
    return {...summary(app),archiveProject:app.archive_project || undefined,archiveCountry:app.archive_country || undefined,hiringRound:app.hiring_round || undefined,revision:app.revision,formVersion:app.form_version,utmData:decode(app.utm_json,{}),
      duplicateEmail:(duplicateCount?.count || 1)>1,duplicateApplicationCount:duplicateCount?.count || 1,grade:gradeForScorecards(cards),
      answers:decode(app.answers_json,[]),fields:decode(app.fields_json,[]),qualificationEvidence:decode(app.qualification_json,[]),
      files:files.map((file) => ({id:file.id,filename:file.filename,contentType:file.content_type,size:file.size,url:`/api/files/${encodeURIComponent(file.id)}`})),
      history:events,notes:events.filter((event) => event.type === "note"),
      communications:communications.map((item) => ({id:item.id,subject:item.subject,body:item.body,status:item.status,createdAt:item.created_at})),
      assessments:allAssessments,interviews:allInterviews,
      ...(allAssessments[0]?{assessment:allAssessments[0]}:{}),...(allInterviews[0]?{interview:allInterviews[0]}:{}),scorecards:cards};
  }
  async overview() {
    const counts = await this.stmt("SELECT COUNT(*) AS applications,COALESCE(SUM(stage NOT IN ('Rejected','Withdrawn','Hired')),0) AS active,COALESCE(SUM(stage='Rejected'),0) AS rejected,COALESCE(SUM(stage='Hired'),0) AS hired FROM hub_applications").first<{applications:number;active:number;rejected:number;hired:number}>();
    const stageCounts=await this.rows<{stage:string;count:number}>("SELECT stage,COUNT(*) AS count FROM hub_applications GROUP BY stage");
    const recent=await this.rows<ApplicationRow>(`SELECT ${SUMMARY_COLUMNS.split(",").map((column)=>`a.${column}`).join(",")},(SELECT COUNT(*) FROM hub_applications d WHERE d.email=a.email) AS duplicate_application_count FROM hub_applications a ORDER BY a.created_at DESC,a.id LIMIT 12`);
    return {counts:counts||{applications:0,active:0,rejected:0,hired:0},stageCounts,recentApplications:await this.summaries(recent),integrations:this.options.integrations||{google:false,drive:false,applicationsEnabled:false},jobs:await this.listJobs()};
  }
  async members(): Promise<Member[]> {
    return (
      await this.rows<{
        id: string;
        email: string;
        role: Member["role"];
        active: number;
      }>("SELECT id,email,role,active FROM hub_members ORDER BY email")
    ).map((row) => ({ ...row, active: row.active === 1 }));
  }
  async scheduling(): Promise<Scheduling> {
    const [
      timeZone,
      startHour,
      endHour,
      durationMinutes,
      weekdays,
      calendarId,
      approved,
      remindersEnabled,
    ] = await Promise.all([
      this.setting("interview_time_zone", ""),
      this.setting("interview_start_hour", 10),
      this.setting("interview_end_hour", 16),
      this.setting("interview_duration_minutes", 30),
      this.setting<number[]>("interview_weekdays", [1, 2, 3, 4, 5]),
      this.setting("google_calendar_id", ""),
      this.setting("interview_availability_approved", false),
      this.setting("interview_reminders_enabled", false),
    ]);
    return {
      timeZone,
      startHour,
      endHour,
      durationMinutes,
      weekdays,
      remindersEnabled,
      configured: !!timeZone && !!calendarId && approved && startHour < endHour,
    };
  }
  async settings() {
    const [
      members,
      sender,
      calendarId,
      driveRootId,
      rejectionTemplate,
      scheduling,
      queue,
    ] = await Promise.all([
      this.members(),
      this.setting("google_sender", ""),
      this.setting("google_calendar_id", ""),
      this.setting("google_drive_root_id", ""),
      this.setting("rejection_template", DEFAULT_REJECTION),
      this.scheduling(),
      this.rows<{ status: string; count: number }>(
        "SELECT status,COUNT(*) AS count FROM hub_tasks GROUP BY status",
      ),
    ]);
    return {
      settingsVersion: await this.setting("staff_settings_version", 1),
      accessAudit: await this.auditLog(50),
      members,
      google: {
        connected: !!this.options.integrations?.google,
        expectedSender: this.options.expectedRecruitingSender || "",
        sender,
        calendarId,
        driveRootId,
      },
      scheduling,
      queue: {
        pending: queue
          .filter((q) => ["pending", "running"].includes(q.status))
          .reduce((s, q) => s + q.count, 0),
        failed: queue
          .filter((q) => ["failed", "uncertain"].includes(q.status))
          .reduce((s, q) => s + q.count, 0),
      },
      mailSync: {
        lastCheckedAt: await this.setting<number>(
          "mail_sync_last_checked_at",
          0,
        ),
        lastError: await this.setting<string>("mail_sync_last_error", ""),
      },
      templates: { rejection: rejectionTemplate },
      workerHealth: await this.setting<Record<string,unknown>|null>("worker_health", null),
      applicationsEnabled: !!this.options.integrations?.applicationsEnabled,
    };
  }
  async auditLog(limit = 50) {
    return (await this.rows<{id:string;type:string;actor:string;before_json:string;after_json:string;created_at:number}>(
      "SELECT * FROM hub_audit ORDER BY created_at DESC,id DESC LIMIT ?", Math.max(1, Math.min(100, limit)),
    )).map((entry) => ({id:entry.id,type:entry.type,actor:entry.actor,before:decode<Record<string,unknown>>(entry.before_json,{}),after:decode<Record<string,unknown>>(entry.after_json,{}),createdAt:entry.created_at}));
  }
  async saveSettings(input: SettingsInput, member: HubMember) {
    const statements: D1PreparedStatement[] = [];
    const now = Date.now();
    if (!Number.isSafeInteger(input.settingsVersion) || input.settingsVersion < 1)
      throw new HiringError("settings_changed", 409, "Refresh settings before saving your changes.");
    const currentCalendar = await this.setting("google_calendar_id", ""), currentRoot = await this.setting("google_drive_root_id", "");
    const calendarChanged = input.calendarId !== undefined && input.calendarId !== currentCalendar;
    const rootChanged = input.driveRootId !== undefined && input.driveRootId !== currentRoot;
    const calendarBlocked = calendarChanged && !!currentCalendar && !!await this.stmt("SELECT id FROM hub_interviews WHERE start IS NOT NULL AND status IN ('pending','booked','cancel_pending','failed') LIMIT 1").first();
    const rootBlocked = rootChanged && !!currentRoot && (!!await this.stmt("SELECT key FROM archive_items LIMIT 1").first() || !!await this.stmt("SELECT id FROM hub_tasks WHERE kind='drive' LIMIT 1").first() || !!await this.stmt("SELECT id FROM hub_applications WHERE drive_folder_id IS NOT NULL LIMIT 1").first());
    if (calendarBlocked)
      throw new HiringError("calendar_change_blocked", 409, "Cancel and reconcile existing scheduled interviews before changing the recruiting calendar.");
    if (rootBlocked)
      throw new HiringError("drive_root_change_blocked", 409, "The Drive destination is locked after archival is queued. An archive migration requires a separate reviewed operation.");
    const guards: string[] = ["COALESCE((SELECT CAST(value AS INTEGER) FROM hub_settings WHERE key='staff_settings_version'),1)=?"];
    const guardValues: Bind[] = [input.settingsVersion];
    if (calendarChanged) {
      guards.push("COALESCE((SELECT value FROM hub_settings WHERE key='google_calendar_id'),'\"\"')=?");
      guardValues.push(JSON.stringify(currentCalendar));
      if (currentCalendar) guards.push("NOT EXISTS (SELECT 1 FROM hub_interviews WHERE start IS NOT NULL AND status IN ('pending','booked','cancel_pending','failed'))");
    }
    if (rootChanged) {
      guards.push("COALESCE((SELECT value FROM hub_settings WHERE key='google_drive_root_id'),'\"\"')=?");
      guardValues.push(JSON.stringify(currentRoot));
      if (currentRoot) guards.push("NOT EXISTS (SELECT 1 FROM archive_items) AND NOT EXISTS (SELECT 1 FROM hub_tasks WHERE kind='drive') AND NOT EXISTS (SELECT 1 FROM hub_applications WHERE drive_folder_id IS NOT NULL)");
    }
    statements.push(this.stmt(`INSERT INTO hub_settings (key,value,updated_at) SELECT 'staff_settings_version',CASE WHEN ${guards.join(" AND ")} THEN ? ELSE NULL END,? ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`, ...guardValues, JSON.stringify(input.settingsVersion + 1), now));
    const before:Record<string,unknown> = {}, after:Record<string,unknown> = {};
    if (input.members) {
      const normalized = input.members.map((m) => ({
        ...m,
        email: m.email.trim().toLowerCase(),
        active: m.active !== false,
      }));
      if (
        new Set(normalized.map((m) => m.email)).size !== normalized.length ||
        !normalized.some((m) => m.role === "admin" && m.active)
      )
        throw new HiringError(
          "invalid_members",
          422,
          "Members must be unique and include an active manager.",
        );
      before.members = await this.members();
      after.members = normalized;
      statements.push(
        this.stmt("UPDATE hub_members SET active=0,updated_at=?", now),
      );
      for (const value of normalized)
        statements.push(
          this.stmt(
            "INSERT INTO hub_members (id,email,role,active,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET role=excluded.role,active=excluded.active,updated_at=excluded.updated_at",
            value.id || crypto.randomUUID(),
            value.email,
            value.role,
            value.active ? 1 : 0,
            now,
            now,
          ),
        );
    }
    if (input.interviewTimeZone) {
      try {
        new Intl.DateTimeFormat("en", {
          timeZone: input.interviewTimeZone,
        }).format(new Date());
      } catch {
        throw new HiringError(
          "invalid_time_zone",
          422,
          "Choose a valid interview time zone.",
        );
      }
    }
    const merged = {
      ...(await this.scheduling()),
      ...(input.interviewStartHour !== undefined
        ? { startHour: input.interviewStartHour }
        : {}),
      ...(input.interviewEndHour !== undefined
        ? { endHour: input.interviewEndHour }
        : {}),
    };
    if (merged.startHour >= merged.endHour)
      throw new HiringError(
        "invalid_schedule",
        422,
        "Interview end hour must be after start hour.",
      );
    for (const [key, setting] of [
      ["calendarId", "google_calendar_id"],
      ["driveRootId", "google_drive_root_id"],
      ["rejectionTemplate", "rejection_template"],
      ["interviewTimeZone", "interview_time_zone"],
      ["interviewStartHour", "interview_start_hour"],
      ["interviewEndHour", "interview_end_hour"],
      ["interviewDurationMinutes", "interview_duration_minutes"],
      ["interviewWeekdays", "interview_weekdays"],
      ["interviewRemindersEnabled", "interview_reminders_enabled"],
    ] as const)
      if (input[key] !== undefined) {
        before[key] = await this.setting(setting, null);
        after[key] = input[key];
        statements.push(this.settingStatement(setting, input[key]));
      }
    if (
      input.interviewTimeZone !== undefined &&
      input.interviewStartHour !== undefined &&
      input.interviewEndHour !== undefined &&
      input.interviewDurationMinutes !== undefined &&
      input.interviewWeekdays !== undefined
    )
      statements.push(
        this.settingStatement("interview_availability_approved", true),
      );
    statements.push(this.stmt("INSERT INTO hub_audit (id,type,actor,before_json,after_json,created_at) VALUES (?,'settings',?,?,?,?)",crypto.randomUUID(),member.email,JSON.stringify(before),JSON.stringify(after),now));
    try { await this.db.batch(statements); } catch {
      throw new HiringError("settings_changed", 409, "Settings or integration work changed before this save. Refresh settings and review the current access list before retrying.");
    }
    return this.settings();
  }
  async reports() {
    const apps = await this.rows<ApplicationRow>(
      "SELECT id,created_at,stage,qualification FROM hub_applications",
    );
    const stages = await this.rows<{
      application_id: string;
      from_stage: Stage | null;
      to_stage: Stage | null;
      created_at: number;
    }>(
      "SELECT application_id,from_stage,to_stage,created_at FROM hub_history WHERE type='stage' ORDER BY created_at,id",
    );
    const stageCounts = await this.rows<{ stage: string; count: number }>(
      "SELECT stage,COUNT(*) AS count FROM hub_applications GROUP BY stage",
    );
    const sources = await this.rows<{
      source: string;
      count: number;
      qualified: number;
      interviewed: number;
      hired: number;
    }>(
      `SELECT a.source,COUNT(*) AS count,
        SUM(CASE WHEN a.qualification='pass' THEN 1 ELSE 0 END) AS qualified,
        SUM(CASE WHEN a.stage='Interview' OR EXISTS (SELECT 1 FROM hub_history h WHERE h.application_id=a.id AND h.type='stage' AND h.to_stage='Interview') THEN 1 ELSE 0 END) AS interviewed,
        SUM(CASE WHEN a.stage='Hired' THEN 1 ELSE 0 END) AS hired
        FROM hub_applications a GROUP BY a.source ORDER BY count DESC,a.source`,
    );
    const workload = await this.rows<{
      assignee: string | null;
      count: number;
    }>(
      "SELECT assignee,COUNT(*) AS count FROM hub_applications WHERE stage NOT IN ('Rejected','Withdrawn','Hired') GROUP BY assignee",
    );
    const attendance = await this.stmt(
      "SELECT COALESCE(SUM(CASE WHEN attended=1 THEN 1 ELSE 0 END),0) AS attended,COUNT(*) AS total FROM hub_interviews WHERE attended IS NOT NULL",
    ).first<{ attended: number; total: number }>();
    const durations = new Map<string, number[]>();
    const visited = new Map<string, Set<string>>();
    const now = Date.now();
    const stagesByApplication = new Map<string, typeof stages>();
    for(const change of stages) {const changes=stagesByApplication.get(change.application_id)||[];changes.push(change);stagesByApplication.set(change.application_id,changes);}
    for (const app of apps) {
      let previous = app.created_at,
        stage: Stage = "Application Review";
      const seen = new Set<string>([stage]);
      for (const change of stagesByApplication.get(app.id) || []) {
        if (change.from_stage) {
          const list = durations.get(change.from_stage) || [];
          list.push(Math.max(0, change.created_at - previous));
          durations.set(change.from_stage, list);
        }
        previous = change.created_at;
        if (change.to_stage) {
          stage = change.to_stage;
          seen.add(stage);
        }
      }
      if (!["Hired", "Rejected", "Withdrawn"].includes(stage)) {
        const list = durations.get(stage) || [];
        list.push(Math.max(0, now - previous));
        durations.set(stage, list);
      }
      visited.set(app.id, seen);
    }
    return {
      applications: apps.length,
      qualificationRate: apps.length
        ? apps.filter((a) => a.qualification === "pass").length / apps.length
        : 0,
      stageCounts,
      sources: sources.map((source) => ({
        ...source,
        qualificationRate: source.qualified / source.count,
        interviewRate: source.interviewed / source.count,
        hireRate: source.hired / source.count,
      })),
      timeInStage: [...durations].map(([stage, values]) => ({
        stage,
        averageHours:
          values.reduce((a, b) => a + b, 0) / values.length / 3600000,
      })),
      workload: workload.map((w) => ({
        assignee: w.assignee || "Unassigned",
        count: w.count,
      })),
      attendance: attendance || { attended: 0, total: 0 },
      conversion: [
        "Application Review",
        "Screening",
        "Assessment",
        "Interview",
        "Offer",
        "Hired",
      ].map((stage) => ({
        stage,
        count: [...visited.values()].filter((v) => v.has(stage)).length,
      })),
    };
  }
  private mutationStatement(
    app: ApplicationRow,
    now: number,
    stage = app.stage,
    assignee = app.assignee,
    reason = app.rejection_reason,
  ) {
    return this.stmt(
      "UPDATE hub_applications SET id=CASE WHEN revision=? THEN id ELSE NULL END,stage=?,assignee=?,rejection_reason=?,stage_entered_at=CASE WHEN stage<>? THEN ? ELSE stage_entered_at END,revision=revision+1,updated_at=? WHERE id=?",
      app.revision,
      stage,
      assignee,
      reason,
      stage,
      now,
      now,
      app.id,
    );
  }
  private async hasActiveInvitation(applicationId:string,kind:"assessment"|"interview",itemId:string,now:number) {
    return !!await this.stmt(`SELECT token_hash FROM hub_links WHERE application_id=? AND kind=? AND json_extract(payload_json,'$.${kind}Id')=? AND used_at IS NULL AND expires_at>? LIMIT 1`,applicationId,kind,itemId,now).first();
  }
  private cancelInvitationStatements(applicationId:string,kind:"assessment"|"interview",now:number) {
    return [this.stmt("UPDATE hub_tasks SET status='done',result_json=?,last_error=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE application_id=? AND kind='gmail' AND status IN ('pending','failed') AND instr(id,?)=1",JSON.stringify({stale:true,cancelled:true}),now,applicationId,`gmail:${applicationId}:${kind}:`),
      this.stmt("UPDATE hub_communications SET status='cancelled',updated_at=? WHERE application_id=? AND task_id IN (SELECT id FROM hub_tasks WHERE application_id=? AND kind='gmail' AND status='done' AND json_extract(result_json,'$.cancelled')=1)",now,applicationId,applicationId)];
  }
  private async actionStatements(
    app: ApplicationRow,
    input: ActionInput,
    member: HubMember,
  ): Promise<D1PreparedStatement[]> {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)
      throw conflict();
    if (input.action === "email") {
      if (!input.actionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.actionId))
        throw new HiringError("email_action_required", 422, "Refresh the email action before submitting.");
      const previous = await this.stmt("SELECT payload_json FROM hub_tasks WHERE id=?",`gmail:${app.id}:manual:${input.actionId.toLowerCase()}`).first<{payload_json:string}>();
      if (previous) {
        const payload = decode<Record<string,unknown>>(previous.payload_json,{});
        if (payload.to !== app.email || payload.subject !== input.subject?.trim() || payload.body !== input.body || payload.actor !== member.email)
          throw new HiringError("email_action_conflict",409,"This email action was already saved with different content. Refresh the application before composing a new email.");
        return [];
      }
    }
    if (input.expectedRevision !== app.revision) throw conflict();
    const now = Date.now(),
      eventId = crypto.randomUUID();
    let stage = app.stage,
      assignee = app.assignee,
      reason = app.rejection_reason;
    const statements: D1PreparedStatement[] = [];
    let text = "";
    switch (input.action) {
      case "stage":
        if (!input.stage)
          throw new HiringError(
            "invalid_stage",
            422,
            "Choose the next hiring stage.",
          );
        if (input.stage === "Rejected")
          throw new HiringError(
            "rejection_reason_required",
            422,
            "Use Reject and record a rejection reason.",
          );
        stage = input.stage;
        text = `Moved to ${stage}`;
        if (stage === app.stage) return [];
        break;
      case "assign":
        if (input.assignee === undefined)
          throw new HiringError(
            "assignee_required",
            422,
            "Choose a hiring team member or unassign this application.",
          );
        if (input.assignee) {
          const assigned = await this.stmt(
            "SELECT email FROM hub_members WHERE (id=? OR email=?) AND active=1",
            input.assignee,
            input.assignee.toLowerCase(),
          ).first<{ email: string }>();
          if (!assigned && input.assignee.toLowerCase() !== member.email)
            throw new HiringError(
              "invalid_assignee",
              422,
              "Choose an active hiring team member.",
            );
          assignee = assigned?.email || member.email;
        } else assignee = null;
        if (assignee === app.assignee) return [];
        text = assignee ? `Assigned to ${assignee}` : "Assignment removed";
        break;
      case "reject":
        if (!input.reason?.trim())
          throw new HiringError(
            "reason_required",
            422,
            "Record a reason for this hiring decision.",
          );
        if (app.stage === "Rejected") return [];
        stage = "Rejected";
        reason = input.reason.trim();
        text = reason;
        {
          const posting = await this.getJob(app.job_id);
          statements.push(
            ...this.mailStatements(
              `gmail:${app.id}:rejection:${app.revision + 1}`,
              summary(app),
              "Your application to AI Case Leads",
              template(posting.rejectionTemplate, app.name, app.job_title),
              now,
            ),
          );
        }
        break;
      case "note":
        if (!input.text?.trim())
          throw new HiringError("note_required", 422, "Enter a note.");
        text = input.text.trim();
        break;
      case "email":
        if (!input.subject?.trim() || !input.body?.trim())
          throw new HiringError(
            "email_required",
            422,
            "Enter an email subject and message.",
          );
        {
          const mailId = `gmail:${app.id}:manual:${input.actionId!.toLowerCase()}`;
          statements.push(
            ...this.mailStatements(
              mailId,
              summary(app),
              input.subject.trim(),
              input.body,
              now,
              input.body,
              {metadata:{actor:member.email,actionId:input.actionId!.toLowerCase()}},
            ),
          );
          text = `Email queued: ${input.subject.trim()}`;
        }
        break;
      case "scorecard":
        if (input.score === undefined || !input.criteria?.trim())
          throw new HiringError(
            "scorecard_required",
            422,
            "Record a score and the assessed criteria.",
          );
        statements.push(
          this.stmt(
            "INSERT INTO hub_scorecards (id,application_id,actor,score,criteria,text,created_at) VALUES (?,?,?,?,?,?,MAX(?,COALESCE((SELECT MAX(created_at) FROM hub_scorecards WHERE application_id=? AND lower(trim(actor))=?),?-1)+1))",
            eventId,
            app.id,
            member.email,
            input.score,
            input.criteria.trim(),
            input.text?.trim() || "",
            now,
            app.id,
            member.email.trim().toLowerCase(),
            now,
          ),
        );
        text = `Scorecard recorded: ${input.score}/5`;
        break;
      case "attendance":
        if (input.attended === undefined)
          throw new HiringError(
            "attendance_required",
            422,
            "Choose attended or missed.",
          );
        {
          const interview = await this.latestInterview(app.id);
          if (!interview || !["booked", "cancelled"].includes(interview.status))
            throw new HiringError(
              "interview_required",
              422,
              "Record attendance for a scheduled interview.",
            );
          statements.push(
            this.stmt(
              "UPDATE hub_interviews SET attended=?,updated_at=? WHERE id=?",
              input.attended ? 1 : 0,
              now,
              interview.id,
            ),
          );
          text = input.attended ? "Interview attended" : "Interview missed";
        }
        break;
      case "assessment": {
        if (["Rejected", "Withdrawn", "Hired"].includes(app.stage))
          throw new HiringError(
            "application_inactive",
            422,
            "Reopen this application before sending an assessment.",
          );
        const posting = await this.getJob(app.job_id);
        const current = await this.stmt(
          "SELECT id,status,prompt FROM hub_assessments WHERE application_id=? ORDER BY created_at DESC,id DESC LIMIT 1",
          app.id,
        ).first<{ id: string; status: string; prompt: string }>();
        const prompt = input.renew && current?.status === "invited" ? current.prompt : input.text?.trim() || posting.assessmentPrompt?.trim();
        if (!prompt)
          throw new HiringError(
            "assessment_required",
            422,
            "Enter the role assessment prompt.",
          );
        const renewing = current?.status === "invited" && current.prompt === prompt;
        if (renewing && !input.renew && await this.hasActiveInvitation(app.id,"assessment",current.id,now)) return [];
        if (!this.options.origin)
          throw new HiringError(
            "site_unavailable",
            503,
            "The candidate website is not configured.",
          );
        const assessmentId = renewing ? current.id : crypto.randomUUID(),
          token = privateToken(),
          tokenHash = await sha256(token);
        const url = `${this.options.origin}/assessment/${token}`;
        statements.push(
          ...this.cancelInvitationStatements(app.id,"assessment",now),
          this.stmt(
            "UPDATE hub_links SET used_at=? WHERE application_id=? AND kind='assessment' AND used_at IS NULL",
            now,
            app.id,
          ),
          ...(!renewing ? [this.stmt(
            "INSERT INTO hub_assessments (id,application_id,status,prompt,created_at) VALUES (?,?,'invited',?,?)",
            assessmentId,
            app.id,
            prompt,
            now,
          )] : []),
          this.stmt(
            "INSERT INTO hub_links (token_hash,application_id,kind,expires_at,payload_json) VALUES (?,?,'assessment',?,?)",
            tokenHash,
            app.id,
            now + 7 * 86400000,
            JSON.stringify({ assessmentId }),
          ),
          ...this.mailStatements(
            `gmail:${app.id}:assessment:${assessmentId}:invitation:${app.revision + 1}`,
            summary(app),
            `Assessment invitation: ${app.job_title}`,
            `Hi ${app.name},\n\nYou are invited to complete the next assessment for ${app.job_title}. Use your private link within seven days:\n${url}\n\nAI Case Leads Hiring Team`,
            now,
            "Assessment invitation with a private candidate link.",
          ),
        );
        stage = renewing ? app.stage : "Assessment";
        text = renewing ? "Assessment invitation renewed and queued" : "Assessment invitation queued";
        break;
      }
      case "interview": {
        if (["Rejected", "Withdrawn", "Hired"].includes(app.stage))
          throw new HiringError(
            "application_inactive",
            422,
            "Reopen this application before inviting an interview.",
          );
        if (
          !(await this.scheduling()).configured ||
          !this.options.integrations?.google
        )
          throw new HiringError(
            "scheduling_not_configured",
            422,
            "Connect Google Workspace and save the calendar, interview time zone, and availability before inviting interviews.",
          );
        const existing = await this.latestInterview(app.id);
        const renewing = existing && existing.status !== "cancelled";
        if (renewing && !input.renew && await this.hasActiveInvitation(app.id,"interview",existing.id,now)) return [];
        if (!this.options.origin)
          throw new HiringError(
            "site_unavailable",
            503,
            "The candidate website is not configured.",
          );
        const interviewId = renewing ? existing.id : crypto.randomUUID(),
          token = privateToken(),
          hash = await sha256(token),
          calendarId = await this.setting("google_calendar_id", "");
        const url = `${this.options.origin}/interview/${token}`;
        statements.push(
          ...this.cancelInvitationStatements(app.id,"interview",now),
          this.stmt(
            "UPDATE hub_links SET used_at=? WHERE application_id=? AND kind='interview' AND used_at IS NULL",
            now,
            app.id,
          ),
          ...(!renewing ? [this.stmt(
            "INSERT INTO hub_interviews (id,application_id,status,calendar_id,revision,created_at,updated_at) VALUES (?,?,'invited',?,1,?,?)",
            interviewId,
            app.id,
            calendarId,
            now,
            now,
          )] : []),
          this.stmt(
            "INSERT INTO hub_links (token_hash,application_id,kind,expires_at,payload_json) VALUES (?,?,'interview',?,?)",
            hash,
            app.id,
            Math.max(now + 14 * 86400000, renewing && existing.end && Number.isFinite(Date.parse(existing.end)) ? Date.parse(existing.end) + 86400000 : 0),
            JSON.stringify({ interviewId }),
          ),
          ...this.mailStatements(
            `gmail:${app.id}:interview:${interviewId}:invitation:${app.revision + 1}`,
            summary(app),
            `Interview invitation: ${app.job_title}`,
            `Hi ${app.name},\n\nYou are invited to interview for ${app.job_title}. Choose a time using your private link within fourteen days:\n${url}\n\nAI Case Leads Hiring Team`,
            now,
            "Interview invitation with a private candidate link.",
          ),
        );
        stage = renewing ? app.stage : "Interview";
        text = renewing ? "Interview invitation renewed and queued" : "Interview invitation queued";
        break;
      }
    }
    if (
      stage !== app.stage &&
      ["Rejected", "Withdrawn", "Hired"].includes(stage)
    ) {
      statements.push(
        this.stmt(
          "UPDATE hub_links SET used_at=? WHERE application_id=? AND used_at IS NULL",
          now,
          app.id,
        ),
        this.stmt(
          "UPDATE hub_tasks SET status='done',result_json=?,last_error=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE application_id=? AND kind='gmail' AND status IN ('pending','failed') AND (id LIKE '%:assessment:%' OR id LIKE '%:interview:%')",
          JSON.stringify({ stale: true, cancelled: true }),
          now,
          app.id,
        ),
        this.stmt(
          "UPDATE hub_communications SET status='cancelled',updated_at=? WHERE application_id=? AND task_id IN (SELECT id FROM hub_tasks WHERE application_id=? AND kind='gmail' AND status='done' AND json_extract(result_json,'$.cancelled')=1)",
          now,
          app.id,
          app.id,
        ),
      );
      const future = await this.rows<InterviewRow>(
        "SELECT * FROM hub_interviews WHERE application_id=? AND status IN ('booked','pending','failed') AND start>?",
        app.id,
        new Date(now).toISOString(),
      );
      for (const interview of future) {
        const revision = interview.revision + 1;
        statements.push(
          this.stmt(
            "UPDATE hub_interviews SET id=CASE WHEN revision=? THEN id ELSE NULL END,status='cancel_pending',revision=revision+1,updated_at=? WHERE id=?",
            interview.revision,
            now,
            interview.id,
          ),
          this.taskStatement(
            `calendar:${interview.id}:revision:${revision}`,
            app.id,
            "calendar",
            {
              operation: "cancel",
              interviewId: interview.id,
              id: interview.id,
              revision,
              calendarId: interview.calendar_id,
            },
            now,
          ),
        );
      }
    }
    const type = stage !== app.stage ? "stage" : input.action;
    return [
      this.mutationStatement(app, now, stage, assignee, reason),
      ...statements,
      this.historyStatement(
        eventId,
        app.id,
        type,
        text,
        member.email,
        now,
        stage !== app.stage ? app.stage : null,
        stage !== app.stage ? stage : null,
      ),
      this.taskStatement(
        `drive:${app.id}:revision:${app.revision + 1}`,
        app.id,
        "drive",
        { applicationId: app.id },
        now,
      ),
    ];
  }
  async action(
    id: string,
    input: ActionInput,
    member: HubMember,
  ): Promise<ApplicationDetail> {
    const app = await this.applicationRow(id);
    const statements = await this.actionStatements(app, input, member);
    if (statements.length) {
      try {
        await this.db.batch(statements);
      } catch (error) {
        if (error instanceof HiringError) throw error;
        throw conflict();
      }
    }
    return this.getApplication(id);
  }
  async bulk(ids: string[], input: Omit<BulkInput,"ids">, member: HubMember) {
    if (new Set(ids).size !== ids.length)
      throw new HiringError(
        "invalid_bulk",
        422,
        "Choose each application once.",
      );
    if (!input.expectedRevisions || Object.keys(input.expectedRevisions).length !== ids.length || ids.some((id) => !Number.isSafeInteger(input.expectedRevisions[id]) || input.expectedRevisions[id] < 1)) throw conflict();
    const statements: D1PreparedStatement[] = [];
    for (const id of ids)
      statements.push(
        ...(await this.actionStatements(
          await this.applicationRow(id),
          { ...input, expectedRevision: input.expectedRevisions[id] },
          member,
        )),
      );
    try {
      if (statements.length) await this.db.batch(statements);
    } catch {
      throw conflict();
    }
    return { updated: ids.length };
  }
  async latestInterview(applicationId: string): Promise<InterviewRow | null> {
    return this.stmt(
      "SELECT * FROM hub_interviews WHERE application_id=? ORDER BY created_at DESC,id DESC LIMIT 1",
      applicationId,
    ).first<InterviewRow>();
  }
  async tasks(page = 1): Promise<Task[]> {
    const selected = Math.max(1, Math.min(10000, page));
    return (
      await this.rows<TaskRow>(
        "SELECT * FROM hub_tasks ORDER BY CASE WHEN status IN ('failed','uncertain') THEN 0 WHEN status IN ('running','pending') THEN 1 ELSE 2 END,created_at,id LIMIT 200 OFFSET ?",
        (selected - 1) * 200,
      )
    ).map(task);
  }
  async claimTask(now: number): Promise<Task | null> {
    // An expired mail lease means the provider may have sent it. Only explicit reconciliation may resolve it.
    await this.db.batch([
      this.stmt(
        "UPDATE hub_tasks SET status='uncertain',last_error='Mail worker lease expired; reconcile delivery before retrying',lease_until=NULL,updated_at=? WHERE kind='gmail' AND status='running' AND lease_until<=?",
        now,
        now,
      ),
      this.stmt(
        "UPDATE hub_communications SET status='uncertain',updated_at=? WHERE task_id IN (SELECT id FROM hub_tasks WHERE kind='gmail' AND status='uncertain')",
        now,
      ),
      this.stmt(
        "UPDATE hub_tasks SET status='failed',last_error='Worker lease expired after the retry limit; staff recovery is required',lease_until=NULL,updated_at=? WHERE kind<>'gmail' AND status='running' AND lease_until<=? AND attempts>=8",
        now,
        now,
      ),
    ]);
    const token = privateToken();
    const eligible =
      "((candidate.status IN ('pending','failed') AND candidate.run_after<=? AND candidate.attempts<8) OR (candidate.kind='calendar' AND candidate.status='uncertain' AND candidate.run_after<=? AND candidate.attempts<8) OR (candidate.kind<>'gmail' AND candidate.status='running' AND candidate.lease_until<=? AND candidate.attempts<8))";
    const row = await this.stmt(
      `UPDATE hub_tasks SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=(SELECT candidate.id FROM hub_tasks candidate WHERE ${eligible} AND NOT EXISTS (SELECT 1 FROM hub_tasks active WHERE active.application_id=candidate.application_id AND active.id<>candidate.id AND active.status='running' AND active.lease_until>?) ORDER BY candidate.run_after,candidate.created_at,candidate.id LIMIT 1) RETURNING *`,
      token,
      now + 10 * 60000,
      now,
      now,
      now,
      now,
      now,
    ).first<TaskRow>();
    if (row?.kind === "calendar") {
      const payload = decode<Record<string, unknown>>(row.payload_json, {});
      await this.stmt(
        "UPDATE hub_interviews SET status=?,updated_at=? WHERE id=? AND revision=? AND status='failed' AND EXISTS (SELECT 1 FROM hub_tasks WHERE id=? AND lease_token=? AND status='running')",
        payload.operation === "cancel" ? "cancel_pending" : "pending",
        now,
        String(payload.interviewId || ""),
        Number(payload.revision) || 1,
        row.id,
        token,
      ).run();
    }
    return row ? task(row) : null;
  }
  async finishTask(
    id: string,
    leaseToken: string,
    result: {
      status: Task["status"];
      result?: Record<string, unknown>;
      error?: string;
      runAfter?: number;
    },
  ): Promise<void> {
    const now = Date.now();
    const current = await this.stmt(
      "SELECT * FROM hub_tasks WHERE id=? AND lease_token=? AND status='running' AND lease_until>?",
      id,
      leaseToken,
      now,
    ).first<TaskRow>();
    if (!current)
      throw new HiringError(
        "task_lease_lost",
        409,
        "This task lease is no longer valid.",
      );
    if (result.status === "running")
      throw new HiringError(
        "invalid_task_status",
        422,
        "Choose a finished or retryable task state.",
      );
    const statements = [
      this.stmt(
        "UPDATE hub_tasks SET run_after=CASE WHEN lease_token=? AND status='running' AND lease_until>? THEN ? ELSE NULL END,status=?,result_json=?,last_error=?,lease_until=NULL,updated_at=? WHERE id=?",
        leaseToken,
        now,
        result.runAfter || now,
        result.status,
        result.result ? JSON.stringify(result.result) : null,
        result.error?.slice(0, 1000) || null,
        now,
        id,
      ),
    ];
    const completed =
      "EXISTS (SELECT 1 FROM hub_tasks WHERE id=? AND lease_token=? AND status=? AND updated_at=?)";
    if (current.kind === "gmail")
      statements.push(
        this.stmt(
          `UPDATE hub_communications SET status=?,provider_id=COALESCE(?,provider_id),thread_id=COALESCE(?,thread_id),updated_at=? WHERE task_id=? AND ${completed}`,
          result.status === "done"
            ? result.result?.stale === true
              ? "cancelled"
              : "sent"
            : result.status,
          typeof result.result?.id === "string" ? result.result.id : null,
          typeof result.result?.threadId === "string"
            ? result.result.threadId
            : null,
          now,
          id,
          id,
          leaseToken,
          result.status,
          now,
        ),
      );
    if (
      current.kind === "drive" &&
      result.status === "done" &&
      typeof result.result?.folderId === "string" &&
      typeof result.result?.folderUrl === "string"
    )
      statements.push(
        this.stmt(
          `UPDATE hub_applications SET drive_folder_id=?,drive_folder_url=? WHERE id=? AND ${completed}`,
          result.result.folderId,
          result.result.folderUrl,
          current.application_id,
          id,
          leaseToken,
          result.status,
          now,
        ),
      );
    if (current.kind === "calendar" && result.result?.stale !== true) {
      const payload = decode<Record<string, unknown>>(current.payload_json, {});
      const interviewId = String(payload.interviewId || "");
      const revision =
        typeof payload.revision === "number" ? payload.revision : 1;
      if (result.status === "done" && payload.operation === "cancel")
        statements.push(
          this.stmt(
            `UPDATE hub_interviews SET status='cancelled',updated_at=? WHERE id=? AND revision=? AND ${completed}`,
            now,
            interviewId,
            revision,
            id,
            leaseToken,
            result.status,
            now,
          ),
          this.stmt(
            `DELETE FROM hub_reservations WHERE interview_id=? AND EXISTS (SELECT 1 FROM hub_interviews WHERE id=? AND status='cancelled' AND revision=?) AND ${completed}`,
            interviewId,
            interviewId,
            revision,
            id,
            leaseToken,
            result.status,
            now,
          ),
        );
      else if (result.status === "done")
        statements.push(
          this.stmt(
            `UPDATE hub_interviews SET status='booked',provider_id=COALESCE(?,provider_id),meet_url=COALESCE(?,meet_url),updated_at=? WHERE id=? AND revision=? AND ${completed}`,
            typeof result.result?.id === "string" ? result.result.id : null,
            typeof result.result?.meetUrl === "string"
              ? result.result.meetUrl
              : null,
            now,
            interviewId,
            revision,
            id,
            leaseToken,
            result.status,
            now,
          ),
        );
      else if (result.status === "failed")
        statements.push(
          this.stmt(
            `UPDATE hub_interviews SET status='failed',updated_at=? WHERE id=? AND revision=? AND ${completed}`,
            now,
            interviewId,
            revision,
            id,
            leaseToken,
            result.status,
            now,
          ),
        );
    }
    if (
      current.kind === "calendar" &&
      result.status === "done" &&
      result.result?.stale !== true &&
      (await this.setting("interview_reminders_enabled", false)) === true
    ) {
      const payload = decode<Record<string, unknown>>(current.payload_json, {}),
        start = String(payload.start || ""),
        startMs = Date.parse(start),
        timeZone = String(payload.timeZone || ""),
        interviewId = String(payload.interviewId || ""),
        revision = Number(payload.revision);
      const meetUrl =
        typeof result.result?.meetUrl === "string" ? result.result.meetUrl : "";
      let verifiedMeet = false;
      try {
        const url = new URL(meetUrl);
        verifiedMeet =
          url.origin === "https://meet.google.com" &&
          !url.username &&
          !url.password;
      } catch {}
      if (
        ["create", "update"].includes(String(payload.operation)) &&
        Number.isFinite(startMs) &&
        startMs > now &&
        verifiedMeet &&
        interviewId &&
        Number.isSafeInteger(revision) &&
        revision > 0
      ) {
        let formatted: string | undefined;
        try {
          formatted = new Intl.DateTimeFormat("en", {
            dateStyle: "full",
            timeStyle: "long",
            timeZone,
          }).format(startMs);
        } catch {}
        if (formatted) {
          const app = await this.applicationRow(current.application_id);
          for (const [label, hours] of [
            ["24h", 24],
            ["1h", 1],
          ] as const) {
            const runAfter = startMs - hours * 3600000;
            if (runAfter <= now) continue;
            const reminderId = `gmail:${app.id}:reminder:${interviewId}:${revision}:${label}`,
              subject = `Interview reminder: ${app.job_title}`,
              body = `Hi ${app.name},\n\nYour interview for ${app.job_title} is scheduled for ${formatted}.\nTime zone: ${timeZone}\nGoogle Meet: ${meetUrl}\n\nAI Case Leads Hiring Team`;
            statements.push(
              ...this.mailStatements(
                reminderId,
                summary(app),
                subject,
                body,
                now,
                body,
                {
                  runAfter,
                  metadata: {
                    reminder: true,
                    interviewId,
                    revision,
                    interviewStart: start,
                  },
                  guard: {
                    sql: `EXISTS (SELECT 1 FROM hub_settings WHERE key='interview_reminders_enabled' AND value='true') AND EXISTS (SELECT 1 FROM hub_interviews i JOIN hub_applications a ON a.id=i.application_id WHERE i.id=? AND i.application_id=? AND i.revision=? AND i.status='booked' AND i.start=? AND i.meet_url=? AND a.stage NOT IN ('Rejected','Withdrawn','Hired')) AND ${completed}`,
                    values: [
                      interviewId,
                      app.id,
                      revision,
                      start,
                      meetUrl,
                      id,
                      leaseToken,
                      result.status,
                      now,
                    ],
                  },
                },
              ),
            );
          }
        }
      }
    }
    if (current.kind !== "drive") {
      const communicationStatus = result.status === "done" ? result.result?.stale === true ? "cancelled" : "sent" : result.status;
      const semanticGuard = current.kind === "gmail" ? "EXISTS (SELECT 1 FROM hub_communications c WHERE c.task_id=? AND (c.status<>? OR COALESCE(?,c.provider_id) IS NOT c.provider_id OR COALESCE(?,c.thread_id) IS NOT c.thread_id))" : "1=1";
      const semanticValues:Bind[] = current.kind === "gmail" ? [id,communicationStatus,typeof result.result?.id === "string"?result.result.id:null,typeof result.result?.threadId === "string"?result.result.threadId:null] : [];
      // Check the old communication inside the winning transaction, before updating it.
      statements.splice(1,0,
        this.stmt(`UPDATE hub_applications SET revision=revision+1,updated_at=? WHERE id=? AND ${completed} AND ${semanticGuard}`,now,current.application_id,id,leaseToken,result.status,now,...semanticValues),
        this.stmt(`INSERT INTO hub_tasks (id,application_id,kind,payload_json,status,attempts,run_after,created_at,updated_at) SELECT 'drive:'||a.id||':effect:'||a.revision,a.id,'drive',?,'pending',0,?,?,? FROM hub_applications a WHERE a.id=? AND ${completed} AND changes()=1 ON CONFLICT(id) DO NOTHING`,JSON.stringify({applicationId:current.application_id}),now,now,now,current.application_id,id,leaseToken,result.status,now));
    }
    try {
      const outcome = await this.db.batch(statements);
      if (outcome[0].meta.changes !== 1)
        throw new HiringError(
          "task_lease_lost",
          409,
          "Another worker already finished this task.",
        );
    } catch {
      throw new HiringError(
        "task_lease_lost",
        409,
        "Another worker already finished this task or the task changed.",
      );
    }
  }
  async retryTask(id: string): Promise<Task> {
    const current = await this.stmt(
      "SELECT * FROM hub_tasks WHERE id=?",
      id,
    ).first<TaskRow>();
    if (!current)
      throw new HiringError("task_not_found", 404, "This task was not found.");
    if (current.status === "uncertain" && current.kind !== "calendar")
      throw new HiringError(
        "task_uncertain",
        409,
        "Delivery is uncertain. Reconcile the provider result before retrying.",
      );
    if (
      current.status !== "failed" &&
      !(current.kind === "calendar" && current.status === "uncertain")
    )
      throw new HiringError(
        "task_not_retryable",
        409,
        "Only failed tasks or Calendar tasks with an uncertain outcome can be recovered.",
      );
    const now = Date.now();
    const guards = [
      "status=?",
      "attempts=?",
      "updated_at=?",
      "lease_token IS ?",
      "payload_json=?",
    ];
    const values: Bind[] = [
      current.status,
      current.attempts,
      current.updated_at,
      current.lease_token,
      current.payload_json,
    ];
    const payload = decode<Record<string, unknown>>(current.payload_json, {});
    if (current.kind === "calendar") {
      const interviewId =
        typeof payload.interviewId === "string" ? payload.interviewId : "";
      const revision =
        typeof payload.revision === "number" &&
        Number.isSafeInteger(payload.revision) &&
        payload.revision > 0
          ? payload.revision
          : 0;
      if (
        !interviewId ||
        !revision ||
        !["create", "update", "cancel"].includes(String(payload.operation))
      )
        throw new HiringError(
          "task_not_retryable",
          409,
          "This Calendar task has no valid interview identity to reconcile.",
        );
      guards.push(
        "EXISTS (SELECT 1 FROM hub_interviews i JOIN hub_applications a ON a.id=i.application_id WHERE i.id=? AND i.application_id=? AND i.revision=? AND i.status IN ('pending','cancel_pending','failed') AND (?='cancel' OR a.stage NOT IN ('Rejected','Withdrawn','Hired')))",
      );
      values.push(
        interviewId,
        current.application_id,
        revision,
        String(payload.operation),
      );
    }
    const statements = [
      this.stmt(
        `UPDATE hub_tasks SET run_after=CASE WHEN ${guards.join(" AND ")} THEN ? ELSE NULL END,status='pending',attempts=0,lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=? WHERE id=?`,
        ...values,
        now,
        now,
        id,
      ),
    ];
    if (current.kind === "gmail")
      statements.push(
        this.stmt(
          "UPDATE hub_communications SET status='pending',updated_at=? WHERE task_id=?",
          now,
          id,
        ),
      );
    if (current.kind === "calendar")
      statements.push(
        this.stmt(
          "UPDATE hub_interviews SET status=?,updated_at=? WHERE id=? AND revision=? AND status='failed'",
          payload.operation === "cancel" ? "cancel_pending" : "pending",
          now,
          String(payload.interviewId),
          Number(payload.revision),
        ),
      );
    try {
      const results = await this.db.batch(statements);
      if (results[0].meta.changes !== 1) throw new Error("retry_lost");
    } catch {
      throw new HiringError(
        "task_changed",
        409,
        "This task or interview changed before recovery. Refresh its status before retrying.",
      );
    }
    return task(
      (await this.stmt(
        "SELECT * FROM hub_tasks WHERE id=?",
        id,
      ).first<TaskRow>())!,
    );
  }
  async candidateLink(tokenHash: string, now = Date.now()): Promise<LinkRow> {
    const link = await this.stmt(
      "SELECT * FROM hub_links WHERE token_hash=? AND expires_at>?",
      tokenHash,
      now,
    ).first<LinkRow>();
    if (!link)
      throw new HiringError(
        "link_unavailable",
        404,
        "This private link expired or is unavailable. Contact the hiring team for a new invitation.",
      );
    return link;
  }
}

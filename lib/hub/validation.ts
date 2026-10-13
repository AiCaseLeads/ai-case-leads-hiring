import { z } from "zod";
import { HiringError } from "../hiring/errors";
import type { ApplicationField, FieldSubmission } from "../hiring/types";
import { STAGES, type Rule, type QualificationEvidence } from "./types";
const field = z
  .object({
    path: z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/),
    title: z.string().trim().min(1).max(160),
    type: z.enum([
      "String",
      "Email",
      "File",
      "Date",
      "Number",
      "Boolean",
      "LongText",
      "ValueSelect",
      "MultiValueSelect",
      "Phone",
      "SocialLink",
      "Score",
      "Url",
    ]),
    required: z.boolean(),
    options: z
      .array(
        z
          .object({
            value: z.string().min(1).max(300),
            label: z.string().min(1).max(300),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    description: z.string().max(2000).optional(),
  })
  .strict();
const rule = z
  .object({
    fieldPath: z.string().min(1).max(128),
    operator: z.enum(["equals", "not_equals", "contains", "gte", "lte"]),
    value: z.union([z.string().max(2000), z.number().finite(), z.boolean()]),
    reason: z.string().trim().min(1).max(500),
    enabled: z.boolean(),
  })
  .strict();
export const jobInput = z
  .object({
    title: z.string().trim().min(1).max(160),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(160),
    department: z.string().trim().max(160),
    descriptionHtml: z.string().max(100000),
    location: z.string().trim().max(200).optional(),
    archiveProject: z.string().trim().max(120).optional(),
    archiveCountry: z.string().trim().max(120).optional(),
    hiringRound: z.string().trim().max(120).optional(),
    status: z.enum(["draft", "open", "closed"]),
    fields: z.array(field).max(100),
    rules: z.array(rule).max(100),
    autoReject: z.boolean(),
    rejectionTemplate: z.string().trim().min(1).max(10000).optional(),
    assessmentPrompt: z.string().max(20000).optional(),
  })
  .strict();
export type JobInput = z.infer<typeof jobInput>;
export const jobPatchInput = jobInput
  .partial()
  .extend({ formVersion: z.number().int().min(1).optional() })
  .strict();
export const actionInput = z
  .object({
    expectedRevision: z.number().int().positive().safe(),
    actionId: z.string().uuid().optional(),
    renew: z.boolean().optional(),
    interviewerEmail: z.string().trim().email().transform(value=>value.toLowerCase()).optional(),
    action: z.enum([
      "stage",
      "note",
      "assign",
      "reject",
      "assessment",
      "interview",
      "email",
      "scorecard",
      "attendance",
    ]),
    stage: z.enum(STAGES).optional(),
    text: z.string().max(20000).optional(),
    assignee: z.string().max(200).nullable().optional(),
    reason: z.string().trim().max(2000).optional(),
    subject: z.string().trim().max(300).optional(),
    body: z.string().max(20000).optional(),
    score: z.number().finite().min(1).max(5).optional(),
    criteria: z.string().trim().max(10000).optional(),
    attended: z.boolean().optional(),
  })
  .strict().superRefine((input, context) => {
    if (input.action === "email" && !input.actionId)
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["actionId"], message: "A unique email action ID is required." });
    if (input.renew && !["assessment", "interview"].includes(input.action))
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["renew"], message: "Only candidate invitations can be renewed." });
  });
export type ActionInput = z.infer<typeof actionInput>;
export const bulkInput = z
  .object({
    ids: z.array(z.string().min(1).max(128)).min(1).max(100),
    expectedRevisions: z.record(z.number().int().positive().safe()),
    action: z.enum(["stage", "assign", "reject"]),
    stage: z.enum(STAGES).optional(),
    assignee: z.string().max(200).nullable().optional(),
    reason: z.string().trim().max(2000).optional(),
  })
  .strict().superRefine((input, context) => {
    if (new Set(input.ids).size !== input.ids.length || Object.keys(input.expectedRevisions).length !== input.ids.length || input.ids.some((id) => !Object.hasOwn(input.expectedRevisions, id)))
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["expectedRevisions"], message: "Supply the displayed revision for every selected application." });
  });
export type BulkInput = z.infer<typeof bulkInput>;
export const settingsInput = z
  .object({
    settingsVersion: z.number().int().positive().safe(),
    members: z
      .array(
        z
          .object({
            id: z.string().max(128).optional(),
            email: z.string().email().max(200),
            role: z.enum(["admin", "recruiter"]),
            active: z.boolean().optional(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    calendarId: z.string().trim().max(300).optional(),
    driveRootId: z.string().trim().max(300).optional(),
    rejectionTemplate: z.string().trim().min(1).max(10000).optional(),
    interviewTimeZone: z.string().trim().max(100).optional(),
    interviewRemindersEnabled: z.boolean().optional(),
    interviewStartHour: z.number().int().min(0).max(23).optional(),
    interviewEndHour: z.number().int().min(1).max(24).optional(),
    interviewDurationMinutes: z.number().int().min(15).max(120).optional(),
    interviewWeekdays: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .optional(),
  })
  .strict();
export type SettingsInput = z.infer<typeof settingsInput>;
export const candidateInput = z
  .object({
    action: z.enum(["assessment", "book", "reschedule", "cancel"]),
    answer: z.string().trim().max(50000).optional(),
    start: z.string().datetime().optional(),
    timeZone: z.string().max(100).optional(),
  })
  .strict();
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HiringError(
      "invalid_request",
      422,
      result.error.issues[0]?.message || "Check the supplied details.",
    );
  return result.data;
}
export function validateJob(input: JobInput): void {
  if (input.fields.filter((field) => field.type === "File").length > 5)
    throw new HiringError(
      "invalid_job",
      422,
      "Use at most five file fields per application.",
    );
  if (new Set(input.fields.map((f) => f.path)).size !== input.fields.length)
    throw new HiringError(
      "invalid_job",
      422,
      "Application field paths must be unique.",
    );
  for (const field of input.fields)
    if (
      (field.type === "ValueSelect" || field.type === "MultiValueSelect") &&
      (!field.options?.length ||
        new Set(field.options.map((o) => o.value)).size !==
          field.options.length)
    )
      throw new HiringError(
        "invalid_job",
        422,
        "Select fields need unique answer options.",
      );
  for (const rule of input.rules) {
    const field = input.fields.find((f) => f.path === rule.fieldPath);
    if (!field || field.type === "File")
      throw new HiringError(
        "invalid_rule",
        422,
        "Screening rules must reference an existing answer field.",
      );
    if (
      ["gte", "lte"].includes(rule.operator) &&
      (!["Number", "Score"].includes(field.type) ||
        typeof rule.value !== "number")
    )
      throw new HiringError(
        "invalid_rule",
        422,
        "Numeric screening comparisons require a numeric answer and value.",
      );
    if (rule.operator === "contains" && typeof rule.value !== "string")
      throw new HiringError(
        "invalid_rule",
        422,
        "Contains comparisons require text.",
      );
    if (
      field.type === "Boolean" &&
      (!["equals", "not_equals"].includes(rule.operator) ||
        typeof rule.value !== "boolean")
    )
      throw new HiringError(
        "invalid_rule",
        422,
        "Boolean screening comparisons require a boolean value.",
      );
    if (
      ["Number", "Score"].includes(field.type) &&
      (!["equals", "not_equals", "gte", "lte"].includes(rule.operator) ||
        typeof rule.value !== "number")
    )
      throw new HiringError(
        "invalid_rule",
        422,
        "Numeric screening rules require a numeric expected value.",
      );
    if (
      !["Number", "Score", "Boolean"].includes(field.type) &&
      typeof rule.value !== "string"
    )
      throw new HiringError(
        "invalid_rule",
        422,
        "Text screening rules require a text expected value.",
      );
    if (
      ["ValueSelect", "MultiValueSelect"].includes(field.type) &&
      (!["equals", "not_equals"].includes(rule.operator) ||
        !field.options?.some((option) => option.value === rule.value))
    )
      throw new HiringError(
        "invalid_rule",
        422,
        "Select screening rules must use an existing answer option.",
      );
  }
  if (input.autoReject && !input.rules.some((r) => r.enabled))
    throw new HiringError(
      "invalid_rule",
      422,
      "Approve and enable at least one screening requirement before activating automatic rejection.",
    );
  if (input.status === "open") {
    if (!input.descriptionHtml.trim())
      throw new HiringError(
        "invalid_job",
        422,
        "Approve a job description before opening applications.",
      );
    if (
      !input.fields.some(
        (f) =>
          f.path === "_systemfield_name" && f.type === "String" && f.required,
      ) ||
      !input.fields.some(
        (f) =>
          f.path === "_systemfield_email" && f.type === "Email" && f.required,
      )
    )
      throw new HiringError(
        "invalid_job",
        422,
        "Open jobs need required Name and Email fields with system field paths.",
      );
  }
}
const escape = (text: string) =>
  text
    .replace(
      /&(amp|lt|gt|quot|apos|#39);/gi,
      (_, entity: string) =>
        ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" })[
          entity.toLowerCase()
        ]!,
    )
    .replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch]!,
    );
/** Permit formatting tags without attributes. Arbitrary HTML, URLs, scripts and styles are escaped. */
export function sanitizeDescription(html: string): string {
  let result = "",
    position = 0;
  const matcher = /<[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(html))) {
    result += escape(html.slice(position, match.index));
    const tag =
      /^<\s*(\/?)\s*(p|br|ul|ol|li|h2|h3|h4|strong|em|b|i|blockquote)(?:\s[^<>]*)?\s*\/?\s*>$/i.exec(
        match[0],
      );
    result += tag ? `<${tag[1]}${tag[2].toLowerCase()}>` : escape(match[0]);
    position = matcher.lastIndex;
  }
  return result + escape(html.slice(position));
}
export function evaluateRequirements(
  rules: Rule[],
  answers: FieldSubmission[],
  fields: ApplicationField[],
): {
  qualification: "pass" | "review" | "fail";
  evidence: QualificationEvidence[];
} {
  const active = rules.filter((r) => r.enabled);
  const values = new Map(answers.map((a) => [a.path, a.value]));
  let unknown = false;
  const evidence = active.map((rule) => {
    let value = values.get(rule.fieldPath);
    if (
      fields.find((f) => f.path === rule.fieldPath)?.type === "Score" &&
      value &&
      typeof value === "object"
    )
      value = (value as { score?: number }).score;
    const missing =
      value == null || value === "" || (Array.isArray(value) && !value.length);
    if (missing) unknown = true;
    let matched = false;
    if (!missing) {
      switch (rule.operator) {
        case "equals":
          matched = Array.isArray(value)
            ? value.includes(rule.value)
            : typeof value === "string" && typeof rule.value === "string"
              ? value.trim().toLowerCase() === rule.value.trim().toLowerCase()
              : value === rule.value;
          break;
        case "not_equals":
          matched = Array.isArray(value)
            ? !value.includes(rule.value)
            : typeof value === "string" && typeof rule.value === "string"
              ? value.trim().toLowerCase() !== rule.value.trim().toLowerCase()
              : value !== rule.value;
          break;
        case "contains":
          matched =
            typeof value === "string" &&
            typeof rule.value === "string" &&
            value.toLowerCase().includes(rule.value.toLowerCase());
          break;
        case "gte":
          matched =
            typeof value === "number" &&
            typeof rule.value === "number" &&
            value >= rule.value;
          break;
        case "lte":
          matched =
            typeof value === "number" &&
            typeof rule.value === "number" &&
            value <= rule.value;
          break;
      }
    }
    return {
      fieldPath: rule.fieldPath,
      reason: rule.reason,
      matched,
      value: value ?? null,
    };
  });
  // Missing information always needs a person; it is never grounds for an automatic rejection.
  return {
    qualification:
      unknown || !active.length
        ? "review"
        : evidence.some((e) => !e.matched)
          ? "fail"
          : "pass",
    evidence,
  };
}

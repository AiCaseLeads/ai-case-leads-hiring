import { teamInputSchema } from "../job-team/service";
import { z } from "zod";
import { jobInput } from "../hub/validation";
import { rubricSchema } from "../scorecards/model";
export const locationInput = z
  .object({
    workModel: z.enum(["remote", "hybrid", "onsite"]),
    country: z.string().trim().min(1).max(120),
    city: z.string().trim().max(120),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.workModel !== "remote" && (!v.city || v.country === "International"))
      c.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose a country and city for an office-based job.",
      });
  });
export type WorkLocation = z.infer<typeof locationInput>;
export type JobTemplate = {
  id: string;
  name: string;
  sourceJobId: string;
  job: z.infer<typeof jobInput>;
  location: WorkLocation | null;
  scorecard?: { templateId: string; version: number };
  createdAt: number;
};
export type JobRequest = {
  id: string;
  title: string;
  location: WorkLocation;
  description: string;
  reason: string;
  createdBy: string;
  createdAt: number;
  status: "pending" | "used";
  jobId?: string;
};
export type SetupCatalog = {
  defaultRejectionTemplate?: string;
  revision: number;
  templates: JobTemplate[];
  requests: JobRequest[];
  locations: Record<string, WorkLocation>;
};
export const emptySetup: SetupCatalog = {
  revision: 0,
  templates: [],
  requests: [],
  locations: {},
};
export const catalogCommand = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("template"),
      expectedRevision: z.number().int().min(0),
      sourceJobId: z.string().min(1).max(128),
      name: z.string().trim().min(1).max(120),
    })
    .strict(),
  z
    .object({
      action: z.literal("request"),
      expectedRevision: z.number().int().min(0),
      title: z.string().trim().min(1).max(160),
      location: locationInput,
      description: z.string().max(100000),
      reason: z.string().trim().min(1).max(2000),
    })
    .strict(),
]);
export const saveCommand = z
  .object({
    action: z.literal("save"),
    creationId: z.string().uuid(),
    jobId: z.string().min(1).max(128).optional(),
    formVersion: z.number().int().positive().optional(),
    expectedLifecycleRevision: z.number().int().nonnegative().safe().optional(),
    job: jobInput,
    hiringTeam:teamInputSchema.optional(),
    expectedTeamRevision:z.number().int().min(0).optional(),
    location: locationInput.nullable(),
    requestId: z.string().uuid().optional(),
    expectedBinding: z
      .object({
        templateId: z.string().uuid(),
        version: z.number().int().positive(),
      })
      .strict()
      .nullable(),
    scorecard: z
      .object({
        templateId: z.string().uuid(),
        version: z.number().int().positive(),
      })
      .strict()
      .nullable(),
    rubric: rubricSchema.optional(),
  })
  .strict();
export function publicLocation(location: WorkLocation) {
  const place =
    location.country === "International"
      ? "Worldwide"
      : [location.city, location.country].filter(Boolean).join(", ");
  return `${location.workModel === "remote" ? "Remote" : location.workModel === "hybrid" ? "Hybrid" : "On-site"} · ${place}`;
}
export const defaultAnchors: [string, string, string, string, string] = [
  "Does not demonstrate the criterion",
  "Limited supporting evidence",
  "Demonstrates the criterion",
  "Strong supporting evidence",
  "Exceptional supporting evidence",
];
export function inferredLocation(job: {
  location?: string;
  archiveCountry?: string;
}): WorkLocation {
  const value = job.location || "";
  const structured = /^(Remote|Hybrid|On-site) · (.+)$/.exec(value);
  if (structured) {
    const parts = structured[2].split(", ");
    return {
      workModel:
        structured[1] === "Remote"
          ? "remote"
          : structured[1] === "Hybrid"
            ? "hybrid"
            : "onsite",
      country: structured[2] === "Worldwide" ? "International" : parts.at(-1)!,
      city: parts.length > 1 ? parts.slice(0, -1).join(", ") : "",
    };
  }
  return {
    workModel: "remote",
    country: job.archiveCountry || "International",
    city: "",
  };
}

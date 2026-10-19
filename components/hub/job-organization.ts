import type { HubJob } from "./types";
import type { ApplicationField } from "@/lib/hiring/types";

export function jobGroup(job: HubJob) { return job.archiveProject?.trim() || job.title; }
// Archive country is authoritative: older postings may have a different public location.
export function jobLocation(job: HubJob) { return job.archiveCountry?.trim() || "International"; }
export function jobBatch(job: HubJob) { return job.hiringRound?.trim() || "Original batch"; }
export function jobChoices(values: string[]) { return [...new Set(values)].sort((a, b) => a.localeCompare(b)); }
export function matchingJobs(jobs: HubJob[], group: string, location: string) {
  return jobs.filter(job => (!group || jobGroup(job) === group) && (!location || jobLocation(job) === location));
}
export function nextBatch(jobs: HubJob[], group: string, location: string) {
  const names = new Set(matchingJobs(jobs, group, location).map(job => jobBatch(job).toLowerCase()));
  let number = 1;
  while (names.has(`batch ${number}`)) number++;
  return `Batch ${number}`;
}
export function availableJobSlug(title: string, location: string, batch: string, jobs: HubJob[]) {
  const base = [title, location, batch].filter(Boolean).join("-").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 140).replace(/-+$/, "") || "job";
  const used = new Set(jobs.map(job => job.slug));
  let value = base, suffix = 2;
  while (used.has(value)) value = `${base}-${suffix++}`;
  return value;
}

export const experienceQuestions: ApplicationField[] = [
  { path: "experience_summary", title: "Relevant work experience", type: "LongText", required: false, description: "Describe your roles, employers, dates, and responsibilities in your own words. We may ask you to explain this work during an interview." },
  { path: "work_sample_contribution", title: "Your contribution to a work sample", type: "LongText", required: false, description: "If you shared a portfolio or work sample, explain what you personally did. Do not share confidential client information." },
  { path: "accuracy_confirmation", title: "I confirm that my experience and work samples accurately represent my work", type: "Boolean", required: true },
];
export function withExperienceQuestions(fields: ApplicationField[]) {
  const existing = new Set(fields.map(field => field.path));
  return [...fields, ...experienceQuestions.filter(field => !existing.has(field.path)).map(field => ({ ...field }))];
}

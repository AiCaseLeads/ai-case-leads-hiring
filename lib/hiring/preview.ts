import type { ApplicationField, Job } from "./types";

/** These are setup previews, not published Ashby postings. They cannot receive applications. */
export const previewJobs: Job[] = [
  { id: "preview-engineer", slug: "full-stack-engineer", title: "Full-stack Engineer", department: "Engineering", descriptionHtml: "<p>Help build the software behind AI Case Leads.</p><p>The full job description, compensation, and application requirements will be published when this role opens.</p>" },
  { id: "preview-creative", slug: "creative-strategist", title: "Creative Strategist", department: "Creative", descriptionHtml: "<p>Help shape creative work at AI Case Leads.</p><p>The full job description, compensation, and application requirements will be published when this role opens.</p>" },
];
export const previewFields: ApplicationField[] = [
  { path: "_systemfield_name", title: "Full name", type: "String", required: true },
  { path: "_systemfield_email", title: "Email address", type: "Email", required: true },
  { path: "_systemfield_resume", title: "Resume", type: "File", required: true },
  { path: "portfolio", title: "Portfolio or work samples", type: "SocialLink", required: false },
];

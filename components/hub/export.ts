import type { ApplicationDetail, ApplicationSummary } from "./types";

export function applicationsCsv(items: ApplicationSummary[]) {
  const cell = (value: unknown) => {
    let text = value == null ? "" : String(value);
    if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows = [["Application ID", "Name", "Email", "Role", "Stage", "Qualification", "Average reviewer score (1–5)", "Reviewers", "Assigned to", "Source", "Applied (UTC)", "Shared email"]];
  for (const app of items) rows.push([app.id, app.name, app.email, app.jobTitle, app.stage, app.qualification, app.grade?.averageScore == null ? "Ungraded" : String(app.grade.averageScore), String(app.grade?.reviewerCount || 0), app.assignee || "", app.source, new Date(app.createdAt).toISOString(), app.duplicateEmail ? "Yes" : "No"]);
  return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
export function downloadFile(contents: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadApplication(detail: ApplicationDetail) {
  downloadFile(JSON.stringify(detail, null, 2), `application-${detail.id}.json`, "application/json");
}

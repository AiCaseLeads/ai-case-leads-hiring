import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import type { ApplicationField, FieldSubmission } from "../hiring/types";

type Entry = Record<string, unknown>;
/** The same readable representation is used for downloads and immutable Drive revisions. */
export interface ReadableApplication {
  id: string; name: string; jobId: string; jobTitle: string;
  revision?: number; email?: string; stage?: string; qualification?: string;
  assignee?: string | null; createdAt?: number; source?: string;
  archiveProject?: string; archiveCountry?: string; hiringRound?: string;
  formVersion?: number; answers?: FieldSubmission[]; fields?: ApplicationField[];
  questions?: ApplicationField[];
  files?: Array<{ id: string; filename: string; size: number; contentType?: string; url?: string }>;
  qualificationEvidence?: unknown[]; history?: unknown[]; communications?: unknown[];
  assessments?: unknown[]; assessment?: unknown; interviews?: unknown[]; interview?: unknown;
  scorecards?: unknown[]; grade?: unknown; aiMatch?: unknown; utmData?: unknown;
  jobDescription?: { descriptionHtml: string; formVersion: number; location?: string };
}

let fonts: Promise<[Uint8Array, Uint8Array]> | undefined;
function fontBytes() {
  // Bundled licensed fonts: no network request and no candidate data leaves the server.
  fonts ??= Promise.all(["NotoSans-Regular.ttf", "NotoSans-Bold.ttf"].map(name =>
    readFile(path.join(process.cwd(), "lib/pdf/fonts", name)).then(bytes => new Uint8Array(bytes)))) as Promise<[Uint8Array, Uint8Array]>;
  return fonts;
}
function record(value: unknown): Entry {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Entry : {};
}
function rows(value: unknown): Entry[] { return Array.isArray(value) ? value.map(record) : []; }
function words(value: string) { return value.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, first => first.toUpperCase()); }
function criteriaText(value: unknown) {
  if (typeof value === "string" && /^[\[{]/.test(value.trim())) {
    try { return text(JSON.parse(value)); } catch { /* A human-written criterion can contain braces. */ }
  }
  return text(value);
}
function activityText(item:Entry, currentAi:Entry):string {
  const value=item.text;
  if(typeof value!=='string'||! /^[\[{]/.test(value.trim()))return text(value);
  let parsed:unknown;
  try {parsed=JSON.parse(value);}catch{return value;}
  const saved=record(parsed);
  if(item.type!=='ai_match')return text(parsed);
  const summary=["AI review recorded.",typeof saved.score==='number'?`Evidence match: ${saved.score} / 100.`:'',saved.model?`Model: ${text(saved.model)}.`:'',saved.version?`Job version: ${text(saved.version)}.`:''].filter(Boolean).join(' ');
  if(item.createdAt===currentAi.updatedAt&&saved.score===currentAi.score&&saved.model===currentAi.model) return summary+' See AI job match above for the supporting evidence.';
  const review=record(saved.review), evidence=rows(review.criteria).map((criterion,index)=>[
    `${index+1}. ${text(criterion.criterion)} - ${words(String(criterion.status||'Recorded'))}`,
    text(criterion.explanation),
    ...rows(criterion.citations).map(citation=>`Source: ${words(String(citation.source||'Document'))}\n"${text(citation.quote)}"`),
  ].join('\n'));
  const checks=rows(review.checks).map((check,index)=>[`${index+1}. ${text(check.question)}`,...rows(check.citations).map(citation=>`Source: ${words(String(citation.source||'Document'))}\n"${text(citation.quote)}"`)].join('\n'));
  const warnings=Array.isArray(review.sourceWarnings)?review.sourceWarnings.map(text):[];
  return [summary,...evidence,...(checks.length?['Questions to verify:',...checks]:[]),...warnings].join('\n\n');
}
function text(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(text).join("; ");
  if (typeof value === "object") return Object.entries(record(value)).map(([key, item]) => `${words(key)}: ${text(item)}`).join("\n");
  return String(value);
}
function date(value: unknown): string {
  const parsed = typeof value === "number" || typeof value === "string" ? new Date(value) : new Date(NaN);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : "Not recorded";
}
function stage(value?: string) { return value === "Application Review" ? "New" : value === "Screening" ? "Shortlisted" : value || "Not recorded"; }
function htmlText(value: string) {
  return value.replace(/<\s*(?:script|style)\b[^>]*>[\s\S]*?<\/\s*(?:script|style)>/gi, "")
    .replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/\s*(?:p|div|h[1-6]|li|ul|ol)\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ").replace(/<[^>]*>/g, "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const point = code.toLowerCase().startsWith("x") ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    }).replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'")
    .replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
export function answerText(answer: FieldSubmission, field: ApplicationField | undefined, files: ReadableApplication["files"]): string {
  const plain = (value: unknown): string => {
    if (Array.isArray(value)) return value.map(plain).join("; ");
    if (field?.type === "File" && value) return files?.find(file => file.id === value)?.filename || "Uploaded attachment";
    const option = field?.options?.find(item => item.value === value);
    return option ? option.label : text(value);
  };
  return plain(answer.value);
}

class Report {
  private page!: PDFPage;
  private y = 0;
  private unsupported = false;
  private supported: Set<number>;
  private characters = 0;
  private readonly left = 44;
  private readonly width = 524;
  private readonly ink = rgb(0.08, 0.24, 0.27);
  private readonly muted = rgb(0.33, 0.43, 0.46);
  constructor(private document: PDFDocument, private regular: PDFFont, private bold: PDFFont, private reference: string) {
    this.supported = new Set(regular.getCharacterSet());
    this.newPage();
  }
  private clean(value: string): string {
    return [...value.normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replaceAll("\t", "  ")].map(character => {
      const code = character.codePointAt(0)!;
      if (character === "\n" || this.supported.has(code)) return character;
      // Keep every unsupported code point recoverable rather than silently dropping a name.
      this.unsupported = true;
      return `[U+${code.toString(16).toUpperCase().padStart(4, "0")}]`;
    }).join("");
  }
  private newPage() {
    if (this.document.getPageCount() >= 400) throw new Error("application_pdf_too_large");
    this.page = this.document.addPage([612, 792]);
    this.page.drawText("AI CASE LEADS / RECRUITING", { x: this.left, y: 758, size: 9, font: this.bold, color: this.ink });
    this.page.drawLine({ start: { x: this.left, y: 745 }, end: { x: 568, y: 745 }, thickness: 0.8, color: rgb(0.8, 0.86, 0.86) });
    this.y = 717;
  }
  private ensure(height: number) { if (this.y - height < 57) this.newPage(); }
  private lines(value: string, font: PDFFont, size: number, width = this.width): string[] {
    const lines: string[] = [];
    for (const paragraph of value.split("\n")) {
      if (!paragraph.trim()) { lines.push(""); continue; }
      let line = "";
      for (const word of paragraph.trim().split(/ +/)) {
        const joined = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(joined, size) <= width) { line = joined; continue; }
        if (line) { lines.push(line); line = ""; }
        // URLs, hashes and unusually long words must wrap inside the printable area too.
        for (const character of [...word]) {
          if (line && font.widthOfTextAtSize(line + character, size) > width) { lines.push(line); line = ""; }
          line += character;
        }
      }
      if (line) lines.push(line);
    }
    return lines;
  }
  paragraph(value: string, options: { bold?: boolean; size?: number; muted?: boolean; gap?: number } = {}) {
    this.characters += value.length;
    if (this.characters > 2_000_000) throw new Error("application_pdf_too_large");
    const size = options.size || 10.5, font = options.bold ? this.bold : this.regular;
    const lines = this.lines(this.clean(value), font, size), lineHeight = size * 1.45;
    for (const line of lines) {
      this.ensure(lineHeight);
      if (line) this.page.drawText(line, { x: this.left, y: this.y, font, size, color: options.muted ? this.muted : this.ink });
      this.y -= lineHeight;
    }
    this.y -= options.gap ?? 7;
  }
  section(title: string, contentHeight = 43) {
    this.ensure(contentHeight + 22);
    this.y -= 9;
    this.paragraph(title, { bold: true, size: 14, gap: 10 });
  }
  field(label: string, value: unknown) {
    this.ensure(40);
    this.paragraph(label, { bold: true, size: 9.5, gap: 2 });
    this.paragraph(text(value), { gap: 9 });
  }
  metadata(items: [string, unknown][]) {
    const width = 252;
    for (let offset = 0; offset < items.length; offset += 2) {
      const pair = items.slice(offset, offset + 2).map(([label, value]) => ({ label: this.clean(label), lines: this.lines(this.clean(text(value)), this.regular, 10.5, width) }));
      const height = 19 + Math.max(...pair.map(item => item.lines.length)) * 15 + 10;
      if (height > 640) { for (const [label, value] of items.slice(offset, offset + 2)) this.field(label, value); continue; }
      this.ensure(height);
      for (let column = 0; column < pair.length; column++) {
        const x = this.left + column * 272, item = pair[column];
        this.page.drawText(item.label, { x, y: this.y, size: 9.5, font: this.bold, color: this.ink });
        for (let index = 0; index < item.lines.length; index++) this.page.drawText(item.lines[index], { x, y: this.y - 18 - index * 15, size: 10.5, font: this.regular, color: this.ink });
      }
      this.y -= height;
    }
  }
  async finish() {
    if (this.unsupported) this.paragraph("Some characters are shown as Unicode code points (U+XXXX) so the original text remains recoverable.", { size: 9, muted: true });
    const pages = this.document.getPages();
    for (let index = 0; index < pages.length; index++) {
      pages[index].drawText("Private hiring record / " + this.clean(this.reference).slice(0, 48), { x: this.left, y: 31, font: this.regular, size: 7.5, color: this.muted });
      pages[index].drawText(`${index + 1} / ${pages.length}`, { x: 538, y: 31, font: this.regular, size: 8, color: this.muted });
    }
    return this.document.save({ useObjectStreams: false, addDefaultPage: false });
  }
}
async function report(title: string, reference: string, createdAt?: number) {
  const document = await PDFDocument.create({ updateMetadata: false });
  const stableDate = new Date(Number.isFinite(createdAt) ? createdAt! : 0);
  document.setTitle(title); document.setAuthor("AI Case Leads Recruiting");
  document.setCreator("AI Case Leads Hiring"); document.setProducer("AI Case Leads Hiring");
  document.setCreationDate(stableDate); document.setModificationDate(stableDate);
  document.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await fontBytes();
  const regular = await document.embedFont(regularBytes, { subset: true, customName: "NotoSans" });
  const bold = await document.embedFont(boldBytes, { subset: true, customName: "NotoSans-Bold" });
  return new Report(document, regular, bold, reference);
}

export async function applicationPdf(application: ReadableApplication): Promise<Uint8Array> {
  const pdf = await report(`Application - ${application.name} - ${application.jobTitle}`, application.id, application.createdAt);
  pdf.paragraph(application.name, { bold: true, size: 22, gap: 6 });
  pdf.paragraph(application.jobTitle, { size: 14, gap: 18 });
  const fields = application.fields || application.questions || [];
  const byPath = new Map(fields.map(field => [field.path, field]));
  const metadata: [string, unknown][] = [["Application ID", application.id], ["Job ID", application.jobId], ["Email", application.email], ["Applied", date(application.createdAt)], ["Hiring stage", stage(application.stage)], ["Recruiter", application.assignee || "Unassigned"], ["Source", application.source]];
  if (application.archiveProject) metadata.push(["Recruiting project", application.archiveProject]);
  if (application.archiveCountry) metadata.push(["Job location", application.archiveCountry]);
  if (application.hiringRound) metadata.push(["Hiring round", application.hiringRound]);
  if (application.revision) metadata.push(["Record revision", application.revision]);
  if (application.formVersion) metadata.push(["Submitted form version", application.formVersion]);
  pdf.metadata(metadata);
  if (Object.values(record(application.utmData)).some(value => value !== null && value !== "")) pdf.field("Source details", application.utmData);
  pdf.section("Application answers");
  const answers = application.answers || [];
  if (!answers.length) pdf.paragraph("No application answers were recorded.");
  for (let index = 0; index < answers.length; index++) {
    const answer = answers[index], field = byPath.get(answer.path);
    pdf.field(`${index + 1}. ${field?.title || words(answer.path)}`, answerText(answer, field, application.files));
  }
  const evidence = rows(application.qualificationEvidence);
  pdf.section("Screening result");
  pdf.paragraph(application.qualification === "pass" ? "Passed the configured screening rules." : application.qualification === "fail" ? "Did not meet one or more configured screening rules." : evidence.length ? "Check answers against the configured screening rules." : "No screening rules were applied.");
  for (const item of evidence) {
    pdf.field(byPath.get(String(item.fieldPath))?.title || words(String(item.fieldPath || "Requirement")), `${text(item.reason)}\nResult: ${item.matched === true ? "Met" : "Not met or needs checking"}\nAnswer: ${text(item.value)}`);
  }
  const ai = record(application.aiMatch);
  if (Object.keys(ai).length) {
    pdf.section("AI job match");
    pdf.field("Status", words(String(ai.status || "Not available")));
    if (typeof ai.score === "number") pdf.field("Evidence match", `${ai.score} / 100`);
    if (ai.model) pdf.field("Model", ai.model);
    if (ai.updatedAt) pdf.field("Reviewed", date(ai.updatedAt));
    pdf.paragraph("AI matches job-related evidence in supplied documents and answers. Claims remain unverified; your recruiting team makes the hiring decision.", { size: 9, muted: true });
    for (const item of rows(ai.criteria)) {
      pdf.field(text(item.criterion), `${words(String(item.status || "Not available"))}: ${text(item.explanation)}`);
      for (const citation of rows(item.citations)) pdf.paragraph(`Source: ${words(String(citation.source || "Document"))}\n"${text(citation.quote)}"`, { size: 9.5, muted: true });
    }
    const checks = rows(ai.checks);
    if (checks.length) {
      pdf.field("Questions to verify", checks.map((item, index) => `${index + 1}. ${text(item.question)}`).join("\n"));
      for (const check of checks) for (const citation of rows(check.citations)) pdf.paragraph(`Source: ${words(String(citation.source || "Document"))}\n"${text(citation.quote)}"`, { size: 9.5, muted: true });
    }
    for (const warning of Array.isArray(ai.sourceWarnings) ? ai.sourceWarnings : []) pdf.paragraph(text(warning), { size: 9, muted: true });
    if (ai.error) pdf.field("Review issue", words(String(ai.error)));
  }
  pdf.section("Original attachments");
  if (!application.files?.length) pdf.paragraph("No uploaded files were recorded.");
  for (const file of application.files || []) pdf.paragraph(`${file.filename}\n${file.size.toLocaleString("en-US")} bytes${file.contentType ? " / " + file.contentType : ""}\nFile ID: ${file.id}`);
  pdf.paragraph("Original uploads are retained separately without changes. Bulk downloads include the originals alongside this summary.", { size: 9, muted: true });
  const assessments = application.assessments?.length ? rows(application.assessments) : application.assessment ? [record(application.assessment)] : [];
  if (assessments.length) {
    pdf.section("Assessments");
    for (let index = 0; index < assessments.length; index++) {
      const item = assessments[index];
      pdf.field(`Assessment ${index + 1}`, words(String(item.status || "Recorded")));
      if (item.prompt) pdf.field("Instructions", item.prompt);
      if (item.answer) pdf.field("Candidate submission", item.answer);
      if (item.submittedAt) pdf.field("Submitted", date(item.submittedAt));
    }
  }
  const interviews = application.interviews?.length ? rows(application.interviews) : application.interview ? [record(application.interview)] : [];
  if (interviews.length) {
    pdf.section("Interviews");
    for (let index = 0; index < interviews.length; index++) {
      const item = interviews[index];
      pdf.field(`Interview ${index + 1}`, words(String(item.status || "Recorded")));
      if (item.start) pdf.field("Starts", date(item.start));
      if (item.end) pdf.field("Ends", date(item.end));
      if (item.timeZone) pdf.field("Time zone", item.timeZone);
      if (typeof item.attended === "boolean") pdf.field("Attended", item.attended);
    }
  }
  const cards = rows(application.scorecards);
  const grade = record(application.grade);
  if (cards.length || grade.reviewed === true) {
    pdf.section("Team reviews");
    if (typeof grade.scorePercent === "number") pdf.field("Team review score", `${grade.scorePercent} / 100`);
    for (const item of cards) {
      pdf.field(`${text(item.actor)} / ${date(item.createdAt)}`, `Score: ${text(item.score)} / 5\nCriteria: ${criteriaText(item.criteria)}\nNotes: ${text(item.text)}`);
    }
  }
  const communications = rows(application.communications);
  if (communications.length) {
    pdf.section("Messages");
    for (const item of communications) {
      pdf.field(`${text(item.subject)} / ${words(String(item.status || "Recorded"))}`, `${date(item.createdAt)}\n${text(item.body)}`);
    }
  }
  const history = rows(application.history);
  if (history.length) {
    pdf.section("Hiring activity and notes");
    for (const item of history) pdf.field(`${date(item.createdAt)} / ${words(String(item.type || "Activity"))}`, `${item.actor ? text(item.actor) + "\n" : ""}${activityText(item,ai)}`);
  }
  if (application.jobDescription) {
    pdf.section("Current job description", 160);
    pdf.paragraph(`Job ID: ${application.jobId}\nCurrent job form version: ${application.jobDescription.formVersion}${application.jobDescription.location ? "\nLocation: " + application.jobDescription.location : ""}`, { size: 9, muted: true });
    pdf.paragraph("This is the job description at download time. Submitted answers, question labels and AI findings above retain their recorded versions.", { size: 9, muted: true });
    pdf.paragraph(htmlText(application.jobDescription.descriptionHtml));
  }
  return pdf.finish();
}

export type MissingExportFile = { applicationId: string; fileId: string; filename: string; reason: string };
export async function exportReportPdf(input: { jobId: string; applicationCount: number; includedFiles: number; missingFiles: MissingExportFile[]; exportedAt: number }) {
  const pdf = await report("Application download report", input.jobId, input.exportedAt);
  pdf.paragraph("Application download report", { bold: true, size: 22, gap: 16 });
  pdf.field("Downloaded", date(input.exportedAt));
  pdf.field("Job ID", input.jobId);
  pdf.field("Application summaries", input.applicationCount);
  pdf.field("Original attachments included", input.includedFiles);
  pdf.field("Attachments unavailable", input.missingFiles.length);
  pdf.paragraph("Each applicant folder contains a readable application summary PDF and the original uploaded files. The hiring database remains the authoritative record.");
  if (input.missingFiles.length) {
    pdf.section("Files needing attention");
    pdf.paragraph("These files were not included. Application summaries remain available. Check file storage and download again after recovery.");
    for (const missing of input.missingFiles) pdf.field(missing.filename, `${missing.reason}\nApplication ID: ${missing.applicationId}\nFile ID: ${missing.fileId}`);
  } else pdf.paragraph("All recorded original attachments were included.");
  return pdf.finish();
}

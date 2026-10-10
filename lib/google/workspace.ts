import type { ItemState } from "../archive/contracts";
import { GoogleClient } from "./client";
import { Gmail, type MailInput, type MailAttachment } from "./gmail";
import { WorkspaceCalendar, type Instant, type InterviewInput } from "./calendar";
import { WorkspaceDrive, type ApplicationSnapshot, type ArchiveOriginal, type ArchiveContinuation } from "./drive";

export { authorizationUrl, exchangeCode, refreshAccessToken, sealToken, seal, openToken, scopeStatus, GOOGLE_SCOPES } from "./oauth";
export { GoogleError } from "./http";
export { calendarEventId, isoDate } from "./calendar";
export type { ArchiveItem, ItemState } from "./drive";
export type { MailInput, SentMail } from "./gmail";
export type { Instant, InterviewInput, InterviewResult } from "./calendar";
export type { ApplicationSnapshot, OriginalFile, OriginalFileSource, ArchiveOriginal, ArchiveContinuation, ArchiveResult } from "./drive";

export interface WorkspaceConfig {
  clientId: string; clientSecret: string; refreshToken: string; sender: string;
  calendarId?: string; driveRootId?: string;
  /** Must persist reserve() atomically before provider create requests, across worker invocations. */
  archiveState?: ItemState;
}
export class GoogleWorkspace {
  private gmail: Gmail;
  private calendar: WorkspaceCalendar;
  private drive: WorkspaceDrive;
  private client: GoogleClient;
  constructor(private config: WorkspaceConfig, fetcher: typeof fetch = fetch) {
    const client = this.client = new GoogleClient(config, fetcher);
    this.gmail = new Gmail(client, config.sender);
    this.calendar = new WorkspaceCalendar(client, config.calendarId);
    this.drive = new WorkspaceDrive(config, fetcher);
  }
  status() { return { connected: !!(this.config.clientId && this.config.clientSecret && this.config.refreshToken), sender: this.config.sender, calendar: !!this.config.calendarId, drive: !!(this.config.driveRootId && this.config.archiveState) }; }
  profile() { return this.gmail.profile(); }
  setDeadline(deadline?: number) { this.client.budget.deadline = deadline; this.drive.budget.deadline = deadline; }
  sendMail(input: MailInput) { return this.gmail.send(input); }
  reconcileMail(messageId: string) { return this.gmail.reconcile(messageId); }
  threadMessages(threadId: string) { return this.gmail.threadMessages(threadId); }
  mailHistory(historyId: string, pageToken?: string) { return this.gmail.history(historyId, pageToken); }
  mailMessage(id: string) { return this.gmail.message(id); }
  mailAttachment(id: string, part: MailAttachment) { return this.gmail.attachmentBytes(id, part); }
  busy(input: { start: Instant; end: Instant; calendarIds?: string[] }) { return this.calendar.busy(input); }
  createInterview(input: InterviewInput) { return this.calendar.create(input); }
  updateInterview(input: InterviewInput) { return this.calendar.update(input); }
  cancelInterview(id: string, calendarId?: string) { return this.calendar.cancel(id, calendarId); }
  archiveApplication(detail: ApplicationSnapshot, files: ArchiveOriginal[], existingFolderId?: string, continuation?:ArchiveContinuation) { return this.drive.application(detail, files, existingFolderId, continuation); }
}

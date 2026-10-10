import type { GoogleClient } from "./client";
import { emailAddress, GoogleError, hash, json } from "./http";

const API = "https://www.googleapis.com/calendar/v3";
export type Instant = string | number;
export interface InterviewInput { id: string; title: string; email: string; start: Instant; end: Instant; timeZone: string; calendarId?: string }
export interface InterviewResult { id: string; meetUrl: string; start: string; end: string }
interface Event {
  id: string; etag?: string; status?: string; summary?: string; transparency?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string }; end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email: string; responseStatus?: string }>;
  extendedProperties?: { private?: Record<string, string> };
  hangoutLink?: string;
  conferenceData?: { createRequest?: { status?: { statusCode?: string } }; entryPoints?: Array<{ entryPointType: string; uri: string }> };
}
export function isoDate(value: Instant): string {
  // Ambiguous local timestamps have no place in an international hiring calendar.
  if (typeof value === "string" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new GoogleError("calendar_timestamp_requires_offset");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new GoogleError("invalid_calendar_timestamp");
  return date.toISOString();
}
function interval(start: Instant, end: Instant): { start: string; end: string } {
  const result = { start: isoDate(start), end: isoDate(end) };
  if (result.start >= result.end) throw new GoogleError("invalid_calendar_interval");
  return result;
}
export async function calendarEventId(id: string): Promise<string> {
  if (!id || id.length > 256) throw new GoogleError("invalid_interview_id");
  return /^acl[a-f0-9]{64}$/.test(id) ? id : `acl${await hash(`hub-interview:${id}`)}`;
}
function validate(input: InterviewInput) {
  if (!input.title || input.title.length > 500 || /[\u0000-\u001f]/.test(input.title)) throw new GoogleError("invalid_interview_title");
  emailAddress(input.email);
  try { new Intl.DateTimeFormat("en", { timeZone: input.timeZone }).format(); }
  catch { throw new GoogleError("invalid_interview_time_zone"); }
  if (!input.timeZone) throw new GoogleError("interview_time_zone_required");
  return interval(input.start, input.end);
}

export class WorkspaceCalendar {
  constructor(private client: GoogleClient, private calendarId?: string) {}
  private calendar(): string {
    if (!this.calendarId || this.calendarId.length > 512 || /[\u0000-\u001f]/.test(this.calendarId)) throw new GoogleError("interview_calendar_not_configured");
    return encodeURIComponent(this.calendarId);
  }
  private url(id?: string): string { return `${API}/calendars/${this.calendar()}/events${id ? `/${id}` : ""}`; }
  private async get(id: string): Promise<Event | null> {
    try { return await json<Event>(await this.client.request(this.url(id))); }
    catch (error) { if (error instanceof GoogleError && [404, 410].includes(error.status)) return null; throw error; }
  }
  private identity(event: Event, id: string): void {
    if (event.id !== id || event.extendedProperties?.private?.aclInterviewId !== id) throw new GoogleError("calendar_event_identity_mismatch");
  }
  async busy(input: { start: Instant; end: Instant; calendarIds?: string[] }): Promise<Array<{ start: string; end: string }>> {
    const times = interval(input.start, input.end);
    if (Date.parse(times.end) - Date.parse(times.start) > 93 * 86400_000) throw new GoogleError("calendar_availability_range_too_large");
    const calendars = [...new Set(input.calendarIds ?? [this.calendarId ?? ""])];
    if (!calendars.length || calendars.length > 50 || calendars.some((id) => !id || id.length > 512)) throw new GoogleError("interview_calendar_not_configured");
    const data = await json<{ calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }>; groups?: Record<string, { errors?: unknown[] }> }>(await this.client.request(`${API}/freeBusy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timeMin: times.start, timeMax: times.end, calendarExpansionMax: 50, items: calendars.map((id) => ({ id })) }) }));
    const result: Array<{ start: string; end: string }> = [];
    for (const id of calendars) {
      const availability = data.calendars?.[id];
      if (!availability || availability.errors?.length || !Array.isArray(availability.busy)) throw new GoogleError("calendar_availability_unavailable");
      for (const busy of availability.busy) result.push(interval(busy.start, busy.end));
    }
    return result.sort((a, b) => a.start.localeCompare(b.start));
  }
  private async conflict(start: string, end: string, excludeId?: string): Promise<void> {
    if (!excludeId) {
      if ((await this.busy({ start, end })).some((busy) => busy.start < end && busy.end > start)) throw new GoogleError("interview_slot_conflict", 409);
      return;
    }
    // Freebusy includes the event being moved. List overlapping instances, excluding only that ID.
    let pageToken: string | undefined;
    for (let page = 0; page < 100; page++) {
      const params = new URLSearchParams({ timeMin: start, timeMax: end, singleEvents: "true", showDeleted: "false", maxResults: "250", ...(pageToken ? { pageToken } : {}) });
      const data = await json<{ items?: Event[]; nextPageToken?: string }>(await this.client.request(`${this.url()}?${params}`));
      if (!Array.isArray(data.items)) throw new GoogleError("calendar_availability_unavailable");
      for (const event of data.items) {
        if (event.id === excludeId || event.status === "cancelled" || event.transparency === "transparent" || event.attendees?.some((attendee) => attendee.responseStatus === "declined" && (attendee as { self?: boolean }).self)) continue;
        // The API query already selected overlapping events. All-day or redacted events block the slot.
        if (!event.start?.dateTime || !event.end?.dateTime) throw new GoogleError("interview_slot_conflict", 409);
        if (isoDate(event.start.dateTime) < end && isoDate(event.end.dateTime) > start) throw new GoogleError("interview_slot_conflict", 409);
      }
      if (!data.nextPageToken) return;
      if (data.nextPageToken === pageToken) throw new GoogleError("calendar_pagination_stalled");
      pageToken = data.nextPageToken;
    }
    throw new GoogleError("calendar_pagination_limit");
  }
  private matches(event: Event, input: InterviewInput, times: { start: string; end: string }): boolean {
    return event.status !== "cancelled" && event.summary === input.title && event.start?.dateTime !== undefined && event.end?.dateTime !== undefined && isoDate(event.start.dateTime) === times.start && isoDate(event.end.dateTime) === times.end && !!event.attendees?.some((a) => a.email.toLowerCase() === input.email.toLowerCase());
  }
  private async result(event: Event, id: string): Promise<InterviewResult> {
    try { return await this.readyResult(event, id); }
    catch (error) {
      // Once an event exists, a failed follow-up read must preserve the local reservation.
      if (error instanceof GoogleError && error.code !== "interview_already_cancelled") error.uncertain = true;
      throw error;
    }
  }
  private async readyResult(event: Event, id: string): Promise<InterviewResult> {
    this.identity(event, id);
    for (let poll = 0; poll < 3; poll++) {
      if (event.status === "cancelled") throw new GoogleError("interview_already_cancelled", 410);
      const meetUrl = event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri ?? event.hangoutLink;
      if (meetUrl && event.start?.dateTime && event.end?.dateTime) {
        const url = new URL(meetUrl);
        if (url.origin !== "https://meet.google.com" || url.username || url.password) throw new GoogleError("calendar_meet_url_invalid");
        return { id, meetUrl, start: isoDate(event.start.dateTime), end: isoDate(event.end.dateTime) };
      }
      if (event.conferenceData?.createRequest?.status?.statusCode === "failure") throw new GoogleError("calendar_meet_creation_failed", 0, true);
      const latest = await this.get(id);
      if (!latest) throw new GoogleError("calendar_event_missing", 0, true);
      this.identity(latest, id); event = latest;
    }
    // Retry the durable task later. The stable ID ensures the retry only reads this existing event.
    throw new GoogleError("calendar_meet_pending", 503, true);
  }
  async create(input: InterviewInput): Promise<InterviewResult> {
    if (input.calendarId !== undefined) return new WorkspaceCalendar(this.client, input.calendarId).create({ ...input, calendarId: undefined });
    const times = validate(input), id = await calendarEventId(input.id);
    const existing = await this.get(id);
    if (existing) {
      this.identity(existing, id);
      if (!this.matches(existing, input, times)) throw new GoogleError("calendar_event_changed", 409);
      return this.result(existing, id);
    }
    await this.conflict(times.start, times.end);
    let event: Event;
    try {
      event = await json<Event>(await this.client.request(`${this.url()}?conferenceDataVersion=1&sendUpdates=all`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, summary: input.title, start: { dateTime: times.start, timeZone: input.timeZone }, end: { dateTime: times.end, timeZone: input.timeZone }, attendees: [{ email: input.email }], extendedProperties: { private: { aclInterviewId: id } }, conferenceData: { createRequest: { requestId: id, conferenceSolutionKey: { type: "hangoutsMeet" } } }, guestsCanModify: false, guestsCanInviteOthers: false }),
      }, true), true);
    } catch (error) {
      if (!(error instanceof GoogleError && error.status === 409)) throw error;
      const prior = await this.get(id);
      if (!prior) throw new GoogleError("calendar_conflict_unresolved", 409);
      this.identity(prior, id);
      if (!this.matches(prior, input, times)) throw new GoogleError("calendar_event_changed", 409);
      event = prior;
    }
    return this.result(event, id);
  }
  async update(input: InterviewInput): Promise<InterviewResult> {
    if (input.calendarId !== undefined) return new WorkspaceCalendar(this.client, input.calendarId).update({ ...input, calendarId: undefined });
    const times = validate(input), id = await calendarEventId(input.id);
    const existing = await this.get(id);
    if (!existing) throw new GoogleError("interview_not_found", 404);
    this.identity(existing, id);
    if (existing.status === "cancelled") throw new GoogleError("interview_already_cancelled", 410);
    if (this.matches(existing, input, times)) return this.result(existing, id);
    await this.conflict(times.start, times.end, id);
    if (!existing.etag) throw new GoogleError("calendar_event_etag_missing");
    const event = await json<Event>(await this.client.request(`${this.url(id)}?conferenceDataVersion=1&sendUpdates=all`, { method: "PATCH", headers: { "Content-Type": "application/json", "If-Match": existing.etag }, body: JSON.stringify({ summary: input.title, start: { dateTime: times.start, timeZone: input.timeZone }, end: { dateTime: times.end, timeZone: input.timeZone }, attendees: [{ email: input.email }] }) }, true), true);
    return this.result(event, id);
  }
  async cancel(inputId: string, calendarId?: string): Promise<void> {
    if (calendarId !== undefined) return new WorkspaceCalendar(this.client, calendarId).cancel(inputId);
    const id = await calendarEventId(inputId), existing = await this.get(id);
    if (!existing) return;
    this.identity(existing, id);
    if (existing.status === "cancelled") return;
    if (!existing.etag) throw new GoogleError("calendar_event_etag_missing");
    try { await this.client.request(`${this.url(id)}?sendUpdates=all`, { method: "DELETE", headers: { "If-Match": existing.etag } }, true); }
    catch (error) { if (!(error instanceof GoogleError && [404, 410].includes(error.status))) throw error; }
  }
}

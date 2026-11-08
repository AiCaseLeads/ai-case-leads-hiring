import { activeApplicationsSql } from './application-lifecycle';
import type { HubStore } from './store';
import type { Task } from './types';

export const interviewRemindersEnabledSql =
  "COALESCE((SELECT value FROM hub_settings WHERE key='interview_reminders_enabled'),'true')='true'";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
export const bookedReminderTimes = [
  { label: '24h', before: DAY, grace: 60 * MINUTE },
  { label: '1h', before: 60 * MINUTE, grace: 10 * MINUTE },
  { label: '5m', before: 5 * MINUTE, grace: 5 * MINUTE },
] as const;

// Count Monday–Friday using the same Eastern wall time, including across DST.
const eastern = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: 'numeric',
  day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
});
function easternWallTime(timestamp: number) {
  const p = Object.fromEntries(eastern.formatToParts(timestamp).map(part => [part.type, part.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second, timestamp % 1000);
}
export function bookingFollowupDueAt(sentAt: number) {
  let wall = easternWallTime(sentAt);
  let businessDays = 0;
  while (businessDays < 2) {
    wall += DAY;
    const weekday = new Date(wall).getUTCDay();
    if (weekday > 0 && weekday < 6) businessDays++;
  }
  const estimated = sentAt + wall - easternWallTime(sentAt);
  return estimated + wall - easternWallTime(estimated);
}

// Invitations created before the follow-up feature have no opt-in marker.
export function hasApprovedBookingEnvelope(payload: Record<string, unknown>, candidateEmail: string) {
  const envelope = payload.approvedEnvelope as Record<string, unknown> | null;
  return payload.mailMode === 'recruiter' && typeof payload.actor === 'string' && !!payload.actor.trim() &&
    typeof envelope?.sender === 'string' && !!envelope.sender.trim() && envelope.to === candidateEmail &&
    Array.isArray(envelope.cc) && Array.isArray(envelope.replyTo);
}

export const viableBookingInvitationSql = `EXISTS (
  SELECT 1 FROM hub_links l
  JOIN hub_interviews i ON i.id=json_extract(l.payload_json,'$.interviewId') AND i.application_id=l.application_id
  JOIN hub_applications a ON a.id=i.application_id
  JOIN hub_communications c ON c.task_id=? AND c.application_id=a.id
  WHERE l.kind='interview' AND l.application_id=? AND l.token_hash=? AND i.id=?
    AND l.used_at IS NULL AND l.expires_at>? AND i.status='invited' AND i.start IS NULL
    AND i.id=(SELECT newest.id FROM hub_interviews newest WHERE newest.application_id=i.application_id
      ORDER BY newest.created_at DESC,newest.id DESC LIMIT 1)
    AND c.status='sent' AND c.provider_id IS NOT NULL AND trim(c.provider_id)<>''
    AND a.stage NOT IN ('Rejected','Withdrawn','Hired') AND ${activeApplicationsSql('a')}
)`;
export async function bookingFollowupIsCurrent(store: HubStore, task: Task, now: number) {
  const p = task.payload;
  const due = Number(p.dueAt);
  if (!Number.isFinite(due) || now < due || now >= Number(p.expiresAt)) return false;
  const row = await store.stmt(`SELECT 1 WHERE ${interviewRemindersEnabledSql} AND ${viableBookingInvitationSql}`,
    String(p.invitationTaskId), task.applicationId, String(p.invitationHash), String(p.interviewId), now).first();
  return !!row;
}

export const currentBookedReminderSql = `EXISTS (
  SELECT 1 FROM hub_interviews i JOIN hub_applications a ON a.id=i.application_id
  WHERE i.id=? AND i.application_id=? AND i.revision=? AND i.status='booked' AND i.start=?
    AND julianday(i.end)>julianday(i.start) AND i.attended IS NULL AND i.provider_id IS NOT NULL AND trim(i.provider_id)<>''
    AND i.meet_url LIKE 'https://meet.google.com/%' AND i.calendar_id IS NOT NULL AND trim(i.calendar_id)<>''
    AND a.stage NOT IN ('Rejected','Withdrawn','Hired') AND ${activeApplicationsSql('a')}
)`;
export async function bookedReminderIsCurrent(store: HubStore, task: Task, now: number) {
  const p = task.payload;
  const slot = bookedReminderTimes.find(time => task.id.endsWith(':' + time.label));
  const start = Date.parse(String(p.interviewStart));
  if (!slot || !Number.isFinite(start)) return false;
  const due = start - slot.before;
  if (now < due || now >= due + slot.grace) return false;
  const row = await store.stmt(`SELECT 1 WHERE ${interviewRemindersEnabledSql} AND ${currentBookedReminderSql}`,
    String(p.interviewId), task.applicationId, Number(p.revision), String(p.interviewStart)).first();
  return !!row;
}

export async function bookingConfirmationIsCurrent(store: HubStore, task: Task, now: number) {
  const { interviewId, revision, interviewStart, meetUrl, to } = task.payload;
  const start = Date.parse(String(interviewStart));
  if (!Number.isFinite(start) || now >= start) return false;
  const row = await store.stmt(`SELECT 1 WHERE ${currentBookedReminderSql} AND EXISTS (
    SELECT 1 FROM hub_interviews i JOIN hub_applications a ON a.id=i.application_id
    WHERE i.id=? AND i.meet_url=? AND a.email=?
  )`, String(interviewId), task.applicationId, Number(revision), String(interviewStart),
    String(interviewId), String(meetUrl), String(to)).first();
  return !!row;
}

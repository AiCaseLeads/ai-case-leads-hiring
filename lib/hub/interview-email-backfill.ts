import { linkedSlotSql } from "./interview-progress";
import { bookingFollowupDueAt } from "./interview-reminders";
import type { HubStore } from "./store";

const cursorKey = "interview_email_backfill_v2";
const batchSize = 8;
const finished = -1;

interface Booking {
  cursor: number;
  status: "booked" | "invited";
  interviewId: string;
  revision: number;
  start: string;
  timeZone: string;
  meetUrl: string;
  id: string;
  name: string;
  email: string;
  job_title: string;
}

// New invitations and confirmed events schedule mail at delivery time. This
// one-time pass picks up verified invitations and future events already on file.
export async function backfillInterviewEmails(store: HubStore, now = Date.now()) {
  const cursor = await store.setting<number>(cursorKey, 0);
  if (cursor === finished || !(await store.setting("interview_reminders_enabled", true))) return;

  const bookings = await store.rows<Booking>(`SELECT i.rowid AS cursor, i.id AS interviewId, i.status,
    i.revision, i.start, i.time_zone AS timeZone, i.meet_url AS meetUrl,
    a.id, a.name, a.email, a.job_title FROM hub_interviews i
    JOIN hub_applications a ON a.id=i.application_id
    WHERE i.rowid>? AND i.attended IS NULL AND a.stage NOT IN ('Rejected','Withdrawn','Hired')
      AND NOT EXISTS (SELECT 1 FROM hub_settings WHERE key='application_trash:'||a.id)
      AND ((i.status='booked' AND ${linkedSlotSql('i')} AND i.calendar_id<>'' AND i.meet_url IS NOT NULL
            AND julianday(i.start)>julianday(?))
        OR (i.status='invited' AND i.start IS NULL AND EXISTS (
          SELECT 1 FROM hub_links l WHERE l.application_id=a.id AND l.kind='interview'
            AND l.used_at IS NULL AND l.expires_at>? AND json_extract(l.payload_json,'$.interviewId')=i.id)))
    ORDER BY i.rowid LIMIT ?`, cursor, new Date(now).toISOString(), now, batchSize);

  const statements = [];
  for (const booking of bookings) {
    if (booking.status === "booked") {
      statements.push(...store.confirmedBookingMailStatements({ ...booking, app: booking, now }));
      continue;
    }

    const prefix = `gmail:${booking.id}:interview:${booking.interviewId}:invitation:`;
    const invitation = await store.stmt(`SELECT c.task_id AS taskId, c.updated_at AS sentAt,
        CASE WHEN json_valid(t.payload_json) THEN t.payload_json END AS payload
      FROM hub_communications c JOIN hub_tasks t ON t.id=c.task_id
      WHERE c.application_id=? AND t.application_id=c.application_id AND instr(c.task_id,?)=1
      ORDER BY c.created_at DESC, CAST(substr(c.task_id,length(?)+1) AS INTEGER) DESC LIMIT 1`,
      booking.id, prefix, prefix).first<{taskId: string; sentAt: number; payload: string | null}>();
    if (!invitation?.payload) continue;
    const payload = JSON.parse(invitation.payload) as Record<string, unknown>;
    if (!payload || typeof payload !== 'object') continue;
    // The same final insert guard used by live invitations verifies a sent
    // communication with provider ID and a still-unused link for this exact round.
    const version = invitation.taskId.slice(prefix.length);
    const firstId = `gmail:${booking.id}:booking-followup:${booking.interviewId}:${version}`;
    const previous = await store.stmt(`SELECT t.status,c.status AS communicationStatus,c.updated_at AS sentAt,c.provider_id AS providerId
      FROM hub_tasks t LEFT JOIN hub_communications c ON c.task_id=t.id WHERE t.id=?`, firstId)
      .first<{status: string; communicationStatus: string | null; sentAt: number | null; providerId: string | null}>();
    if (previous?.status === 'done' && previous.communicationStatus === 'sent' && previous.sentAt && previous.providerId) {
      // Legacy reminders already delivered count as the first; never send them again.
      statements.push(...await store.bookingFollowupStatements({
        app: booking, invitationTaskId: invitation.taskId, invitationPayload: payload,
        sentAt: previous.sentAt, now, followupNumber: 2,
      }, {sql: "EXISTS (SELECT 1 FROM hub_tasks WHERE id=? AND status='done')", values: [firstId]}));
    } else {
      const due = bookingFollowupDueAt(invitation.sentAt);
      // Keep the legacy deterministic ID and move only unclaimed pending tasks.
      statements.push(store.stmt(`UPDATE hub_tasks SET run_after=?,payload_json=json_set(payload_json,'$.dueAt',?,'$.followupNumber',1),updated_at=?
        WHERE id=? AND status='pending' AND json_extract(payload_json,'$.bookingFollowup')=1`, due, due, now, firstId));
      statements.push(...await store.bookingFollowupStatements({
        app: booking, invitationTaskId: invitation.taskId, invitationPayload: payload,
        sentAt: invitation.sentAt, now,
      }, {sql: "EXISTS (SELECT 1 FROM hub_tasks WHERE id=? AND status='done')", values: [invitation.taskId]}));
    }
  }
  const next = bookings.length < batchSize ? finished : bookings[bookings.length - 1].cursor;
  // A second worker can replay a batch safely. Only its current cursor may advance.
  statements.push(store.stmt(`INSERT INTO hub_settings(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    WHERE hub_settings.value=?`, cursorKey, JSON.stringify(next), now, JSON.stringify(cursor)));
  await store.db.batch(statements);
}

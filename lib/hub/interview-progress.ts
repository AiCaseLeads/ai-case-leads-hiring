export const INTERVIEW_PROGRESS_VALUES = [
  "none", "delivery_pending", "requested", "pending", "booked", "completed",
  "attendance_due", "unverified", "unlinked", "link_inactive", "no_show", "cancel_pending", "cancelled", "failed",
] as const;

export type InterviewProgress = (typeof INTERVIEW_PROGRESS_VALUES)[number];

export const INTERVIEW_VIEW_LABELS = {
  upcoming: "Upcoming & in progress",
  past: "Past interviews",
  awaiting_booking: "Awaiting booking",
  needs_review: "Missing booking details",
} as const;
export type InterviewFilter = InterviewProgress | keyof typeof INTERVIEW_VIEW_LABELS;

export function isInterviewFilter(value: string): value is InterviewFilter {
  return Object.hasOwn(INTERVIEW_VIEW_LABELS, value) || INTERVIEW_PROGRESS_VALUES.includes(value as InterviewProgress);
}

export const interviewStageWithoutRecordSql = "a.stage IN ('Interview','Second Round Interview')";

export function linkedSlotSql(alias: string) {
  return `(length(trim(COALESCE(${alias}.provider_id,'')))>0
    AND COALESCE(julianday(${alias}.end)>julianday(${alias}.start),0))`;
}

// Only pass a static table alias. Replacements can reuse an interview ID, so read
// the latest invitation's delivery state rather than any earlier successful send.
export function interviewProgressForRowSql(alias: string): string {
  const invitePrefix = `('gmail:' || ${alias}.application_id || ':interview:' || ${alias}.id || ':invitation:')`;
  return `CASE
    WHEN ${alias}.attended=1 THEN 'completed'
    WHEN ${alias}.attended=0 THEN 'no_show'
    WHEN ${alias}.status='booked' AND NOT ${linkedSlotSql(alias)} THEN 'unlinked'
    WHEN ${alias}.status='booked' AND julianday(${alias}.end)<=julianday('now') THEN 'attendance_due'
    WHEN ${alias}.status='invited' THEN COALESCE((
      SELECT CASE
        WHEN c.status='sent' THEN CASE WHEN EXISTS (
          SELECT 1 FROM hub_links link
          WHERE link.application_id=${alias}.application_id AND link.kind='interview'
            AND json_extract(link.payload_json,'$.interviewId')=${alias}.id
            AND link.used_at IS NULL AND link.expires_at>unixepoch('subsec')*1000
        ) THEN 'requested' ELSE 'link_inactive' END
        WHEN c.status IN ('pending','queued') THEN 'delivery_pending'
        WHEN c.status='cancelled' THEN 'cancelled'
        WHEN c.status='failed' THEN 'failed'
        ELSE 'unverified' END
      FROM hub_communications c
      WHERE c.application_id=${alias}.application_id
        AND instr(c.task_id,${invitePrefix})=1
      ORDER BY c.created_at DESC, CAST(substr(c.task_id,length(${invitePrefix})+1) AS INTEGER) DESC LIMIT 1
    ),'unverified')
    ELSE ${alias}.status END`;
}

export const applicationInterviewProgressSql = `COALESCE((
  SELECT ${interviewProgressForRowSql('i')} FROM hub_interviews i
  WHERE i.application_id=a.id ORDER BY i.created_at DESC,i.id DESC LIMIT 1
),CASE WHEN ${interviewStageWithoutRecordSql} THEN 'unlinked' ELSE 'none' END)`;

// A time bucket describes the actual calendar slot. Marking attendance during a
// call must not move that meeting into Past before the scheduled end.
export function interviewSlotPredicate(filter: "upcoming" | "past") {
  const comparison = filter === 'upcoming' ? '>' : '<=';
  return `i.status='booked' AND ${linkedSlotSql('i')} AND julianday(i.end) ${comparison} julianday('now')`;
}

// The interview list can also contain a legacy application with no interview row.
export const sessionProgressSql = `CASE WHEN i.id IS NULL THEN 'unlinked' ELSE ${interviewProgressForRowSql('i')} END`;

export function sessionFilterPredicate(filter: InterviewFilter) {
  if (filter === 'upcoming' || filter === 'past') {
    return {sql: interviewSlotPredicate(filter), values: []};
  }
  if (filter === 'needs_review') {
    return {
      sql: `((${sessionProgressSql}) IN ('unlinked','unverified','link_inactive')
        OR (i.status='booked' AND NOT ${linkedSlotSql('i')}))`,
      values: [],
    };
  }
  return {sql: `(${sessionProgressSql})=?`, values: [filter === 'awaiting_booking' ? 'requested' : filter]};
}

export function applicantInterviewFilter(filter: InterviewFilter) {
  const {sql, values} = sessionFilterPredicate(filter);
  let fallback = '0';
  if (filter === 'none') fallback = `NOT (${interviewStageWithoutRecordSql})`;
  if (filter === 'unlinked' || filter === 'needs_review') fallback = interviewStageWithoutRecordSql;
  return {
    sql: `COALESCE((SELECT ${sql} FROM hub_interviews i WHERE i.application_id=a.id
      ORDER BY i.created_at DESC,i.id DESC LIMIT 1), ${fallback})`,
    values,
  };
}

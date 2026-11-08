export const INTERVIEW_PROGRESS_VALUES = [
  "none", "delivery_pending", "requested", "pending", "booked", "completed",
  "attendance_due", "unverified", "no_show", "cancel_pending", "cancelled", "failed",
] as const;

export type InterviewProgress = (typeof INTERVIEW_PROGRESS_VALUES)[number];

// Only pass a static table alias. Replacements can reuse an interview ID, so read
// the latest invitation's delivery state rather than any earlier successful send.
export function interviewProgressForRowSql(alias: string): string {
  const invitePrefix = `('gmail:' || ${alias}.application_id || ':interview:' || ${alias}.id || ':invitation:')`;
  return `CASE
    WHEN ${alias}.attended=1 THEN 'completed'
    WHEN ${alias}.attended=0 THEN 'no_show'
    WHEN ${alias}.status='booked' AND julianday(${alias}.end)<=julianday('now') THEN 'attendance_due'
    WHEN ${alias}.status='invited' THEN COALESCE((
      SELECT CASE
        WHEN c.status='sent' THEN 'requested'
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
),'none')`;

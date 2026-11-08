// Produces one row for each application (a), including applications awaiting indexing.
export const appCheckJoinsSql = `
  LEFT JOIN hub_response_index ri ON ri.application_id=a.id
  LEFT JOIN (
    SELECT ra.application_id, COUNT(*) AS answer_count,
      SUM(CASE WHEN ra.answer_hash IS NOT NULL AND (dc.status IS NULL OR dc.status IN ('pending','running')) THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN dc.status='unavailable' THEN 1 ELSE 0 END) AS unavailable_count
    FROM hub_response_answers ra
    LEFT JOIN hub_response_detector_cache dc ON dc.answer_hash=ra.answer_hash
    GROUP BY ra.application_id
  ) rs ON rs.application_id=a.id`;

export const appCheckStatusSql = `CASE
  WHEN ri.application_id IS NULL OR rs.pending_count>0 THEN 'pending'
  WHEN COALESCE(rs.answer_count,0)=0 THEN 'no_written_answers'
  WHEN rs.unavailable_count>0 THEN 'partial'
  ELSE 'ready' END`;

export const responseStates = {
  ready: 'Complete',
  pending: 'Pending',
  no_written_answers: 'No written answers',
  partial: 'Some checks unavailable',
} as const;
export type ResponseState = keyof typeof responseStates;

/** A historical booking stays in Activity, but cannot determine the next organizer. */
export function isHistoricalInterview(interview: {
  status: string;
  end?: string | number | null;
  linkActive?: boolean;
  attended?: boolean | number | null;
}, now = Date.now()) {
  if (interview.attended != null) return true;
  if (interview.status === 'cancelled' || interview.status === 'failed') return true;
  if (interview.status === 'invited') return interview.linkActive === false;
  return interview.status === 'booked' && interview.end != null && new Date(interview.end).getTime() <= now;
}

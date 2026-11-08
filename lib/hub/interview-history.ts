/** A historical booking stays in Activity, but cannot determine the next organizer. */
export function isHistoricalInterview(interview: {
  status: string;
  end?: string | number | null;
  linkActive?: boolean;
}, now = Date.now()) {
  if (interview.status === 'cancelled' || interview.status === 'failed') return true;
  if (interview.status === 'invited') return interview.linkActive === false;
  return interview.status === 'booked' && interview.end != null && new Date(interview.end).getTime() <= now;
}

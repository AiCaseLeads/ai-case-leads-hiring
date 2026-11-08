/** Purpose comes from application-scoped durable task IDs, never editable email subjects. */
export function communicationPurpose(taskId: string | null | undefined, applicationId: string): string {
  const prefix = `gmail:${applicationId}:`;
  if (!taskId?.startsWith(prefix)) return "Email";

  const fields = taskId.slice(prefix.length).split(":");
  if (fields[0] === "reminder") {
    const leadTime: Record<string, string> = { "24h": "24-hour", "1h": "1-hour", "5m": "5-minute" };
    const label = leadTime[fields[3]];
    return label ? `${label} interview reminder` : "Interview reminder";
  }

  const names: Record<string, string> = {
    confirmation: "Acknowledgment email",
    rejection: "Rejection email",
    assessment: "Assessment invitation",
    interview: "Interview invitation",
    "booking-confirmation": "Interview booking confirmation",
    "booking-followup": "Booking follow-up",
    manual: "Recruiter email",
  };
  return names[fields[0]] ?? "Email";
}

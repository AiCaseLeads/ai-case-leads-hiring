import type { InterviewProgress } from "../../lib/hub/interview-progress";
import { Badge } from "./shared";
import { stageLabel, type ApplicationSummary } from "./types";

export const interviewProgressLabels = {
  none: "No interview requested",
  delivery_pending: "Invitation sending",
  requested: "Interview requested",
  pending: "Booking in progress",
  booked: "Interview confirmed",
  attendance_due: "Attendance unrecorded",
  completed: "Interview completed",
  no_show: "Interview missed",
  cancel_pending: "Cancellation pending",
  cancelled: "Interview cancelled",
  failed: "Interview needs attention",
} satisfies Record<InterviewProgress, string>;

export function ApplicantStageBadges({ application }: { application: ApplicationSummary }) {
  if (application.trashed) return <Badge>In Trash</Badge>;
  const { stage, interviewProgress } = application;
  const milestone = interviewProgress && interviewProgressLabels[interviewProgress];
  const showMilestone = milestone && (interviewProgress !== "none" || stage === "Interview");
  return <>
    {(stage !== "Interview" || !showMilestone) && <Badge>{stageLabel(stage)}</Badge>}
    {showMilestone && <Badge tone={interviewProgress === "booked" || interviewProgress === "completed" ? "success" : interviewProgress === "failed" || interviewProgress === "no_show" ? "warning" : "neutral"}>{milestone}</Badge>}
  </>;
}

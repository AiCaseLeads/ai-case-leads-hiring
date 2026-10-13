# Job hiring teams and email routing

Managers can assign up to 25 active managers/recruiters to each posting. Assignment does not grant login access: staff must first exist in Team access (configured owner accounts are also eligible). Recruiters can read teams; only managers change them.

`GET /api/job-team?jobId=...` returns `{data:{config,staff,sender}}`. Omitting `jobId` returns choices and `config:null` for a new posting. `PUT /api/job-team` accepts `jobId`, `expectedRevision`, and the fields below. A conflicting revision returns 409. Saving settings sends no mail.

```ts
type JobTeamInput = {
  members: string[];
  replyTo: string | null;
  notifyNewApplications: boolean;
  notifyAssessmentSubmissions: boolean;
  notifyReplies: boolean;
  notifyOverdueReviews: boolean;
};
```

Saved configs also have `revision`, `createdAt`, and `updatedAt`. The wizard's existing `POST /api/job-setup` optionally accepts `hiringTeam:JobTeamInput` with `expectedTeamRevision` (0 for a new/unconfigured team), saved atomically with the posting and scorecard. Omitting these fields preserves an existing team's settings. Teams are private; they do not enter public job metadata.

Future application acceptance, assessment submission, and known-thread inbound reply imports enqueue one internal Gmail task per selected recipient. Task ids are stable per event and recipient; retries do not duplicate notices. Historic replies from before team configuration and settings changes do not backfill notifications. Delivery rechecks the current job team, enabled preference, and active authorized membership. An explicitly empty team sends no internal notices and never falls back to the shared mailbox.

Overdue-review digests still require the global reminders switch. For configured jobs, their selected team and overdue preference replace legacy assignee/manager-fallback routing. Unconfigured legacy jobs retain their previous reminder behavior. Digest content and recipients are rechecked at delivery.

The connected Google account remains the actual sender; job routing does not impersonate staff or connect personal inboxes. Candidate messages add the selected active primary contact and the connected shared mailbox to Reply-To. Google mail clients may vary: replies sent only to an individual recruiter's inbox cannot be imported by the shared connection. Retaining the shared mailbox among reply recipients keeps it available for known-thread synchronization. No reply contact uses Gmail's normal shared-account reply behavior.

Tests cover separate and multiple teams, revocation, empty teams, optimistic conflicts, atomic wizard saves, duplicate event retries, actual assessment/reply hooks, uncertain delivery reconciliation, scoped overdue digests, and MIME header injection.

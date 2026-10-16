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

Future application acceptance, assessment submission, and known-thread inbound reply imports enqueue one internal email task per selected recipient. Task ids are stable per event and recipient; retries do not duplicate notices. Historic replies from before team configuration and settings changes do not backfill notifications. Delivery rechecks the current job team, enabled preference, and active authorized membership. An explicitly empty team sends no internal notices and never falls back to the shared mailbox.

Overdue-review digests still require the global reminders switch. For configured jobs, their selected team and overdue preference replace legacy assignee/manager-fallback routing. Unconfigured legacy jobs retain their previous reminder behavior. Digest content and recipients are rechecked at delivery.

Human candidate messages use the acting recruiter's connected Gmail account, with that recruiter as From and Reply-To. Automatic messages use SendGrid from `no-reply@aicaseleads.com`, with Reply-To `no-reply@notify.aicaseleads.com`. Authenticate the root sending domain and configure Null MX only on the notify reply subdomain. Test both replies and direct mail to the root no-reply address before asserting they are rejected. Job alerts keep their selected internal recipients, and sales is not a delivery fallback. Recruiters authorize their own mail separately from company Drive/calendar setup. See `CANDIDATE-EMAIL-PRIVACY.md` for transport checks and current reply-sync limitations.

Tests cover separate and multiple teams, revocation, empty teams, optimistic conflicts, atomic wizard saves, duplicate event retries, actual assessment/reply hooks, uncertain delivery reconciliation, scoped overdue digests, and MIME header injection.

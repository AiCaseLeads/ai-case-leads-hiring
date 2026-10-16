# Hiring workspace redesign

The workspace organizes daily work around a job and its applicants. Technical settings and less frequent actions appear when requested rather than displacing the work.

## Daily flow
1. Home: new applicants, shortlisted applicants, interviews, active jobs and overdue decisions.
2. Applicants: choose a job, then its pipeline and candidate list. Sort by AI match, shortlist, request an interview, select applicants and download CSV or ZIP.
3. Applicant: original application and files, concise AI strengths and gaps, expandable evidence, notes and communication history.
4. Jobs: compact posting rows with View applicants and Edit. Duplicate, templates and team settings live under Actions.
5. Create job: Job details → Application questions → Review setup → Publish. Draft saving and recovery remain enabled.
6. Reports: Overview → Sources → Team.
7. Settings: My connections → Team → Company → Help requests → Templates. Company tools group by Mail & Drive, AI, Notifications, Advanced.

## Naming
Stored stages remain unchanged for compatibility. Application Review displays as New. Screening displays as Shortlisted. AI readiness, configured screening-rule results, and recruiter decisions are separate facts.

The old qualification label Needs review conflated no configured screening rules or missing answers with an incomplete AI review. No rules should display neutrally; incomplete answers should be explained. AI scores represent requirements supported by submitted evidence, not a probability of hiring success.

## Sources and audit
Current screenshots in outputs/backend-redesign-audit document the old oversized help card, job cards, download panel, reports and settings. Workable's primary documentation supports the job-first pipeline and candidate actions: https://help.workable.com/hc/en-us/articles/115012857047-Candidate-profile-in-pipeline-view-overview and https://help.workable.com/hc/en-us/articles/8495289154839-Moving-candidates-through-the-pipeline.

## Verification limits
Screenshots alone do not verify mutations, permissions or mail delivery. Fixture-based tests cover actions, validation, navigation and layout. Live checks must use read-only real records or explicitly synthetic records. Recruiter Gmail authorization remains necessary before invitations can be delivered from that account.

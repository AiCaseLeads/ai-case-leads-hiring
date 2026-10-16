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

## Audit steps and outcome
1. Job applicants: the old download card displaced the applicant list. Replaced with a compact filter/pipeline toolbar and optional download panel.
2. Home: help/privacy management appeared above daily recruiting work. Moved to Settings; added direct active-job and applicant entry points.
3. Jobs: oversized cards exposed all actions at once. Replaced with rows and an Actions menu.
4. Reports: tables competed on one long page. Organized into Overview, Sources and Team with metric definitions.
5. Settings: onboarding instructions dominated the screen. My connections opens personal setup; less frequent company/technical controls are grouped and collapsed.
6. Applicant AI review: technical explanations and source quotes preceded useful synthesis. Supported requirements, strengths and questions now lead; original quotes expand on demand.
7. Job setup: oversized starting choices and repeated controls obscured the steps. Compact starting buttons and a four-step wizard retain drafts and validation.

Independent review resolved offscreen mobile menus, stretched mobile headers, action/tab spacing, and mismatches between displayed interview readiness and server prerequisites. A production-style test also exposed concurrent submission retries consuming the email spam quota repeatedly; the fix counts an allowed submission intent once while preserving limits for distinct attempts.

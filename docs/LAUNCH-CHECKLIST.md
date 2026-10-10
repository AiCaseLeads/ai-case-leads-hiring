# Launch checklist

Current state: owner-private Site, two draft roles, paused intake, no live Google grant. Local tests do not establish email delivery, bookings, Drive permissions, unattended processing, or DNS readiness.

## Configure while private

- [ ] Open `/team` → **Sign in to the hiring hub**. Verify the actual owner, a separate manager/admin, a recruiter, and an unauthorized account. Only admins may edit roles, rules, team access, Google configuration, and scheduler setup.
- [ ] **Overview** → **Create the two draft roles**, then **Roles & forms** → **Edit role & form**. Approve descriptions, work arrangement, questions, assessment prompts, privacy/retention notice, and recruiting contact. Keep roles draft until controlled testing is arranged.
- [ ] Check required Name/Email fields, optional resume/portfolio choices, rejection text, and saved form changes. Review every qualification requirement; leave automatic rejection off unless explicitly approved and tested. Missing answers must require review rather than automatic rejection.
- [ ] Follow [Google Workspace setup](GOOGLE-WORKSPACE-SETUP.md). Securely save the client, grant the recruiting account, verify its displayed sender, and save an explicit Calendar ID, time zone, duration, weekdays/window, and private Drive root.
- [ ] Confirm the intended Sites identity, D1/R2 bindings, and applied migrations. Existing server encryption/scheduler secrets must remain server-side; no credentials belong in public source or chat.

## Controlled end-to-end test

Use authorized test candidates and an approved staging audience. If testing requires intake to be enabled, restrict that environment and close it again afterward.

- [ ] Submit one application per role on desktop and mobile. Verify original answers/files, source attribution, receipt, one hiring record, and separate applications from the same person.
- [ ] Exercise required answers, invalid/expired uploads, closed jobs, stale forms, repeated clicks, and a lost response. Retry the same recovery payload/key and verify no duplicate application. Never show a successful receipt before acceptance.
- [ ] Verify qualification evidence, manual rejection, and exactly one rejection email per decision. If enabling automatic rejection, separately prove approved known failures reject and missing information stays in review.
- [ ] A reviewer initiates an assessment, submits through the emailed link, and sees the exact answer in the application. Expired/revoked links must fail.
- [ ] A reviewer initiates an interview. Verify genuine availability, time zones, booking conflicts, pending states, Meet creation, rescheduling, cancellation, and the Calendar invitation. Record attendance in the hub.
- [ ] Gmail interview reminders default off. After approval, enable **Team & settings** → **Send interview reminders through Gmail**. Verify 24-hour and 1-hour reminders for confirmed future bookings, and no reminders for pending, cancelled, replaced, or past bookings. Confirm each reminder is sent once with the correct time zone and Meet link.
- [ ] Verify acknowledgement, rejection, manual email, and known-thread replies in Gmail and the matching communication history. An uncertain Gmail send must be checked by exact Message-ID, never blindly resent.
- [ ] Verify **Recruiting / Job / Candidate–Application ID** in the selected private Drive root, including original files, answers, assessments, and available hiring history. Confirm correct application/file identity when names repeat.
- [ ] Interrupt Google authorization or Drive access. Accepted applications remain accepted; tasks expose errors. Restore access, retry safe failures, reconcile uncertain Calendar work, and prove no duplicate records/events/files.

## Processing and release

- [ ] **Team & settings** → **Show scheduler configuration**. Install the team-owned Apps Script with the displayed Script properties. A private Site needs a verified hosting service-authentication mechanism; validate renewal/lifetime rather than assuming the scheduler secret bypasses sign-in.
- [ ] Run the scheduler manually, then observe a scheduled execution and completed hub tasks. Confirm queue recovery, reply polling, error visibility, and owner response to failures. Until this passes, processing is manual through **Integration tasks** → **Process pending tasks**.
- [x] Local isolated 3,000-record and 100-simultaneous-request checks passed. Record cloud/Google quota and capacity limitations separately.
- [ ] Complete the final release build, production Worker browser checks, independent review, and dependency review. Resolve blocking findings and record the actual review method.
- [ ] After controlled Google evidence and owner approval, authorize the intended public audience and connect `jobs.aicaseleads.com`. Verify the correct build, TLS, exact OAuth callback URI, emailed link origin, and scheduler origin.
- [ ] Publish the approved roles and set `APPLICATIONS_ENABLED=true` only after these gates pass. Repeat one authorized application per role through receipt → hub → email/assessment/interview → Drive.

## Rollback

Set intake back to false and close affected roles if submission integrity is uncertain. Preserve accepted applications, upload metadata, receipts, history, and tasks. Do not delete records or send automatic compensating rejections. A Google outage is a task recovery problem; D1 remains the authoritative record.

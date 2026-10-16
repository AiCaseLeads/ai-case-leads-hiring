# Recruiting access and invitations

## Recruiter handover

Open [the hiring workspace](https://jobs.aicaseleads.com/team) with the work Google account that received the invitation. Maria uses **Settings → My connections** to connect her own recruiting Gmail and Google Calendar, then saves interview availability. Account holders complete their own Google consent; the owner does not need their password.

Under **Jobs → Actions → Hiring team & emails**, select the people handling each posting and its applicant reply contact. Leave the owner unselected when they should receive no job alerts. A job team can include multiple recruiters. Under **Settings → Team**, the head recruiter invites the other recruiters; each person connects their own accounts. See the [recruiter handbook](../public/recruiter-guide.pdf) and [quick start](HIRING-QUICK-START.md).

Settings uses **My connections**, **Team**, **Company**, **Help requests**, and optional **Templates**. Company is owner-only and separates **Files & calendar**, **AI**, **Messages & reminders**, and **Advanced**. Help requests holds applicant support/privacy submissions; it is no longer a large Home panel.

**New** and **Shortlisted** are UI labels for the existing stored Application Review and Screening stages. **No screening rules** means no configured rule decision; **Check answers** means a configured rule outcome needs checking. AI scores stay separate. **Shortlist** records the stage change; **Request interview** opens the readiness-checked booking controls, and **Send booking link** explicitly sends the invitation.

Connection status does not prove delivery. Complete a controlled test with a team-owned inbox, synthetic application, matching Drive file, selected calendar booking/reschedule/cancellation, and intended job alerts. Held messages are not automatically released by authorizing Gmail.

## Permission model

The owner account comes from the server `ADMIN_EMAILS` allowlist. The database retains its existing `admin` / `recruiter` role enum: a stored admin is displayed as **Head recruiter**, never as owner. `HubMember.isOwner` is derived at authentication, not accepted from a browser command.

- Owner: company Google connection, credentials, AI configuration, and appointing head recruiters.
- Head recruiter: invite, update, and revoke ordinary recruiters; manage jobs, hiring teams, scorecards, and review operations.
- Recruiter: create/manage jobs, assign existing staff to a job, review applications, and configure their personal Gmail and calendar. Assigning someone to a job does not grant login access.
- No team command can change the actor's own access or a configured owner. A head cannot appoint or alter another head.

## API

`GET /api/team` returns `{data:{canManageTeam,members}}`. Each member contains email, stored role, active, isOwner, updatedAt, and invitation status (no provider tokens).

`POST` and `PATCH /api/team` accept `{email,role,active,sendInvite,expectedUpdatedAt?}`. Pass `expectedUpdatedAt` when updating an existing member. Only authorized head/owner sessions and same-origin requests may write. Existing bulk membership writes through `/api/hub/settings` are disabled; company settings are owner-only.

`sendInvite:true` creates one durable invitation when none exists. Repeating the same save does not resend. Explicit `resendInvite:true` creates a fresh invitation after five minutes only when the previous invitation is sent, failed, or cancelled. Pending, running, or uncertain delivery must finish/reconcile first. Setting active false cancels any unsent invitation and invalidates access on the next session check.

## Durable delivery

Membership, invitation, and audit updates are atomic. Invitations live in `hub_settings` under `staff_invite:<normalized-email>`, independently of applicant tasks: no fake applicant is created. The regular worker processes at most three invitations per cycle. It rechecks recipient membership before delivery and uses a stable RFC Message-ID. Conditional leases avoid concurrent sends; a crashed lease or ambiguous Gmail response is reconciled by Message-ID without resending. Definite failures retry with backoff. The team panel exposes pending/failed/uncertain status for intervention.

New invitations use the independent SendGrid sender; there is no sales-mail fallback. Legacy uncertain invitations reconcile only in their original Gmail account. The invitation links to `/team?view=settings` and `/recruiter-guide.pdf`, explains that the recruiter signs in using their own Google account, and asks them to connect their personal recruiting Gmail and Calendar under My connections. It does not carry a password, application data, or bearer access token. The invite does not prove sign-in, calendar consent, or inbox delivery; those are separate verification steps.

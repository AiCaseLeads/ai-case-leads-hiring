# Candidate email identity

Automated candidate Gmail tasks (receipt, rejection, assessment, booking links and reminders) always use `no-reply@aicaseleads.com` for From and Reply-To. Job teams control internal recipients only. Queued legacy sender/reply headers are discarded. Templates containing any current or former staff or connected-account email fail closed for correction; the worker never silently sends those addresses to an applicant.

Connect a dedicated authorized no-reply mailbox, or configure that address as an accepted Gmail send-as identity on the connected account. The alias path requires reconnecting Workspace with `https://www.googleapis.com/auth/gmail.settings.basic`; the worker verifies `GET https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs` has a matching `sendAsEmail` and `verificationStatus: accepted` before each send. Missing aliases, pending verification, and missing permission block delivery and surface a failed integration task. Internal team alerts continue through the connected account.

The application controls the MIME From/Reply-To and never adds applicant Cc, Bcc or Sender headers. Google controls transport headers. Before claiming staff identities hidden, inspect an actually received message's From, Reply-To, Sender, Return-Path, expanded sender details and body. A dedicated no-reply account is necessary if Google reveals the underlying account through an alias. Do not claim this changes earlier delivered messages.

Calendar/Meet invitations are a separate Google product. The organizer address can remain visible to interview attendees. A shared recruiting calendar/account is required if personal organizer identities must also be hidden.

## Replies and owner notifications

The no-reply address must reject inbound messages, not forward them to the connected account. Configure a Google Workspace incoming-mail rule matching only the exact no-reply recipient, with Reject Message. This is separate from outbound Gmail send-as verification. Prove it with a controlled inbound delivery attempt and mail-log evidence before claiming it works. Do not recommend replying to no-reply for privacy requests. Applicant help and privacy requests go to `/help` and the private recruiting dashboard, without staff email notifications.

Every automated candidate message includes a do-not-reply notice and the help URL. Existing delivered messages cannot be edited.

Ownership and Google authorization do not automatically subscribe the owner to job alerts. To stop owner notifications, remove the owner from each job's team, from overdue-review `fallbackAdmins`, and from legacy applicant assignments where no explicit job-team configuration exists. Current routing is checked again before queued messages are sent. Keep Calendar and Drive credentials intact. Calendar-organizer messages from Google are separate from app notification settings.

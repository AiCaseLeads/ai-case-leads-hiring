# Submission and task recovery

The custom hub commits the application, answer/form snapshot, linked uploads, accepted receipt tracking, and initial outbox work atomically in D1. Gmail, Calendar, and Drive run afterward. Their failure never removes an accepted application.

## Applicant loses the submission response

The application form saves the exact submitted payload and submission key in this browser session before sending. If the response is uncertain, it freezes edits and offers a status recheck using **the same payload, key, session, and uploaded-file handles**. Reload in the same browser session restores that pending attempt.

The server checks the stored session and payload fingerprint. A matching accepted retry returns a receipt for the original application rather than creating another application. It does not resend acknowledgement/rejection decisions. A changed payload or a reused key from another session is refused.

Do not tell the applicant to start a new application, clear recovery storage, or use another browser while the outcome is unknown. Corrupted recovery storage fails closed. If the session/payload is lost or the response remains unclear, a staff member should inspect **Applications** and preserve the incident for an authorized database investigation. Name, email, and approximate time alone are not proof of exact submission identity. There is no active manual “mark accepted” endpoint.

A known validation failure lets the applicant correct the form. When a form version changed, review the refreshed questions and requirements before submitting; entered answers are preserved in the current form, but full-page persistence of unsent edits is not guaranteed.

## Accepted application has delayed external work

Open **Integration tasks** in `/team`. Attention states are shown first; use pagination to inspect older tasks. Select **Process pending tasks** for manual processing until unattended scheduling has been verified.

- **Failed Gmail/Drive tasks:** correct the underlying authorization/configuration problem, then use **Retry safely**. Durable task identity and file/event IDs prevent duplicate work where the adapter supports retries.
- **Uncertain Gmail:** there is no resend control. The processor searches Gmail Sent using the exact stable Message-ID and verifies its headers. “Not observed” is not proof of failure because search may lag. A manager must investigate the connected mailbox before any decision to send a replacement.
- **Uncertain Calendar:** use **Reconcile Calendar**. It reuses the persisted event ID and revision to resolve the outcome safely. A booking stays pending until a valid event and Meet URL are confirmed.
- **Drive outage:** keep the application accepted. Correct permissions/root/authorization, then retry. Reserved Drive IDs, private metadata, and persisted resumable sessions must match the original application and R2 files.

Use **Team & settings** to reconnect Google when its grant is revoked and to inspect reply-polling errors. Terminal hiring decisions revoke candidate links and cancel future interview work; verify any uncertain cancellation through Calendar reconciliation.

Preserve tasks, answers, original files, and audit history during recovery. Do not expose applicant records, emailed private tokens, Google credentials, scheduler secrets, or raw API responses in public logs or support messages.

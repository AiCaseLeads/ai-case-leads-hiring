# Independent automatic-email rollout — 16 October 2026

The user's existing SendGrid account replaces the automatic Gmail alias path. Automatic receipts, screening rejections, timed reminders, internal job alerts and new team invitations use AI Case Leads Recruiting <no-reply@notify.aicaseleads.com>. Human recruiter conversations stay in personal Gmail. Company Drive and Calendar remain separate.

A restricted key was created with Mail Send and Sender Authentication read; live `/v3/scopes` confirmed only mail.send and whitelabel.read plus account eligibility flags. The key and signed-event public verification key were saved privately in Railway without triggering an intermediate deployment. No new subscription or Email Activity add-on was purchased. Notify-domain authentication and Null MX must complete before sending. The outgoing-domain check fails closed; temporary DNS errors defer and retry rather than permanently parking mail.

## Verification

- 532 backend tests passed; 3 native OCR tests skipped because local native OCR binaries are unavailable. Existing OCR behavior was not changed.
- 21 Railway/runtime checks passed.
- 17 focused browser tests passed, plus the independent UI agent's role/layout tests. Responsive setup, capacity waits, DNS waits, held recovery and uncertain-send controls were checked.
- TypeScript, scoped ESLint, Railway production build and diff checks passed.
- 1,000 simultaneous SQLite email-budget reservations admitted exactly 300; all 700 excess reservations deferred. Accepted applications are independent of email delivery.
- Signed callbacks tested against SendGrid's published signature fixture, a 1,000-event deduplicated burst, bounded shared-account batches above768KB, malformed/stale signatures and mixed unrelated events. No callback changes a hiring decision or sends a new email.
- Independent review caught/fixed the old staff-invite sender, misleading quota setup labels and a permanent hold after transient DNS outages.
- RuFlo's strict swarm watchdog passed. Its review execution failed with an invalid provider model ID; this is not a Claude review verdict. The actual independent Codex review and tests above form the review evidence.
- The linked recruiter handbook was regenerated and all6 rendered pages inspected.

## Safe historical recovery

Connecting the provider never automatically releases historical setup-held messages. Recovery previews exact recipients, stage/decision currency, invitation validity, row/communication snapshots, regenerated envelopes and provider fingerprint; provider changes invalidate the plan. Old uncertain Gmail sends remain Gmail reconciliation-only. A SendGrid POST timeout, 5xx, malformed202 or local persistence failure stays uncertain; absent provider evidence never licenses a resend.

## Outstanding live gate

Verify notify-domain DNS authentication, Null MX bounce, the signed callback on the deployed endpoint, actual received From/Reply-To/Sender/Return-Path/body, and one controlled receipt/rejection before releasing eligible historical candidate mail. API acceptance is separate from inbox delivery. Record completed live checks below rather than claiming setup is delivery.

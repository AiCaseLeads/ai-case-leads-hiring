# Independent automatic-email rollout — 16 October 2026

The user's existing SendGrid account replaces the automatic Gmail alias path. Automatic receipts, screening rejections, timed reminders, internal job alerts and new team invitations use AI Case Leads Recruiting <no-reply@aicaseleads.com> with Reply-To no-reply@notify.aicaseleads.com. Human recruiter conversations stay in personal Gmail. Company Drive and Calendar remain separate.

A restricted key was created with Mail Send and Sender Authentication read; live `/v3/scopes` confirmed only mail.send and whitelabel.read plus account eligibility flags. The key and signed-event public verification key were saved privately in Railway without triggering an intermediate deployment. No new subscription or Email Activity add-on was purchased. Root-domain authentication and reply-subdomain Null MX must verify before sending. The earlier design used the Null MX domain in From; RFC 7505 prohibits that, so only Reply-To uses notify. The existing root-domain authentication and Google MX remain intact. The outgoing-domain check fails closed; temporary DNS errors defer and retry rather than permanently parking mail.

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

Verify root-domain DNS authentication, notify Null MX bounce, direct root no-reply rejection, the signed callback on the deployed endpoint, actual received From/Reply-To/Sender/Return-Path/body, and one controlled receipt/rejection before releasing eligible historical candidate mail. API acceptance is separate from inbox delivery. Record completed live checks below rather than claiming setup is delivery.

## Live deployed evidence

GitHub main commit1fe876cd9f14c7c5c3c97e5abe5432bfa2e6b1da deployed successfully as Railway24552286-64b5-4b6f-a1b7-37176c364c82. Health returned ready with storage/background true. Unauthenticated provider status returned403, and an unsigned callback returned401. The live Company settings card recognized the saved key but correctly remained Setup incomplete while notify-domain DNS was not yet authenticated.

The dedicated SendGrid webhook7d566f26-ea06-46ea-8e9d-01ad69bb4427 is enabled with signatures and only processed/dropped/deferred/bounced/delivered events. SendGrid's integration test returned204; Railway HTTP records independently confirmed two actual POST callbacks returned200 at15:01:20UTC and15:03:04UTC. Test payloads had no application correlation and were ignored without creating candidate records.

The earlier DNS handoff above reflects setup at that time. Root-domain authentication is used for outbound mail; live verification of reply-domain Null MX and the existing root no-reply rejection rule is still required. Actual no-reply receipt/rejection delivery, incoming bounce and historical applicant recovery remain pending. Do not interpret callback success as outbound-email delivery. No actual applicant backlog was released during this setup.

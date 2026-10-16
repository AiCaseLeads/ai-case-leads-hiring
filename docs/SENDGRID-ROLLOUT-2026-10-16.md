# Independent automatic-email rollout — 16 October 2026

The user's existing SendGrid account replaces the automatic Gmail alias path. Automatic receipts, screening rejections, timed reminders, internal job alerts and new team invitations use AI Case Leads Recruiting <no-reply-recruiting@aicaseleads.com> with Reply-To no-reply@notify.aicaseleads.com. The distinct root no-reply-recruiting From address avoids the existing no-reply alias entirely; no mailbox or alias is created. Human recruiter conversations stay in personal Gmail. Company Drive and Calendar remain separate.

A restricted key was created with Mail Send and Sender Authentication read; live `/v3/scopes` confirmed only mail.send and whitelabel.read plus account eligibility flags. The key and signed-event public verification key were saved privately in Railway without triggering an intermediate deployment. No new subscription or Email Activity add-on was purchased. Root-domain authentication and reply-subdomain Null MX must verify before sending. The earlier design used the Null MX domain in From; RFC 7505 recommends against that, so only Reply-To uses notify. The existing root-domain authentication and Google MX remain intact. The outgoing-domain check fails closed; temporary DNS errors defer and retry rather than permanently parking mail.

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

IONOS records are saved and publicly visible: notify MX `0 .`, the three exact SendGrid CNAME records and notify DMARC. SendGrid verified the additional notify authentication. The final transport uses the existing authenticated root domain for From; only Reply-To uses notify. Root Google MX and the Railway jobs CNAME were verified unchanged.

Independent review caught a deliverability issue in the earlier design: RFC7505 recommends against using a Null MX domain in From. The final unassigned From address is `no-reply-recruiting@aicaseleads.com`, avoiding Maria's existing alias entirely. It creates no mailbox or Gmail sending dependency.

A controlled SendGrid probe arrived in a team-owned test inbox with SPF, DKIM and DMARC pass. Actual From/Reply-To matched the final pair; no recruiter or owner identity appeared as sender. Signed events recorded processed and delivered. A separate probe addressed directly to the unassigned From address received Google550/5.1.1 NoSuchUser, independently confirmed in SendGrid's Bounces view. A technical reply-domain test received a delivery-status notification with5.1.10 (Null MX), rather than delivering a reply to a staff inbox. SendGrid's Return-Path uses its em9099 bounce domain; the encoded recipient in that address is not a recruiter sending identity.

The final sender regression suite passed534 tests with3 unchanged native OCR skips;20 related browser tests passed. Independent review reran71 focused backend tests and found no blocking regression. The regenerated6-page PDF was rendered and inspected, including the final From/Reply-To instructions. RuFlo review execution still fails because its configured model ID is invalid; no Claude review verdict is claimed.

The real public form was tested through the deployed CAPTCHA/upload flow with two clearly synthetic applications and a PDF. The eight-year answer passed the test minimum of seven; the one-year answer entered Rejected. Both records and originalPDFs were saved; authenticated file download returnedapplication/pdf with matching1680-byte PDF contents. Both Drive folders contained only applicationPDF revisions and the original resumePDF, with noJSON files. The test role was closed afterward, AI matching was disabled, and its empty hiring team produced no recruiter alerts.

Exactly one receipt arrived for the passing application; one receipt and one rejection arrived for the failing application. All three had the final From/Reply-To, SPF/DKIM/DMARC pass, no staff sender/body leak, and signed processed/delivered events. The rejection explained the synthetic minimum of seven. Revisiting the first form returned its saved confirmation rather than creating a duplicate.

The existing SendGrid EmailAPI plan was verified read-only as Essentials50K, with50,000emails/month and2,775used at the check. No plan or billing change was made. The app's daily attempt budget was raised to1,000within the existing allowance, sufficient for normal expected recruiting traffic and this backlog. Provider capacity/rate limits still defer safely; APIacceptance is distinct from recipient delivery. Historical recovery is underway using exact reviewed plans. A plan whose records changed was correctly rejected atomically with no sends, then will be refreshed after current processing.

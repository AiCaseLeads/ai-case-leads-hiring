# Candidate email identity

Automatic receipts, automatic screening rejections, reminders, internal job alerts and new staff invitations use **SendGrid**, independently of recruiter Gmail. From is `no-reply-recruiting@aicaseleads.com`; Reply-To is `no-reply@notify.aicaseleads.com`, branded AI Case Leads Recruiting. There is no staff CC/BCC and no Gmail fallback. [Automatic email setup](AUTOMATIC-EMAIL-SETUP.md) covers the existing SendGrid account, restricted Railway key, authenticated domain and signed delivery callbacks.

`notify.aicaseleads.com` is a separate reply-only domain. The app keeps it out of From because RFC 7505 recommends against using a Null MX sender domain. A Null MX record (`0 .`) there rejects inbound mail without an inbox or Google alias. It does not change normal company Google mail. Configure and test this DNS record before claiming replies bounce; the address name alone does not reject mail. Provider-managed Return-Path handles outgoing delivery failures. The root From domain retains normal Google MX. The no-reply-recruiting From address has no staff mailbox or alias. Before releasing held emails, test direct mail to this address and verify it bounces without reaching a company catch-all inbox.

The worker discards legacy sender/reply headers and checks automatic templates for private staff addresses. Test an actually received message's From, Reply-To, Sender, Return-Path, expanded sender details and body before claiming identity isolation. Existing delivered emails cannot be edited.

## Recruiter conversations and calendars

Messages deliberately sent by a recruiter, manual decisions and assessment/interview invitations use that active recruiter's own connected Gmail address. Those replies belong in the recruiter's inbox. If the actor is unavailable, only the explicit active job reply contact or application assignee may be used; otherwise sending stops for setup. Sales is never a recruiter reply contact. Google Calendar/Meet organizer identities are separate and can be visible to attendees.

Company Google provides Drive archival and optional fallback Calendar. `CANDIDATE_MAIL_ACCOUNT` remains only for existing Gmail reply synchronization and legacy uncertain-delivery reconciliation; it no longer selects the automatic sender. Each recruiter separately consents to their personal mail and calendar. Do not claim every recruiter inbox is synchronized.

## Queue, limits and recovery

Applications and original files save before any email call. The atomic app email budget defaults to 300 provider attempts per UTC day; it is an app limit, not a promise about the existing SendGrid subscription. Configure `AUTOMATIC_MAIL_DAILY_LIMIT` to an approved account allowance. Provider quota/rate waits preserve pending messages and do not spend the eight-attempt failure budget.

A missing key or unauthenticated domain is a pre-send setup hold. Connecting SendGrid does not automatically release historical held applicant messages. Preview exact recipients, subjects, current decisions and invitation expiry in Delivery activity, then release approved records. Rejections that are no longer current are excluded.

Before a provider write, the task records its provider, credential fingerprint and intended recipient under its lease. An uncertain result stays reconciliation-only. Old uncertain Gmail sends remain Gmail; they never migrate to SendGrid. SendGrid has no assumed Mail Send idempotency guarantee. Signed provider events or an explicitly enabled, already-entitled Email Activity API can confirm acceptance. Missing evidence is never proof that resending is safe.

API acceptance is not inbox delivery. Signed delivery events distinguish processed, delivered, bounced and dropped outcomes; they never make a hiring decision or trigger a duplicate email. The server key stays in Railway, never in browser code or chat.

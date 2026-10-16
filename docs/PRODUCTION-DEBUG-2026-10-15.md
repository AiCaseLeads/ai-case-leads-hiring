> Update16October: the automatic Gmail alias path below is superseded by SendGrid. See [SendGrid rollout](SENDGRID-ROLLOUT-2026-10-16.md). Earlier diagnostic evidence remains historical; it is not the current setup instruction.

# Hiring production debugging — 15 October 2026

## Reproduced causes and fixes

- Draft exit actions had zero spacing on the live site. Dialog actions now have separate targets, wrapping/stacking on small screens, focus separation and background scroll locking. An unchanged existing job can exit without a draft warning.
- The last job's download flyout could extend outside the document and create blank scroll space. Jobs now expose a direct ZIP download; other action menus are bounded to the viewport and close on outside click, Escape or scrolling away.
- Advanced filters aligned to the bottom of unequal-height labels. Reviewer-grade help placed its control 24.5px above Screening/Assigned to in production. Controls now align at the top.
- AI matching used one awaited provider request per cycle and re-derived every applicant after unrelated job edits. Three bounded provider lanes share a single PDF reader. Both job-save APIs reuse completed evidence atomically when title/description are unchanged. Description/title changes still require new analysis. Current-version state and retry/capacity details remain explicit.
- Actual API calls, not missing PDFs or busy local parsers, spend the hourly AI budget. The default remains 120 requests/hour; no production limit was increased. Worker lease fences and configuration snapshot guards prevent stale work from spending credits or restoring older credentials.
- Failed email tasks require a verified Google identity and accepted send-as alias. Bulk recovery previews one chosen Bogotá day, queues at most 200 exact original messages per plan, and preserves Message-ID. Sent/uncertain/cancelled work, expired/replaced invitations and obsolete rejections cannot be blindly replayed. Reopening a rejected applicant cancels unsent rejection work and cannot race an active rejection send.

## Release verification

- Independent review reproduced worker lease, rejection-decision and AI settings races, then verified their fixes.
- Actual SQLite tests exercise both hub job updates and wizard transactions: completed scores, evidence, source answers, revisions and history survive question/location edits without provider calls. Stale writes/catalog conflicts do not copy scores.
- Browser regressions cover modal actions, last-row downloads, filters, mobile widths 320–1728px, short windows and actual 130%/200% Chrome zoom. Production paths are also checked after deployment.
- The built Railway Node server accepted 3,000 synthetic applications, including a 1,000-request burst and 1,002 private PDFs; files, duplicate protection and restart persistence passed. This local isolated run does not measure Railway throughput or real Google/provider delivery.
- The AI queue test drains 1,000 actual SQLite records with three mock-provider lanes and one PDF reader, one charge/history per applicant and no stage changes. Mock timings are not a live completion estimate.

## Email setup gate

At the live inspection, Maria's Google grant could refresh, her Gmail profile matched, and send-as settings could be read. Only her primary mailbox was listed. `no-reply@aicaseleads.com` was not an accepted sender, so automatic receipts must remain held.

Automatic receipt headers are constructed with no-reply From/Reply-To, no CC/BCC and no staff identity in the body. Google-added recipient headers must still be inspected in a controlled delivery before releasing the no-reply backlog. Connecting Gmail alone does not finish send-as setup. A recipient never receives access to Maria's inbox, but sender-address privacy is a separate live check.

The owner must complete Google Admin reauthentication to inspect the domain alias. Maria must approve/add the no-reply send-as entry in her own Gmail if it is absent. Ordinary user OAuth cannot create send-as aliases through the Gmail API; do not work around this by spoofing headers or silently introducing domain-wide delegation.

Owner recovery path: Settings → Delivery activity → Recover failed emails → select 15 October (Bogotá) → Preview failed emails. Review exact identities and exclusion reasons, then retry only a verified plan. Repeat remaining eligible batches; a queued count does not prove delivery.

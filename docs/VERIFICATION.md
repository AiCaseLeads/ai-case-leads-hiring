# Verification record

Updated October 9, 2026. The active system is the custom Sites D1/R2 hub with Google adapters. The evidence below uses synthetic/local records and isolated Google transports; it does not establish live Google authorization, delivery, Calendar/Meet booking, Drive archival, unattended scheduling, or public DNS.

## Latest local evidence

- **142/142 integrated tests passed**, with full lint and TypeScript checks passing. The suite includes custom acceptance/upload/security/workflow/task tests, Google adapter fixtures, and retained legacy isolated compatibility tests. Legacy tests are not evidence of an active external hiring backend.
- **14 public browser checks passed against the integrated development server.** Real custom API checks confirm draft roles are hidden, intake rejects writes while paused, private hub sign-in uses Sites, and arbitrary receipts do not confirm acceptance. Intercepted application fixtures include exact form version, required answers, upload errors/expiry, repeat clicks, source tracking, uncertain-response recovery, and safe text rendering.
- **15 production browser checks passed against the final built Worker**, including JS/CSS asset availability and missing-asset cache protection. Native hosted checks also verified actual owner access, editable draft roles, empty application/report/task states, Google setup controls, default-off reminders, and mobile navigation without horizontal overflow. Hosted probes rejected anonymous/forged staff access and paused submissions.
- **Nine dashboard/candidate UI fixture groups passed with zero page errors**, including editable role questions, note writes, source-quality counts/rates, secure client setup and secret clearing, masked scheduler setup, owner/inactive-member access preservation, default-off reminder opt-in payloads, task recovery, mobile navigation, assessment confirmation, and pending interview booking. See [CUSTOM-UI-VERIFICATION.md](CUSTOM-UI-VERIFICATION.md).
- Source-quality cohort tests verify distinct actual Interview visits and qualification/hire rates per application source. Reminder tests verify default-off manager setup, confirmed future-only 24-hour/1-hour enqueue, transactional setting races, and cancelled/rescheduled/past/inactive suppression before Gmail.
- Drive tests now cover immutable application revision exports, stale worker completion after lease expiry, revision-aware reconciliation, and atomic archival after Gmail/Calendar updates. A post-send database failure stays uncertain and cannot trigger a second email.
- Separate native-browser checks exercised actual local D1 draft-role creation, editing, and settings saves. These are local persistence checks, not Google integration validation.
- The custom load fixture sent **3,000 distinct applications in batches of 100 simultaneous HTTP requests** through the real custom application handler and migration SQL backed by local SQLite. It persisted 3,000 applications, accepted submissions, and acknowledgements, with 6,000 isolated Gmail/Drive tasks and distinct receipts. A further **100 simultaneous requests for one repeated key** produced only one additional application and two tasks. Issued receipts worked and an unissued receipt failed.

Load timings and consistency in local SQLite do not prove distributed D1 behavior, production throughput, Google quotas, or delivery latency. A repeated accepted request may issue another receipt while still referring to the same application.

## Repeatable checks

```sh
npm run typecheck
npm run lint
npm test
npm run test:load
npm run test:ui
npm run build
npm start -- --port 5174
```

Run the production browser suite separately with:

```sh
TEST_PRODUCTION_ASSETS=true TEST_BASE_URL=http://127.0.0.1:5174 npm run test:ui
```

The UI suite launches isolated headless Chrome and defaults to the integrated dev server on port 5173. Production Worker verification must be recorded after the final build; a development pass alone is insufficient.

## Review and live limitations

A previous private deployment exposed a production-only Vinext Link TypeError: navigation looked clickable but did not move. Careers, privacy, and hub navigation now use native anchors. The release smoke suite covers navigation and page errors in the built Worker.

A private release also exposed stale cached build assets during the Sites version transition. The source asset binding uses `no-store`, verified in the built Worker suite. Sites controls hosted successful-asset responses and serves them with `public, max-age=0, must-revalidate`; direct hosted checks verified this policy and all referenced JS/CSS returned 200. Worker-generated missing build assets return `404` with `no-store` and no ETag/Last-Modified validators, verified both locally and hosted. An already cached error needs a fresh browser reload. This change preserves private records and API cache policies.

Independent Codex review has exercised implementation risks and fixes. The earlier RuFlo execution rejected its configured model and the Claude runner lacked authentication; those attempts are not a successful Claude/RuFlo review. Keep the final review outcome explicit in the release record.

Live checks still required: actual separate-account permissions; approved role content/rules/privacy; Google grant and sender; email delivery/replies and uncertain-send reconciliation; availability/conflicts/time zones/Meet/rescheduling/cancellation; exact Drive identity and outage recovery; unattended scheduler access; production quotas; and domain/TLS. Automatic rejection remains off and intake remains paused until approved live checks pass. Follow [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md).

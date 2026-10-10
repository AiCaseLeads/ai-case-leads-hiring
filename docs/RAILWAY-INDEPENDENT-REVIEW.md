# Railway migration independent review

Review date: 2026-10-09. This review covers the Railway edition in the `railway-hosting` integration worktree. It does not establish that Railway, Google, or the public domain has been deployed or validated.

## Scope and independence

The reviewer inspected other workers' staff authentication, Node HTTP boundary, startup and shutdown, background processing, build graph, Docker image, Railway IaC, and setup instructions. The reviewer implemented the SQLite/filesystem adapters and backup command, so those files are **not represented as independently reviewed here**. Their tests are reported as implementation evidence; the parent reviewer owns their independent review.

Files examined include `lib/railway/auth-{config,core,oidc}.ts`, `lib/hub/auth.ts`, `app/chatgpt-auth.ts`, the Google sign-in/logout routes, `scripts/{start-railway,railway-http,build-railway}.mjs`, `lib/railway/{worker,background,config}.ts`, `app/api/health/route.ts`, `vite.railway.config.ts`, `Dockerfile`, `.dockerignore`, `.railway/railway.ts`, `.env.railway.example`, `lib/workspace-config.ts`, and the deployment/setup guides. Existing hiring mutation, candidate, file, and task boundaries were inspected where the hosting change affects them.

RuFlo execution was attempted by the coordinating agent but rejected its model route. Local Claude runners were not authenticated. This is an independent Codex review, supplemented by isolated tests; it is not a successful Claude review or a live provider test.

## Findings and gate

No reproduced P0/P1/P2 security or correctness blocker was found in the reviewed authentication/runtime changes. The result is a **local code-review gate**, conditional on the live acceptance checks below. One setup-guide sentence about uncertain Gmail delivery needed clarification: the implementation searches for the exact sent-message identity and never automatically resends an uncertain write. The parent reviewer corrected that sentence, and the final wording was checked.

An intermediate typecheck found two `Response.json()` result assertions in the runtime tests typed as `unknown`; the owning worker corrected them. The final typecheck, lint, and whitespace checks passed.

## Security and recovery evidence

- Railway staff identity comes exclusively from an opaque cookie whose hash is in the private session table. Spoofed Sites/OpenAI headers and applicant-session cookies cannot become staff identity (`lib/hub/auth.ts:13`, `lib/railway/auth-core.ts:39`). Unknown accounts have no first-user administrator path. Current membership and explicit revocation are checked on every request, including the configured owner (`auth-core.ts:30`).
- Google sign-in binds one-use authorization state to the initiating browser, PKCE verifier, and nonce. The state claim is one atomic database write, so a wrong browser cannot consume it and concurrent callbacks exchange one code (`auth-core.ts:79`). Tokens are accepted only after an RS256 signature and issuer, audience, authorized-party, expiry, nonce, and verified-email checks (`auth-oidc.ts:60`). Provider URLs are pinned, redirects are rejected, response bodies are capped, and fetches have a timeout (`auth-oidc.ts:22`).
- Staff cookies use `__Host-` names on HTTPS with HttpOnly, Secure, SameSite=Lax, and a twelve-hour server expiry. Logout is an explicit POST with an exact-origin check; GET only renders a confirmation form (`auth-core.ts:100`). Recruiting Gmail/Calendar/Drive consent is a separate flow, with no recruiting token created by staff login.
- Application URLs derive from configured origin rather than client Host or forwarding headers. The HTTP wrapper discards Sites/Cloudflare identity and forwarding headers before supplying normalized host, scheme, and client address (`scripts/railway-http.mjs:6`). Railway documents `X-Real-IP` as the edge client-address header; direct local tests use the socket address. These header tests do not constitute a live Railway edge-spoof test.
- Streamed requests have a boundary cap before framework buffering: 512 KiB generally, or 10 MiB plus bounded multipart overhead for the exact upload route. The real Node HTTP test covers oversized chunked requests, the maximum upload boundary, and one byte beyond it (`runtime.test.ts:77`). API/team responses are forced to no-store, and missing build assets cannot keep an immutable cache entry (`railway-http.mjs:20`). Private file delivery still requires current staff membership and uses attachment/no-store/nosniff headers.
- The Node process validates required configuration and volume metadata before binding public HTTP (`start-railway.mjs:25`, `config.ts:5`). The build graph excludes the Sites dispatcher and mock-auth plugin. The Docker image contains the ordered migration files and online backup script. Runtime secrets are supplied through service variables rather than public build defines or source examples.
- Background processing is one awaited loop with no overlapping timer cycles (`background.ts:23`). Shutdown stops scheduling, drains provider work and HTTP, and closes storage only after the drain succeeds (`start-railway.mjs:10`). Work left unfinished at a deadline remains leased for the existing task recovery rules. An uncertain Gmail task is search-only; Calendar recovery retains the deterministic event identity and reservation.
- Railway IaC specifies one replica, no sleep, the required `/data` mount and a health endpoint. It preserves intake state and Google secrets; it does not create a public domain, enable applications, authorize Google, or claim a successful real Railway plan.

## Checks run by this reviewer

All test records were synthetic and local. No candidate mail, Calendar mutation, Drive mutation, account purchase, deployment, live Sites change, or production data edit was performed.

| Command | Result |
| --- | --- |
| `npm test` | 217 passed, 0 failed. Includes signed staff-auth fixtures, existing hiring/candidate/task races, Google HTTP fixtures, mail/Drive recovery, and isolated capacity fixtures. |
| `npm run test:railway` | 16 passed, 0 failed, 0 skipped: nine IaC/runtime/production-server tests plus seven persistence/backup implementation tests. |
| `npx tsx --test tests/hub/railway-auth.test.ts` | 10 passed, 0 failed; real locally generated RSA signatures with isolated Google responses. |
| `npm run typecheck && npm run lint && git diff --check` | Passed on the frozen implementation. |

The built production-server test was executed with a real temporary volume, the actual Node entry point, an ephemeral local port, and synthetic credentials. It verified rendered homepage/team pages, working JavaScript assets, no-store missing assets, paused intake, forged-header rejection on hub/private-file routes, a configured HTTPS OAuth callback despite a forged host, clean SIGTERM, and persistent OAuth state after process restart. The test did not contact Google or run in Railway infrastructure.

The persistence tests exercise the production adapter with real SQLite and private temporary files, including rollback, restart, migration drift, 100 duplicate submissions, symlink/traversal rejection, atomic original-file writes, and WAL-consistent backup. They are useful evidence but not an independent review of the adapter author.

## Live and operational limits

Before enabling intake, validate the actual Railway account/volume, restart/redeploy persistence, backup restoration with originals and the separately held token key, staff Google consent and revocation, recruiting sender consent, private Drive root permissions, Calendar/Meet behavior, real mail delivery and reply imports, and final DNS/HTTPS. A local RSA fixture cannot establish real consent, restricted-scope approval, account policy, provider quotas, delivery, or Google ownership.

The background worker waits for a coherent recruiting Google connection before entering the hiring processor. Before that connection, provider tasks remain queued and the processor's orphan-upload cleanup does not run. Keep intake paused through setup as documented, and treat connection/worker health as an operational launch gate. One durable instance is required; this design is not a multi-replica shared-storage architecture.

Primary references checked during review: [Railway public networking specifications](https://docs.railway.com/networking/public-networking/specs-and-limits), [Railway volumes](https://docs.railway.com/volumes), [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), and [Node 24.16 SQLite](https://nodejs.org/download/release/v24.16.0/docs/api/sqlite.html).

# Applicant spam protection

Create a Cloudflare Turnstile managed widget restricted to `jobs.aicaseleads.com` (and your Railway hostname only if applicants use it). Set Railway variables `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, and `TURNSTILE_REQUIRED=true`, then redeploy. The site key is public; the secret is server-only. Never use demo/test keys in production. `PUBLIC_ORIGIN` must identify the production website.

`GET /api/application-verification` reports `required` and `configured` plus the public site key. With no configuration, CAPTCHA is off, but request limits still operate. Any partial configuration or required flag fails closed for new uploads/applications. The client displays a setup/unavailable message. Network/service errors do not accept applications. Recovery of an already recorded same-session submission remains available.

Server validation checks Cloudflare success, hostname, `application` action and challenge age. Cloudflare tokens are single-use and expire after five minutes. A validated challenge yields a signed 30-minute grant bound to the browser's HTTP-only session, job and one submission key. This permits multiple file uploads and safe same-key retries without reusing a Turnstile token or granting permission to create thousands of applications. A different application key needs a new challenge. Accepted applications retain their existing idempotency and receipt recovery.

Durable database limits restrict each session to 20 upload requests and 30 application/verification requests per ten minutes, each actual client IP to 150 of each per ten minutes, and each normalized email to ten new application attempts per hour. Railway normalizes proxy IP headers before request handling. Existing same-session submission recovery does not consume the email limit. Shared IP limits intentionally allow ordinary office traffic. CAPTCHA and limits reduce abuse; they cannot guarantee every human submission is genuine.

References: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ and https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/

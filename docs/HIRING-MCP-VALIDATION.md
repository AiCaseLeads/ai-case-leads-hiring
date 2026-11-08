# Bulk applicant MCP validation

Validated locally on November 7, 2026, from main `e002b12bb0790d560dde60a5e3a55a605fb7d37e`.

## Scope and behavior

- `export_applicants` and `search_applicants` use GET and require only the existing `applicants:read` scope. Token scope definitions and issuance rules are unchanged. No applicant write tool was added.
- Export groups normalized emails, retains each scoped application's stage, country, LinkedIn, screening evidence and answers, and includes stored résumé text. Cursor pages contain at most 30 complete candidate groups.
- Full available cached text is returned once per application. Extraction safety ceilings and partial/unreadable states are explicit; response-size limits reduce whole groups per page rather than silently truncating evidence.
- New reads never fetch originals, spawn parsers, enqueue extraction or change applicant records. Existing original-file and standalone text tools retain `files:read` checks.
- Uploads enqueue derived metadata. A separate globally leased worker extracts PDF, DOC, DOCX and valid UTF-8 TXT text, automatically backfills existing uploads, and prioritizes submitted applications. Operator recovery is bounded and explicit; automatic failures stop after five attempts.
- Typed rate-limit and timeout errors carry limits and retry timing. Permanent response-size errors advise narrower job filters rather than an immediate retry.

## Checks

| Check | Result |
| --- | --- |
| `npm test` | 749 passed; 3 native OCR tests skipped |
| `npm run test:mcp` | 7 passed |
| `npm run test:railway` | 22 passed |
| `python3 -m unittest discover -s tests/aws -p 'test_*.py'` | 5 passed |
| `npm run typecheck` | Passed |
| `npm run build:railway` | Passed; existing bundler warnings |
| ESLint, excluding generated `dist`, `.next` and `public/vendor` | No errors; 9 existing warnings outside changed source |
| `git diff --check` | Passed |

The source lint command was `npx eslint . --ignore-pattern dist --ignore-pattern .next --ignore-pattern public/vendor`. The production build generates third-party PDF.js assets under `public/vendor`; those generated assets produce upstream lint errors if included in a post-build whole-directory lint.

The process-backed integration test runs the actual stdio adapter against the authenticated HTTP API with a synthetic token and a real extracted PDF. It verifies grouped pages, cursor continuation, search, scope revocation and zero original-file reads after caching. Additional tests cover rate windows/concurrency, timeout cancellation, byte boundaries, Trash races, unsupported files, cache identity, retry recovery and legacy preview compatibility.

The persistent-storage upgrade test migrates an existing database from before migration 0013, preserves applicant records, backfills a real PDF, restarts SQLite and verifies the stored text is reused without another original read. Native OCR execution remains unverified on this Mac; the fallback and incomplete-status paths pass.

## Performance evidence

Local in-memory SQLite benchmark: 10,000 synthetic applications, each with 10,800 cached résumé characters; 30 candidates returned; 378,524 response bytes; no original-file reads or parsing. Five calls per operation:

| Operation | Times (ms) | Median |
| --- | --- | --- |
| Export | 51.3, 50.5, 45.0, 48.9, 45.6 | 48.9 ms |
| Literal résumé search | 188.3, 201.1, 185.9, 211.5, 199.8 | 199.8 ms |

A separate 10,001-application, five-job benchmark of answer search and duplicate grouping justified the candidate-key and job/date indexes: median export 47.7 → 8.4 ms and search 134.3 → 42.5 ms in the same fixture. These are synthetic backend measurements, not production latency or network guarantees. Search uses literal substring matching; default SQLite case folding covers ASCII/English rather than full Unicode case folding.

## Review and release boundary

A Claude Code review and independent Codex reviews identified size-boundary, Trash-visibility, metadata-redaction, legacy-cache, retry-recovery and lookup-cost issues. They were corrected and covered by regression tests; final peer review found no blockers. Deliberate limits remain documented in [the MCP README](HIRING-MCP-README.md).

No production migration or backfill was executed during this implementation. Deploy migration 0013 and the worker, keep `BACKGROUND_ENABLED=true`, restart local MCP clients to discover the updated adapter tools, and verify `resumeCoverage` plus representative PDF/DOC/DOCX/TXT results. The migration is additive, but older images fail migration-integrity checks afterward; use a compatible roll-forward image for rollback rather than bypassing integrity checks. Operator commands and bounded failure recovery are in the README.

# Independent Railway storage review

Reviewed the SQLite, private file storage, bindings, and backup changes using the code-reviewer skill. This review did not change storage code or access hosted candidate records.

## Result

No blocking storage defects found in the reviewed implementation. Launch still requires the actual durable Railway volume and a tested off-volume restore plan; local checks do not establish either.

## Evidence

- `lib/railway/sqlite.ts`: prepared values are bound, each batch executes synchronously inside `BEGIN IMMEDIATE`, losing optimistic updates roll back the entire batch, foreign keys are enabled, and migrations check journal order and exact applied SQL hashes before atomically applying new SQL.
- `lib/railway/object-store.ts`: keys are hashed into private filenames; directories and files reject symlinks, files reject hard links, original bytes and metadata are published together using an atomic rename after file synchronization, and reads validate size and SHA-256. Streamed input remains bounded to 10 MiB per file. These are the R2 operations the application currently uses; unsupported R2 options fail explicitly.
- `lib/railway/bindings.ts`: production storage does not create a missing mount, and the configured data directory must match the native Railway volume mount. Server and background worker share one process-local storage instance.
- `scripts/railway-backup.mjs`: online SQLite backup includes committed WAL contents, checks integrity, publishes a private self-contained snapshot without overwriting existing backups, and states that original object files require a separate backup.

Verification passed:

1. All seven `tests/railway/persistence.test.ts` checks: SQLite compare-and-swap rollback and `RETURNING`, migration drift and append rollback, accepted applications and receipts across restart, original metadata/bytes/streaming across restart, bounded and interrupted writes, traversal and symlink guards, production mount checks, and online WAL backup.
2. An isolated native-adapter integration: multipart PDF upload through `receiveUpload` → validated private object → accepted application → database/object adapter restart → exact streamed original bytes → exact accepted replay while intake is paused. Only one application remained. The temporary database and originals were removed afterward.

No real Google grant, Railway deployment, cloud-volume restart, DNS change, or live backup restoration was performed by this reviewer. Database-only snapshots do not constitute a full backup of original documents. Use one writable service replica with this SQLite/local-file architecture.

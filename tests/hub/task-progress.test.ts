import assert from "node:assert/strict";
import { test } from "node:test";
import { isDriveArchiveContinuation, publicTaskProgress } from "../../lib/hub/task-progress";

test("public Drive progress projects only allowlisted diagnostics", () => {
  assert.deepEqual(publicTaskProgress({ kind: "drive", status: "pending", result: {
    continuation: true, phase: "legacy_pdf", folderId: "private-folder", source: { email: "private" },
    diagnostics: { provider: "google", providerStatus: 429, providerCode: "private-provider-code", secret: "private" },
  } }), { continuation: true, phase: "legacy_pdf", providerStatus: 429 });
  assert.deepEqual(publicTaskProgress({ kind: "drive", status: "failed", result: {
    continuation: true, phase: "private-email@example.invalid", diagnostics: { providerStatus: "429" },
  } }), {});
  for (const providerStatus of [0, 99, 600, 429.5, NaN]) {
    assert.deepEqual(publicTaskProgress({ kind: "drive", status: "failed", result: { diagnostics: { providerStatus } } }), {});
  }
  assert.deepEqual(publicTaskProgress({ kind: "gmail", status: "pending", result: { continuation: true, phase: "originals" } }), {});
});

test("only pending Drive continuation is ordinary archive progress", () => {
  assert.equal(isDriveArchiveContinuation({ kind: "drive", status: "pending", lastError: "drive_archive_continuation" }), true);
  assert.equal(isDriveArchiveContinuation({ kind: "drive", status: "pending", continuation: true }), true);
  for (const status of ["failed", "running", "uncertain", "done"]) {
    assert.equal(isDriveArchiveContinuation({ kind: "drive", status, continuation: true, lastError: "drive_archive_continuation" }), false);
  }
  assert.equal(isDriveArchiveContinuation({ kind: "gmail", status: "pending", lastError: "drive_archive_continuation" }), false);
  assert.equal(isDriveArchiveContinuation({ kind: "drive", status: "pending", lastError: "google_429" }), false);
});

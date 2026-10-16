/** Public task progress contains only known operational labels, never raw worker results. */
export const driveArchivePhases = {
  folders: "Preparing the applicant’s folder",
  current_pdf: "Saving the application PDF",
  originals: "Saving original uploads",
  legacy_list: "Checking earlier application records",
  legacy_read: "Reading an earlier application record",
  legacy_pdf: "Creating a PDF of an earlier record",
  legacy_retirement: "Replacing an earlier record with its PDF",
  legacy_next: "Continuing earlier application records",
  legacy_verify: "Checking the completed archive",
} as const;

export type DriveArchivePhase = keyof typeof driveArchivePhases;

export function publicTaskProgress(task: {
  kind: string;
  status: string;
  lastError?: string | null;
  result?: Record<string, unknown>;
}): { continuation?: boolean; phase?: DriveArchivePhase; providerStatus?: number } {
  if (task.kind !== "drive") return {};
  const result = task.result ?? {};
  const diagnostics = result.diagnostics && typeof result.diagnostics === "object"
    ? result.diagnostics as Record<string, unknown> : {};
  const phase = result.phase ?? diagnostics.phase;
  const providerStatus = diagnostics.providerStatus;
  return {
    ...(task.status === "pending" && (result.continuation === true || task.lastError === "drive_archive_continuation")
      ? { continuation: true } : {}),
    ...(typeof phase === "string" && Object.hasOwn(driveArchivePhases, phase)
      ? { phase: phase as DriveArchivePhase } : {}),
    ...(typeof providerStatus === "number" && Number.isInteger(providerStatus) && providerStatus >= 100 && providerStatus <= 599
      ? { providerStatus } : {}),
  };
}

export function isDriveArchiveContinuation(task: { kind: string; status: string; continuation?: boolean; lastError?: string | null }): boolean {
  return task.kind === "drive" && task.status === "pending"
    && (task.continuation === true || task.lastError === "drive_archive_continuation");
}

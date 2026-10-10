import { AshbyArchiveClient } from "./ashby";
import { GoogleDriveArchive } from "./drive";
import type { AshbyFile } from "./contracts";
import { formFileAnswers } from "./form-files";

export async function archiveApplication(options: {
  applicationId: string;
  rootFolderId: string;
  allowedDownloadHosts: string[];
  ashby: AshbyArchiveClient;
  drive: GoogleDriveArchive;
  syncFieldIds?: { folder?: string; status?: string };
}): Promise<{ folderId: string; filesArchived: number }> {
  const { ashby, drive, applicationId, rootFolderId, allowedDownloadHosts } = options;
  const application = await ashby.application(applicationId);
  const candidate = await ashby.candidate(application.candidate.id);
  const knownFiles = [...(candidate.fileHandles ?? []), ...(candidate.resumeFileHandle ? [candidate.resumeFileHandle] : []), ...(application.resumeFileHandle ? [application.resumeFileHandle] : [])];
  const applicationFiles = new Map((await formFileAnswers(application, knownFiles)).map((file) => [file.id, file]));
  if (application.resumeFileHandle) applicationFiles.set(application.resumeFileHandle.id, application.resumeFileHandle);
  const history = await ashby.all<unknown>("application.listHistory", { applicationId });
  const feedback = await ashby.all<unknown>("applicationFeedback.list", { applicationId });
  const assessments = await ashby.takeHomes(applicationId);
  if (assessments.some((assessment) => assessment.candidateId !== candidate.id)) throw new Error("assessment_candidate_mismatch");
  await drive.assertPrivateRoot(rootFolderId);
  const jobFolderId = await drive.folder(`job:${application.job.id}`, application.job.title, rootFolderId);
  const folderId = await drive.folder(`application:${application.job.id}:${application.id}`, `${candidate.name}–${application.id}`, jobFolderId);
  const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2));
  await drive.file(`snapshot:${folderId}`, "application.json", "application/json", folderId, json({
    formatVersion: 1,
    application,
    candidate,
    history,
    feedback,
    takeHomeAssignments: assessments,
    provenance: {
      applicationAnswers: "application.info expand applicationFormSubmissions",
      applicationFiles: "File fields in applicationFormSubmissions plus application-specific resume; unresolved handles fail archival visibly",
      candidateAttachments: "candidate.info: shared candidate files, not proof they were supplied for this application",
      applicationResume: application.resumeFileHandle ? "application.info resumeFileHandle" : "No application-specific resume returned",
      history: "application.listHistory",
      feedback: "applicationFeedback.list",
      assessments: "takeHomeAssignment.list: only assignments visible to the authorized API key",
    },
  }));
  let filesArchived = 1;
  const archiveFile = async (file: AshbyFile, destination: string, prefix: string) => {
    if (!file.id || !file.handle || !file.name) throw new Error("invalid_ashby_file");
    const download = await ashby.download(file.handle, allowedDownloadHosts);
    await drive.file(`file:${destination}:${file.id}`, `${prefix}${file.name}`, download.mimeType, destination, download.bytes);
    filesArchived++;
  };
  for (const file of applicationFiles.values()) await archiveFile(file, folderId, file.id === application.resumeFileHandle?.id ? "Resume–" : "");
  const candidateFiles = new Map<string, AshbyFile>();
  for (const file of [...(candidate.fileHandles ?? []), ...(candidate.resumeFileHandle ? [candidate.resumeFileHandle] : [])]) {
    if (!applicationFiles.has(file.id)) candidateFiles.set(file.id, file);
  }
  if (candidateFiles.size) {
    const sharedFolder = await drive.folder(`candidate-files:${folderId}`, "Candidate attachments", folderId);
    for (const file of candidateFiles.values()) await archiveFile(file, sharedFolder, "");
  }
  for (const assessment of assessments) {
    if (!assessment.submission) continue;
    const assessmentFolder = await drive.folder(`assessment:${folderId}:${assessment.id}`, `Assessment–${assessment.id}`, folderId);
    await drive.file(`assessment-snapshot:${assessmentFolder}`, "submission.json", "application/json", assessmentFolder, json(assessment));
    filesArchived++;
    for (const file of assessment.submission.fileHandles) await archiveFile(file, assessmentFolder, "");
  }
  await ashby.writeSyncFields(application, folderId, options.syncFieldIds ?? {});
  return { folderId, filesArchived };
}

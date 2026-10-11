import { GoogleDriveArchive } from "../archive/drive";
import type { ItemState } from "../archive/contracts";
import { GoogleError, utf8 } from "./http";
import { GoogleBudget } from "./budget";

export type { ArchiveItem, ItemState } from "../archive/contracts";
export interface ApplicationSnapshot {
  id: string; revision: number; name: string; jobId: string; jobTitle: string;
  archiveProject?: string; archiveCountry?: string; hiringRound?: string;
  updatedAt?: number; driveFolderId?: string; driveFolderUrl?: string;
  files?: Array<{ id: string; filename: string; contentType: string; size: number; url?: string }>;
}
export interface OriginalFile { id?: string; name: string; bytes: Uint8Array; mimeType: string }
/** The loader is called only while archiving this individual file, never for the whole set. */
export interface OriginalFileSource { id: string; name: string; size: number; mimeType: string; load: () => Promise<Uint8Array> }
export type ArchiveOriginal = OriginalFile | OriginalFileSource;
export interface ArchiveContinuation { read: () => Promise<number>; write: (nextIndex: number) => Promise<void> }
export interface ArchiveResult { folderId: string; folderUrl: string; archivedRevision: number }

export class WorkspaceDrive {
  private archive?: GoogleDriveArchive;
  readonly budget = new GoogleBudget();
  constructor(private config: { clientId: string; clientSecret: string; refreshToken: string; driveRootId?: string; archiveState?: ItemState }, private fetcher: typeof fetch) {}
  async application(detail: ApplicationSnapshot, files: ArchiveOriginal[], existingFolderId?: string, continuation?: ArchiveContinuation): Promise<ArchiveResult> {
    this.budget.check();
    if (!this.config.driveRootId) throw new GoogleError("drive_root_not_configured");
    if (!this.config.archiveState) throw new GoogleError("drive_durable_state_required");
    if (!detail.id || !detail.jobId || !detail.name || !detail.jobTitle) throw new GoogleError("drive_application_identity_missing");
    if (!Number.isSafeInteger(detail.revision) || detail.revision < 1) throw new GoogleError("drive_application_revision_missing_or_invalid");
    const descriptorsById = new Map<string, NonNullable<ApplicationSnapshot["files"]>>();
    const descriptorsByName = new Map<string, NonNullable<ApplicationSnapshot["files"]>>();
    for (const descriptor of detail.files ?? []) {
      const byId = descriptorsById.get(descriptor.id) ?? [];
      const byName = descriptorsByName.get(descriptor.filename) ?? [];
      byId.push(descriptor); byName.push(descriptor);
      descriptorsById.set(descriptor.id, byId); descriptorsByName.set(descriptor.filename, byName);
    }
    // Validate R2 originals against this application before making any Drive mutation.
    const matched = files.map((file) => {
      const descriptors = (file.id ? descriptorsById.get(file.id) : descriptorsByName.get(file.name)) ?? [];
      if (descriptors.length !== 1) throw new GoogleError("drive_original_file_identity_missing_or_ambiguous");
      const descriptor = descriptors[0];
      const size = "bytes" in file ? file.bytes.length : file.size;
      if (!Number.isSafeInteger(size) || size < 1 || size > 10 * 1024 * 1024 || descriptor.filename !== file.name || descriptor.size !== size || descriptor.contentType !== file.mimeType) throw new GoogleError("drive_original_file_metadata_mismatch");
      return { ...file, id: descriptor.id, descriptor };
    });
    if (new Set(matched.map((file) => file.id)).size !== matched.length || matched.length !== (detail.files?.length ?? 0)) throw new GoogleError("drive_original_file_set_mismatch");
    this.archive ??= new GoogleDriveArchive(this.config, this.config.archiveState, this.fetcher);
    this.archive.deadline = this.budget.deadline;
    await this.archive.assertPrivateRoot(this.config.driveRootId);
    const recruiting = await this.archive.folder("hub:recruiting:v1", "Recruiting", this.config.driveRootId);
    // Legacy snapshots keep their existing parent and application identity forever.
    // New submissions snapshot explicit job geography, never applicant nationality.
    let job: string;
    if (detail.archiveProject && detail.archiveCountry && detail.hiringRound) {
      const projectKey = JSON.stringify([detail.archiveProject]);
      const countryKey = JSON.stringify([detail.archiveProject, detail.archiveCountry]);
      const project = await this.archive.folder(`hub:project:v2:${projectKey}`, detail.archiveProject, recruiting);
      const country = await this.archive.folder(`hub:country:v2:${countryKey}`, detail.archiveCountry, project);
      job = await this.archive.folder(`hub:round:v2:${detail.jobId}:${countryKey}`, `${detail.hiringRound}–${detail.jobId}`, country);
    } else {
      job = await this.archive.folder(`hub:job:${detail.jobId}`, detail.jobTitle, recruiting);
    }
    const folderId = await this.archive.folder(`hub:application:${detail.id}:job:${detail.jobId}`, `${detail.name}–${detail.id}`, job);
    if (existingFolderId && existingFolderId !== folderId) throw new GoogleError("drive_application_folder_identity_mismatch");
    // File download URLs and secure scheduling capabilities are not useful as archival data.
    const clean = JSON.parse(JSON.stringify(detail));
    // Drive delivery metadata is not hiring content and can change independently
    // of the archived revision. Exclude it so a retry has the same bytes.
    delete clean.driveFolderId;
    delete clean.driveFolderUrl;
    delete clean.updatedAt;
    for (const file of clean.files ?? []) delete file.url;
    if (clean.interview) delete clean.interview.bookingUrl;
    if (clean.assessment) delete clean.assessment.assessmentUrl;
    for (const interview of clean.interviews ?? []) delete interview.bookingUrl;
    for (const assessment of clean.assessments ?? []) delete assessment.assessmentUrl;
    const snapshot = utf8(JSON.stringify({ schemaVersion: 1, application: clean }, null, 2));
    // A worker whose lease expires may finish after a newer worker. Distinct,
    // immutable revision identities keep that old upload away from newer data.
    await this.archive.file(`hub:application:${detail.id}:snapshot:revision:${detail.revision}`, `application-r${detail.revision}.json`, "application/json", folderId, snapshot);
    const nextIndex=continuation?await continuation.read():0;
    if(!Number.isSafeInteger(nextIndex)||nextIndex<0||nextIndex>matched.length)throw new GoogleError("drive_checkpoint_invalid");
    for (let index=nextIndex;index<matched.length;index++) {
      const file=matched[index];
      this.budget.check();
      const bytes = "bytes" in file ? file.bytes : await file.load();
      if (bytes.length !== file.descriptor.size) throw new GoogleError("drive_original_file_metadata_mismatch");
      await this.archive.file(`hub:application:${detail.id}:original:${file.id}`, file.name, file.mimeType, folderId, bytes);
      if(continuation)await continuation.write(index+1);
    }
    return { folderId, folderUrl: `https://drive.google.com/drive/folders/${folderId}`, archivedRevision: detail.revision };
  }
}

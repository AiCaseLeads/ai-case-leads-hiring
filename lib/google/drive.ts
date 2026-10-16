import { GoogleDriveArchive, type LegacyApplicationRef, type LegacyApplicationSnapshot } from "../archive/drive";
import { ProviderError } from "../archive/http";
import type { ItemState } from "../archive/contracts";
import { GoogleError } from "./http";
import { GoogleBudget } from "./budget";
import { applicationPdf, type ReadableApplication } from "../pdf/application";
import { sha256 } from "../archive/security";

export type { ArchiveItem, ItemState } from "../archive/contracts";
export interface ApplicationSnapshot extends ReadableApplication {
  id: string; revision: number; name: string; jobId: string; jobTitle: string;
  archiveProject?: string; archiveCountry?: string; hiringRound?: string;
  updatedAt?: number; driveFolderId?: string; driveFolderUrl?: string;
  files?: Array<{ id: string; filename: string; contentType: string; size: number; url?: string }>;
}
export interface OriginalFile { id?: string; name: string; bytes: Uint8Array; mimeType: string }
/** The loader is called only while archiving this individual file, never for the whole set. */
export interface OriginalFileSource { id: string; name: string; size: number; mimeType: string; load: () => Promise<Uint8Array> }
export type ArchiveOriginal = OriginalFile | OriginalFileSource;
export interface DriveArchiveProgress {
  version: 1; applicationId: string; revision: number; contentFingerprint: string; rendererVersion: "readable-v2";
  folderId?: string; currentPdf?: { id: string; hash: string };
  legacy?: LegacyApplicationRef[]; legacyNext: number; legacyJsonFileIds: string[];
  legacySource?: LegacyApplicationSnapshot & { sourceFingerprint: string };
  pendingLegacy?: { fileId: string; revision: number; hash: string; pdfId: string; pdfHash: string; pdfIdentity?: string };
}
export interface ArchiveContinuation {
  read: () => Promise<number>; write: (nextIndex: number) => Promise<void>;
  readProgress?: () => Promise<DriveArchiveProgress | null>;
  writeProgress?: (progress: DriveArchiveProgress) => Promise<void>;
}
export class DriveArchiveContinuation extends Error {
  readonly code = "drive_archive_continuation";
  constructor(readonly phase: string, readonly diagnostics?: Record<string, string | number>) { super("drive_archive_continuation"); }
}
export class DriveArchiveFailure extends GoogleError {
  constructor(code: string, readonly phase: string, readonly diagnostics?: Record<string, string | number>) { super(code); }
}
export interface ArchiveResult { folderId: string; folderUrl: string; archivedRevision: number; archiveFormat: "pdf-v2"; legacyJsonFileIds: string[] }

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
    const startProgress = this.archive.progressVersion;
    let phase = "folders", checkpointWrites = 0;
    const durable = !!(continuation?.readProgress && continuation.writeProgress);
    const bounded = durable && this.budget.deadline !== undefined;
    const clean = JSON.parse(JSON.stringify(detail));
    delete clean.driveFolderId; delete clean.driveFolderUrl; delete clean.updatedAt;
    for (const file of clean.files ?? []) delete file.url;
    if (clean.interview) delete clean.interview.bookingUrl;
    if (clean.assessment) delete clean.assessment.assessmentUrl;
    for (const interview of clean.interviews ?? []) delete interview.bookingUrl;
    for (const assessment of clean.assessments ?? []) delete assessment.assessmentUrl;
    const contentFingerprint = await sha256(JSON.stringify(clean));
    const saved = durable ? await continuation!.readProgress!() : null;
    if (saved && (saved.version !== 1 || saved.applicationId !== detail.id || saved.revision !== detail.revision)) throw new GoogleError("drive_checkpoint_identity_mismatch");
    let progress: DriveArchiveProgress = saved ? {...saved,contentFingerprint,rendererVersion:"readable-v2"} : {
      version: 1, applicationId: detail.id, revision: detail.revision, contentFingerprint, rendererVersion:"readable-v2", legacyNext: 0, legacyJsonFileIds: [],
    };
    if (saved && (saved.contentFingerprint !== contentFingerprint || saved.rendererVersion !== "readable-v2")) delete progress.currentPdf;
    if (saved && saved.rendererVersion !== "readable-v2") delete progress.pendingLegacy;
    let lastSaved = saved ? JSON.stringify(saved) : "";
    const checkpoint = async () => {
      const serialized = JSON.stringify(progress);
      if (durable && serialized !== lastSaved) { await continuation!.writeProgress!(progress); checkpointWrites++; lastSaved = serialized; }
    };
    const deferBefore = (minimumRemaining: number) => {
      if (bounded && this.budget.deadline! - Date.now() < minimumRemaining) {
        if (checkpointWrites > 0 || this.archive!.progressVersion > startProgress) throw new DriveArchiveContinuation(phase, {reason: "time_slice"});
        throw new DriveArchiveFailure("archive_budget_insufficient",phase,{reason:"no_progress",phase});
      }
      this.budget.check();
    };
    try {
      await this.archive.assertPrivateRoot(this.config.driveRootId);
      const parts = [{identity:"hub:recruiting:v1",title:"Recruiting"}];
      if (detail.archiveProject && detail.archiveCountry && detail.hiringRound) {
        const projectKey = JSON.stringify([detail.archiveProject]), countryKey = JSON.stringify([detail.archiveProject, detail.archiveCountry]);
        parts.push({identity:`hub:project:v2:${projectKey}`,title:detail.archiveProject},{identity:`hub:country:v2:${countryKey}`,title:detail.archiveCountry},{identity:`hub:round:v2:${detail.jobId}:${countryKey}`,title:`${detail.hiringRound}–${detail.jobId}`});
      } else parts.push({identity:`hub:job:${detail.jobId}`,title:detail.jobTitle});
      parts.push({identity:`hub:application:${detail.id}:job:${detail.jobId}`,title:`${detail.name}–${detail.id}`});
      const folderId = await this.archive.folderPath(this.config.driveRootId, parts);
      if ((existingFolderId && existingFolderId !== folderId) || (progress.folderId && progress.folderId !== folderId)) throw new GoogleError("drive_application_folder_identity_mismatch");
      progress.folderId = folderId; await checkpoint();
      phase = "current_pdf";
      const currentIdentity = `hub:application:${detail.id}:pdf:v1:revision:${detail.revision}`;
      if (!progress.currentPdf || !await this.archive.confirmFile(currentIdentity,folderId,progress.currentPdf.id,progress.currentPdf.hash)) {
        deferBefore(10_000);
        const snapshot = await applicationPdf(clean);
        const id = await this.archive.file(currentIdentity,`Application-r${detail.revision}.pdf`,"application/pdf",folderId,snapshot);
        progress.currentPdf = {id,hash:await sha256(snapshot)}; await checkpoint();
      }
      phase = "originals";
      const nextIndex=continuation?await continuation.read():0;
      if(!Number.isSafeInteger(nextIndex)||nextIndex<0||nextIndex>matched.length)throw new GoogleError("drive_checkpoint_invalid");
      for (let index=nextIndex;index<matched.length;index++) {
        deferBefore(8_000);
        const file=matched[index], bytes="bytes" in file ? file.bytes : await file.load();
        if (bytes.length !== file.descriptor.size) throw new GoogleError("drive_original_file_metadata_mismatch");
        await this.archive.file(`hub:application:${detail.id}:original:${file.id}`,file.name,file.mimeType,folderId,bytes);
        if(continuation) { await continuation.write(index+1); checkpointWrites++; }
      }
      phase = "legacy_list";
      if (!progress.legacy) {
        deferBefore(5_000);
        progress.legacy = await this.archive.listLegacyApplicationSnapshots(detail.id,folderId); await checkpoint();
      }
      if(!Number.isSafeInteger(progress.legacyNext)||progress.legacyNext<0||progress.legacyNext>progress.legacy.length)throw new GoogleError("drive_checkpoint_invalid");
      let converted = 0;
      while (progress.legacyNext < progress.legacy.length) {
        const reference = progress.legacy[progress.legacyNext];
        if (!progress.pendingLegacy) {
          phase = "legacy_read";
          if (!progress.legacySource) {
            deferBefore(8_000);
            const legacy = await this.archive.readLegacyApplicationSnapshot(detail.id,folderId,reference);
            if (!legacy) { progress.legacyNext++; await checkpoint(); continue; }
            progress.legacySource = {...legacy,sourceFingerprint:await sha256(JSON.stringify(legacy.application))}; await checkpoint();
          }
          const legacy = progress.legacySource;
          if (legacy.fileId !== reference.fileId || legacy.revision !== reference.revision || legacy.application.id !== detail.id || legacy.application.revision !== reference.revision || legacy.application.jobId !== detail.jobId || typeof legacy.application.name !== "string" || typeof legacy.application.jobTitle !== "string" || legacy.sourceFingerprint !== await sha256(JSON.stringify(legacy.application))) throw new GoogleError("drive_legacy_snapshot_identity_mismatch");
          phase = "legacy_pdf"; deferBefore(10_000);
          const legacyPdf = await applicationPdf(legacy.application as unknown as ReadableApplication);
          const pdfHash = await sha256(legacyPdf);
          // Derived AI/job exposure can change without an application revision.
          // Preserve a differing historical JSON rendering beside the current PDF.
          const distinct = legacy.revision === detail.revision && pdfHash !== progress.currentPdf?.hash;
          const pdfIdentity = `hub:application:${detail.id}:pdf:${distinct ? "historical-json:v1" : "v1"}:revision:${legacy.revision}`;
          const pdfId = await this.archive.file(pdfIdentity,`Application-r${legacy.revision}${distinct ? "-previous-record" : ""}.pdf`,"application/pdf",folderId,legacyPdf);
          progress.pendingLegacy = {fileId:legacy.fileId,revision:legacy.revision,hash:legacy.hash,pdfId,pdfHash,pdfIdentity}; await checkpoint();
        }
        const pending = progress.pendingLegacy;
        if (pending.fileId !== reference.fileId || pending.revision !== reference.revision) throw new GoogleError("drive_checkpoint_identity_mismatch");
        phase = "legacy_retirement"; deferBefore(6_000);
        await this.archive.retireLegacyApplicationSnapshot(detail.id,pending,folderId,pending.pdfId,pending.pdfHash,pending.pdfIdentity);
        if (!progress.legacyJsonFileIds.includes(pending.fileId)) progress.legacyJsonFileIds.push(pending.fileId);
        progress.legacyNext++; delete progress.legacySource; delete progress.pendingLegacy; await checkpoint(); converted++;
        if (bounded && converted >= 1 && progress.legacyNext < progress.legacy.length) throw new DriveArchiveContinuation("legacy_next", {reason:"one_revision_per_cycle"});
      }
      // A late old worker can add a JSON after the original list was snapshotted.
      phase = "legacy_verify"; deferBefore(5_000);
      const remaining = await this.archive.listLegacyApplicationSnapshots(detail.id,folderId);
      if (remaining.length) {
        progress.legacy.push(...remaining); await checkpoint();
        if (bounded) throw new DriveArchiveContinuation("legacy_next", {reason:"late_revision"});
        // No deadline is used by synchronous compatibility callers; finish via a durable local continuation.
        return this.application(detail,files,existingFolderId,{...continuation,read:continuation?.read || (async()=>matched.length),write:continuation?.write || (async()=>undefined),readProgress:async()=>progress,writeProgress:async(next)=>{progress=next;}});
      }
      return {folderId,folderUrl:`https://drive.google.com/drive/folders/${folderId}`,archivedRevision:detail.revision,archiveFormat:"pdf-v2",legacyJsonFileIds:progress.legacyJsonFileIds};
    } catch (error) {
      if (error instanceof DriveArchiveContinuation || error instanceof DriveArchiveFailure) throw error;
      const diagnostics: Record<string,string|number> = {phase};
      if (error instanceof ProviderError) {
        diagnostics.provider = error.provider; diagnostics.providerStatus = error.retryStatus || error.status;
        if (error.code) diagnostics.providerCode = error.code;
        // Natural time exhaustion may follow a persisted upload session. Genuine
        // quota/backoff or repeated no-progress failures still consume retries.
        if (bounded && error.code === "deadline_exceeded" && !error.retryStatus && (checkpointWrites > 0 || this.archive.progressVersion > startProgress)) throw new DriveArchiveContinuation(phase,diagnostics);
        throw new DriveArchiveFailure(error.code || `${error.provider}_${error.status}`,phase,diagnostics);
      }
      const suppliedCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
      const code = typeof suppliedCode === "string" && /^[a-z0-9_]{1,100}$/.test(suppliedCode) ? suppliedCode : error instanceof Error && /^[a-z0-9_]{1,100}$/.test(error.message) ? error.message : "drive_archive_failed";
      if (bounded && code === "processor_deadline_exceeded" && (checkpointWrites > 0 || this.archive.progressVersion > startProgress)) throw new DriveArchiveContinuation(phase,diagnostics);
      throw new DriveArchiveFailure(code,phase,diagnostics);
    }
  }
}

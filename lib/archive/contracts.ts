export interface AshbyFile { id: string; name: string; handle: string }
export interface AshbyApplication {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  candidate: { id: string; name: string };
  job: { id: string; title: string };
  resumeFileHandle?: AshbyFile | null;
  applicationFormSubmissions?: Array<{ id: string; formDefinition: unknown; submittedValues: unknown }> | null;
  [key: string]: unknown;
}
export interface AshbyCandidate {
  id: string;
  name: string;
  updatedAt: string;
  fileHandles?: AshbyFile[];
  applicationIds?: string[];
  resumeFileHandle?: AshbyFile | null;
  [key: string]: unknown;
}
export interface AshbyTakeHome {
  id: string;
  applicationId: string;
  candidateId: string;
  updatedAt: string;
  submission?: { fileHandles: AshbyFile[]; [key: string]: unknown } | null;
  [key: string]: unknown;
}
export interface Page<T> { results: T[]; moreDataAvailable: boolean; nextCursor?: string; syncToken?: string }
export interface ArchiveEvent {
  id: string; application_id: string | null; action: string; status: string;
  attempts: number; lease_token: string | null; lease_until: number | null;
  next_attempt_at: number | null;
  folder_id: string | null; last_error: string | null; created_at: number; updated_at: number;
}
export interface ArchiveItem { key: string; drive_id: string; parent_id: string; content_hash: string | null; session_url: string | null; updated_at: number }
export interface Checkpoint { stream: string; cursor: string | null; sync_token: string | null; revision: number; last_error: string | null; updated_at: number }
export interface ItemState {
  get(key: string): Promise<ArchiveItem | null>;
  reserve(key: string, driveId: string, parentId: string): Promise<ArchiveItem>;
  update(key: string, contentHash: string | null, sessionUrl: string | null): Promise<void>;
}

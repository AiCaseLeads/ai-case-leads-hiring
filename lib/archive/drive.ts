import type { ArchiveItem, ItemState } from "./contracts";
import { ProviderError, providerRequest, type Fetch } from "./http";
import { safeDriveSession, sha256 } from "./security";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";
interface DriveFile { id: string; name: string; mimeType: string; parents?: string[]; trashed?: boolean; appProperties?: Record<string, string>; sha256Checksum?: string; size?: string }
export interface LegacyApplicationSnapshot { fileId: string; revision: number; application: Record<string, unknown>; hash: string }
export interface LegacyApplicationRef { fileId: string; revision: number }
export interface DriveCredentials { clientId: string; clientSecret: string; refreshToken: string }

function driveId(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,256}$/.test(value)) throw new Error("invalid_drive_id");
  return value;
}
function name(value: string): string { return value.replace(/[\u0000-\u001f/\\]/g, "_").slice(0, 180) || "Untitled"; }

// Only documented machine codes are retained. Never persist Google's message,
// file names, account addresses, URLs, or arbitrary response strings.
const DRIVE_REASONS: Record<string,string> = {
  insufficientFilePermissions:"insufficient_file_permissions", insufficientPermissions:"insufficient_permissions",
  storageQuotaExceeded:"storage_quota_exceeded", dailyLimitExceeded:"daily_limit_exceeded",
  userRateLimitExceeded:"user_rate_limit_exceeded", rateLimitExceeded:"rate_limit_exceeded",
  teamDriveFileLimitExceeded:"shared_drive_file_limit_exceeded", activeItemCreationLimitExceeded:"active_item_creation_limit_exceeded",
  domainPolicy:"domain_policy", appNotAuthorizedToFile:"app_not_authorized_to_file",
  cannotModifyInheritedTeamDrivePermission:"cannot_modify_inherited_permission",
  fileOwnerNotMemberOfTeamDrive:"file_owner_not_shared_drive_member",
  PERMISSION_DENIED:"permission_denied", RESOURCE_EXHAUSTED:"resource_exhausted",
};
async function driveForbidden(response:Response,deadline?:number):Promise<ProviderError>{
  const fallback=new ProviderError("google_drive",response.status);
  const reader=response.body?.getReader();if(!reader)return fallback;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const parse=async()=>{let size=0;const chunks:Uint8Array[]=[];
      while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16384)return fallback;chunks.push(part.value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      const value=JSON.parse(new TextDecoder().decode(bytes));
      const reasons=[...(Array.isArray(value?.error?.errors)?value.error.errors.map((item:{reason?:unknown})=>item?.reason):[]),value?.error?.status];
      for(const reason of reasons)if(typeof reason==="string"&&Object.hasOwn(DRIVE_REASONS,reason))return new ProviderError("google_drive",response.status,"drive_"+DRIVE_REASONS[reason]);
      return fallback;
    };
    return await Promise.race([parse(),new Promise<ProviderError>(resolve=>{timer=setTimeout(()=>resolve(fallback),Math.max(1,Math.min(2000,(deadline??Infinity)-Date.now())));})]);
  }catch{return fallback;}finally{clearTimeout(timer);void reader.cancel().catch(()=>undefined);}
}

export class GoogleDriveArchive {
  deadline?: number;
  /** Increments only when a durable ID, upload session or provider creation advances. */
  progressVersion = 0;
  private accessToken = "";
  private expiresAt = 0;
  private refreshing?: Promise<string>;

  constructor(private credentials: DriveCredentials, private state: ItemState, private fetcher: Fetch = fetch) {
    if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) throw new Error("google_not_configured");
  }

  private async token(force = false): Promise<string> {
    if (!force && this.accessToken && Date.now() < this.expiresAt) return this.accessToken;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const response = await providerRequest("https://oauth2.googleapis.com/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.credentials.clientId, client_secret: this.credentials.clientSecret, refresh_token: this.credentials.refreshToken, grant_type: "refresh_token" }),
      }, "google_oauth", this.fetcher, undefined, () => this.deadline);
      if (!response.ok) throw new ProviderError("google_oauth", response.status);
      const data = await response.json() as { access_token?: string; expires_in?: number };
      if (!data.access_token) throw new Error("google_token_missing");
      this.accessToken = data.access_token;
      this.expiresAt = Date.now() + Math.max(0, (data.expires_in ?? 3600) - 60) * 1000;
      return data.access_token;
    })();
    try { return await this.refreshing; } finally { this.refreshing = undefined; }
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const parsed = new URL(url);
    if (parsed.origin !== "https://www.googleapis.com" || parsed.username || parsed.password) throw new Error("invalid_google_url");
    let response = await providerRequest(url, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${await this.token()}` } }, "google_drive", this.fetcher, undefined, () => this.deadline);
    if (response.status === 401) response = await providerRequest(url, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${await this.token(true)}` } }, "google_drive", this.fetcher, undefined, () => this.deadline);
    if(response.status===403)throw await driveForbidden(response,this.deadline);
    return response;
  }

  private async metadata(id: string): Promise<DriveFile | null> {
    const response = await this.request(`${API}/files/${driveId(id)}?supportsAllDrives=true&fields=id,name,mimeType,parents,trashed,appProperties,sha256Checksum`);
    if (response.status === 404) return null;
    if (!response.ok) throw new ProviderError("google_drive", response.status);
    return response.json() as Promise<DriveFile>;
  }

  async assertPrivateRoot(rootId: string): Promise<void> {
    const root = await this.metadata(rootId);
    if (!root || root.trashed || root.mimeType !== FOLDER) throw new Error("drive_root_unavailable");
    let pageToken: string | undefined;
    for (let page = 0; page < 100; page++) {
      const query = new URLSearchParams({ supportsAllDrives: "true", fields: "permissions(type),nextPageToken", pageSize: "100", ...(pageToken ? { pageToken } : {}) });
      const response = await this.request(`${API}/files/${driveId(rootId)}/permissions?${query}`);
      if (!response.ok) throw new ProviderError("google_drive", response.status);
      const data = await response.json() as { permissions: Array<{ type: string }>; nextPageToken?: string };
      if (data.permissions.some((permission) => permission.type === "anyone")) throw new Error("drive_root_is_public");
      if (!data.nextPageToken) return;
      if (data.nextPageToken === pageToken) throw new Error("drive_permission_pagination_stalled");
      pageToken = data.nextPageToken;
    }
    throw new Error("drive_permission_pagination_limit");
  }

  private async existing(key: string, parentId: string): Promise<DriveFile | null> {
    const q = `'${driveId(parentId)}' in parents and trashed = false and appProperties has { key='aclArchiveKey' and value='${key}' }`;
    const params = new URLSearchParams({ q, fields: "files(id,name,mimeType,parents,appProperties),nextPageToken", pageSize: "100", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
    const response = await this.request(`${API}/files?${params}`);
    if (!response.ok) throw new ProviderError("google_drive", response.status);
    const data = await response.json() as { files: DriveFile[]; nextPageToken?: string };
    if (data.files.length > 1 || data.nextPageToken) throw new Error("drive_identity_duplicates");
    return data.files[0] ?? null;
  }

  private async item(key: string, parentId: string): Promise<ArchiveItem> {
    const saved = await this.state.get(key);
    if (saved) { if (saved.parent_id !== parentId) throw new Error("archive_parent_mismatch"); return saved; }
    const found = await this.existing(key, parentId);
    if (found) { const item = await this.state.reserve(key, found.id, parentId); this.progressVersion++; return item; }
    const response = await this.request(`${API}/files/generateIds?count=1&space=drive&type=files`);
    if (!response.ok) throw new ProviderError("google_drive", response.status);
    const data = await response.json() as { ids: string[] };
    if (!data.ids?.[0]) throw new Error("drive_id_missing");
    // Persist a pre-generated ID before creation. A retry reuses this ID and Drive returns 409 rather than making a duplicate.
    const item = await this.state.reserve(key, driveId(data.ids[0]), parentId); this.progressVersion++; return item;
  }

  private async persist(key: string, hash: string, session: string | null) {
    const saved = await this.state.get(key);
    if (saved?.content_hash === hash && saved.session_url === session) return;
    await this.state.update(key, hash, session); this.progressVersion++;
  }

  private matches(file: DriveFile, key: string, parentId: string): void {
    if (file.trashed || !file.parents?.includes(parentId) || file.appProperties?.aclArchiveKey !== key) throw new Error("drive_identity_mismatch");
  }

  async folder(identity: string, title: string, parentId: string): Promise<string> {
    const key = await sha256(identity);
    const item = await this.item(key, parentId);
    let file = await this.metadata(item.drive_id);
    if (!file) {
      const response = await this.request(`${API}/files?supportsAllDrives=true&fields=id,name,mimeType,parents,appProperties`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.drive_id, name: name(title), mimeType: FOLDER, parents: [parentId], appProperties: { aclArchiveKey: key } }),
      });
      if (response.status === 409) file = await this.metadata(item.drive_id);
      else if (!response.ok) throw new ProviderError("google_drive", response.status);
      else { file = await response.json() as DriveFile; this.progressVersion++; }
    }
    if (!file || file.mimeType !== FOLDER) throw new Error("drive_folder_missing");
    this.matches(file, key, parentId);
    return file.id;
  }

  /** Rechecks every existing parent identity concurrently, without parallel creation. */
  async folderPath(rootId: string, parts: { identity: string; title: string }[]): Promise<string> {
    if (!parts.length) return driveId(rootId);
    const keys = await Promise.all(parts.map(part => sha256(part.identity)));
    const saved = await Promise.all(keys.map(key => this.state.get(key)));
    if (saved.every((item, index) => item && item.parent_id === (index ? saved[index - 1]?.drive_id : rootId))) {
      const present = await Promise.all(saved.map(item => this.metadata(item!.drive_id)));
      if (present.every(Boolean)) {
        for (let index = 0; index < present.length; index++) {
          if (present[index]!.mimeType !== FOLDER) throw new Error("drive_folder_missing");
          this.matches(present[index]!, keys[index], saved[index]!.parent_id);
        }
        return present.at(-1)!.id;
      }
    }
    let parent = rootId;
    for (const part of parts) parent = await this.folder(part.identity, part.title, parent);
    return parent;
  }

  private async inVerifiedHistory(file: DriveFile, key: string, parentId: string): Promise<boolean> {
    const historyKey=file.appProperties?.aclHistoryKey;
    if(file.trashed || file.mimeType!=="application/pdf" || file.appProperties?.aclArchiveKey!==key || file.appProperties?.aclHistoryFrom!==parentId || !historyKey)return false;
    const saved=await this.state.get(historyKey);
    if(!saved || !file.parents?.includes(saved.drive_id))return false;
    const folder=await this.metadata(saved.drive_id);
    return !!folder && !folder.trashed && folder.mimeType===FOLDER && folder.appProperties?.aclArchiveKey===historyKey && folder.parents?.includes(saved.parent_id)===true;
  }

  /** Move only provenance-verified generated revisions; original uploads are never selected. */
  async organizeApplicationPdfs(applicationId:string,parentId:string,historyParentId:string,maximumMoves=25):Promise<boolean> {
    const candidates:Array<{file:DriveFile;revision:number;historical:boolean;key:string}>=[];
    let pageToken:string|undefined;
    for(let page=0;page<100;page++){
      const query=new URLSearchParams({q:`'${driveId(parentId)}' in parents and trashed = false and mimeType = 'application/pdf'`,fields:"files(id,name,mimeType,parents,trashed,appProperties,sha256Checksum),nextPageToken",pageSize:"100",supportsAllDrives:"true",includeItemsFromAllDrives:"true",...(pageToken?{pageToken}:{})});
      const response=await this.request(`${API}/files?${query}`);if(!response.ok)throw new ProviderError("google_drive",response.status);
      const data=await response.json() as {files:DriveFile[];nextPageToken?:string};
      for(const file of data.files){
        const match=/^Application-r([1-9]\d*)(-previous-record)?\.pdf$/.exec(file.name);
        const revision=match?Number(match[1]):file.name==="Application.pdf"&&file.appProperties?.aclApplicationId===applicationId?Number(file.appProperties.aclApplicationRevision):0;
        if(!Number.isSafeInteger(revision)||revision<1)continue;
        const historical=!!match?.[2],key=await sha256(`hub:application:${applicationId}:pdf:${historical?"historical-json:v1":"v1"}:revision:${revision}`);
        const saved=await this.state.get(key);
        if(!saved || saved.drive_id!==file.id || saved.parent_id!==parentId || !saved.content_hash || saved.content_hash!==file.sha256Checksum || file.appProperties?.aclArchiveKey!==key || !file.parents?.includes(parentId))continue;
        candidates.push({file,revision,historical,key});
      }
      if(!data.nextPageToken)break;if(data.nextPageToken===pageToken||page===99)throw new Error("drive_pdf_pagination_limit");pageToken=data.nextPageToken;
    }
    const current=candidates.filter(item=>!item.historical).sort((a,b)=>b.revision-a.revision)[0];
    if(!current)throw new Error("drive_current_pdf_missing");
    // Never upload into a shared current-file ID. A stale worker can only rename its
    // immutable revision, and can only demote lower revisions, never the newer PDF.
    const latest=await this.metadata(current.file.id);
    if(!latest || latest.sha256Checksum!==current.file.sha256Checksum)throw new Error("drive_pdf_changed");
    if(!latest.parents?.includes(parentId))return false; // A newer worker already retired this revision.
    this.matches(latest,current.key,parentId);
    if(latest.name!=="Application.pdf"){
      const response=await this.request(`${API}/files/${driveId(latest.id)}?supportsAllDrives=true&fields=id`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:"Application.pdf",appProperties:{...latest.appProperties,aclApplicationId:applicationId,aclApplicationRevision:String(current.revision)}})});
      if(!response.ok)throw new ProviderError("google_drive",response.status);this.progressVersion++;
    }
    const obsolete=candidates.filter(item=>item.file.id!==current.file.id&&(item.revision<current.revision||item.historical));
    if(!obsolete.length)return true;
    const historyIdentity=`hub:application:${applicationId}:pdf-history:v1`,historyKey=await sha256(historyIdentity);
    const historyRoot=await this.folder(`hub:application-history:v1:${historyParentId}`,"Application history",historyParentId);
    const historyId=await this.folder(historyIdentity,applicationId,historyRoot);
    let moved=0;
    for(const item of obsolete.slice(0,maximumMoves)){
      const file=await this.metadata(item.file.id);if(!file || file.trashed)throw new Error("drive_pdf_changed");
      if(await this.inVerifiedHistory(file,item.key,parentId))continue;
      this.matches(file,item.key,parentId);if(file.sha256Checksum!==item.file.sha256Checksum)throw new Error("drive_pdf_changed");
      const query=new URLSearchParams({supportsAllDrives:"true",addParents:historyId,removeParents:parentId,fields:"id,parents"});
      const response=await this.request(`${API}/files/${driveId(file.id)}?${query}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:`Application-r${item.revision}${item.historical?"-previous-record":""}.pdf`,appProperties:{...file.appProperties,aclHistoryFrom:parentId,aclHistoryKey:historyKey}})});
      if(!response.ok)throw new ProviderError("google_drive",response.status);
      const result=await response.json() as DriveFile;if(result.id!==file.id||!result.parents?.includes(historyId)||result.parents.includes(parentId))throw new Error("drive_pdf_move_unconfirmed");
      moved++;this.progressVersion++;
    }
    return obsolete.length<=maximumMoves && moved<=maximumMoves;
  }

  async confirmFile(identity: string, parentId: string, id: string, hash: string): Promise<boolean> {
    const key = await sha256(identity), saved = await this.state.get(key);
    if (!saved || saved.drive_id !== id || saved.parent_id !== parentId) throw new Error("drive_identity_mismatch");
    if (saved.content_hash !== hash) return false;
    const file = await this.metadata(id);
    if (!file || file.trashed) return false;
    if(!await this.inVerifiedHistory(file,key,parentId))this.matches(file, key, parentId);
    return file.mimeType === "application/pdf" && file.sha256Checksum === hash;
  }

  /** Only historical JSONs made by this app in this application folder are eligible. */
  async listLegacyApplicationSnapshots(applicationId: string, parentId: string): Promise<LegacyApplicationRef[]> {
    let pageToken: string | undefined;
    const candidates: DriveFile[] = [];
    // Snapshot metadata before moving any file: page cursors cannot skip records
    // when the caller trashes files between yields. File bodies remain sequential.
    for (let page = 0; page < 100; page++) {
      const params = new URLSearchParams({
        q: `'${driveId(parentId)}' in parents and trashed = false and mimeType = 'application/json'`,
        fields: "files(id,name,mimeType,parents,trashed,appProperties,sha256Checksum,size),nextPageToken", pageSize: "100",
        supportsAllDrives: "true", includeItemsFromAllDrives: "true", ...(pageToken ? { pageToken } : {}),
      });
      const response = await this.request(`${API}/files?${params}`);
      if (!response.ok) throw new ProviderError("google_drive", response.status);
      const listed = await response.json() as { files: DriveFile[]; nextPageToken?: string };
      candidates.push(...listed.files);
      if (!listed.nextPageToken) { pageToken = undefined; break; }
      if (pageToken === listed.nextPageToken) throw new Error("drive_legacy_pagination_stalled");
      pageToken = listed.nextPageToken;
    }
    if (pageToken) throw new Error("drive_legacy_pagination_limit");
    const references: LegacyApplicationRef[] = [];
    for (const file of candidates) {
      const match = /^application-r([1-9]\d*)\.json$/.exec(file.name);
      if (!match || !Number.isSafeInteger(Number(match[1]))) continue;
      const revision = Number(match[1]), key = await sha256(`hub:application:${applicationId}:snapshot:revision:${revision}`);
      if (file.appProperties?.aclArchiveKey !== key) continue;
      this.matches(file, key, parentId);
      const reserved = await this.state.get(key) ?? await this.state.reserve(key, driveId(file.id), parentId);
      if (reserved.drive_id !== file.id || reserved.parent_id !== parentId) throw new Error("drive_legacy_snapshot_identity_mismatch");
      references.push({fileId: file.id, revision});
    }
    return references.sort((a,b) => a.revision-b.revision || a.fileId.localeCompare(b.fileId));
  }

  async readLegacyApplicationSnapshot(applicationId: string, parentId: string, reference: LegacyApplicationRef): Promise<LegacyApplicationSnapshot | null> {
    const key = await sha256(`hub:application:${applicationId}:snapshot:revision:${reference.revision}`);
    const reserved = await this.state.get(key);
    if (!reserved || reserved.drive_id !== reference.fileId || reserved.parent_id !== parentId) throw new Error("drive_legacy_snapshot_identity_mismatch");
    const file = {id: reference.fileId};
    const revision = reference.revision;
      const latest = await this.metadata(file.id);
      if (!latest || latest.trashed) return null;
      this.matches(latest, key, parentId);
      if (latest.name !== `application-r${revision}.json` || latest.mimeType !== "application/json" || Number(latest.size || 0) > 5 * 1024 * 1024) throw new Error("drive_legacy_snapshot_invalid");
      const content = await this.request(`${API}/files/${driveId(file.id)}?alt=media&supportsAllDrives=true`);
      if (!content.ok || !content.body) throw new ProviderError("google_drive", content.status);
      const reader = content.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.length;
          if (size > 5 * 1024 * 1024) throw new Error("drive_legacy_snapshot_invalid");
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const hash = await sha256(bytes);
      if (latest.sha256Checksum && hash !== latest.sha256Checksum) throw new Error("drive_legacy_snapshot_changed");
      if (reserved.content_hash && hash !== reserved.content_hash) throw new Error("drive_legacy_snapshot_changed");
      let snapshot: { schemaVersion?: unknown; application?: Record<string, unknown> };
      try { snapshot = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("drive_legacy_snapshot_invalid"); }
      if (snapshot.schemaVersion !== 1 || !snapshot.application || snapshot.application.id !== applicationId || snapshot.application.revision !== revision) throw new Error("drive_legacy_snapshot_identity_mismatch");
      return { fileId: file.id, revision, application: snapshot.application, hash };
  }

  async *legacyApplicationSnapshots(applicationId: string, parentId: string): AsyncGenerator<LegacyApplicationSnapshot> {
    for (const reference of await this.listLegacyApplicationSnapshots(applicationId, parentId)) {
      const snapshot = await this.readLegacyApplicationSnapshot(applicationId, parentId, reference);
      if (snapshot) yield snapshot;
    }
  }

  /** Recoverable cleanup only after the distinct PDF replacement is confirmed in Drive. */
  async retireLegacyApplicationSnapshot(applicationId: string, legacy: Pick<LegacyApplicationSnapshot,"fileId"|"revision"|"hash">, parentId: string, pdfId: string, pdfHash: string, pdfIdentity = `hub:application:${applicationId}:pdf:v1:revision:${legacy.revision}`): Promise<void> {
    const key = await sha256(`hub:application:${applicationId}:snapshot:revision:${legacy.revision}`);
    if (!["v1","historical-json:v1"].some(format => pdfIdentity === `hub:application:${applicationId}:pdf:${format}:revision:${legacy.revision}`)) throw new Error("drive_pdf_replacement_identity_mismatch");
    const replacementKey = await sha256(pdfIdentity);
    const [old, replacement] = await Promise.all([this.metadata(legacy.fileId), this.metadata(pdfId)]);
    if (!old || old.trashed) return;
    this.matches(old, key, parentId);
    if (old.name !== `application-r${legacy.revision}.json` || old.mimeType !== "application/json" || old.sha256Checksum !== legacy.hash) throw new Error("drive_legacy_snapshot_changed");
    if (!replacement) throw new Error("drive_pdf_replacement_missing");
    if(!await this.inVerifiedHistory(replacement,replacementKey,parentId))this.matches(replacement, replacementKey, parentId);
    if (replacement.mimeType !== "application/pdf" || replacement.sha256Checksum !== pdfHash) throw new Error("drive_pdf_replacement_unverified");
    const response = await this.request(`${API}/files/${driveId(legacy.fileId)}?supportsAllDrives=true&fields=id,trashed`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }),
    });
    if (!response.ok) throw new ProviderError("google_drive", response.status);
    const retired = await response.json() as { id?: string; trashed?: boolean };
    if (retired.id !== legacy.fileId || retired.trashed !== true) throw new Error("drive_legacy_retirement_unconfirmed");
    // Preserve the original file identity and checksum for audit/recovery from Drive Trash.
    await this.persist(key, legacy.hash, null); this.progressVersion++;
  }

  private async uploadStatus(session: string, total: number): Promise<Response> {
    return this.request(safeDriveSession(session), { method: "PUT", headers: { "Content-Length": "0", "Content-Range": `bytes */${total}` } });
  }

  private uploadedOffset(response: Response): number {
    const range = response.headers.get("range");
    if (!range) return 0;
    const match = /^bytes=0-(\d+)$/.exec(range);
    if (!match) throw new Error("drive_upload_range_invalid");
    return Number(match[1]) + 1;
  }

  async file(identity: string, title: string, mimeType: string, parentId: string, bytes: Uint8Array): Promise<string> {
    // Archive original bytes; a provider-supplied MIME type must never request a Google Docs conversion.
    if (mimeType.startsWith("application/vnd.google-apps.")) mimeType = "application/octet-stream";
    const key = await sha256(identity);
    const hash = await sha256(bytes);
    const item = await this.item(key, parentId);
    const present = await this.metadata(item.drive_id);
    if (present) {
      const historical=await this.inVerifiedHistory(present,key,parentId);
      if(!historical)this.matches(present, key, parentId);
      if(historical && present.sha256Checksum!==hash)throw new Error("drive_historical_pdf_changed");
      if (present.sha256Checksum === hash) {
        await this.persist(key, hash, null); return present.id;
      }
    }
    let session = item.content_hash === hash ? item.session_url : null;
    let offset = 0;
    if (session) {
      const status = await this.uploadStatus(session, bytes.length);
      if (status.ok) {
        const completed = await status.json() as { id?: string };
        if (completed.id !== item.drive_id) throw new Error("drive_upload_identity_mismatch");
        await this.persist(key, hash, null); return item.drive_id;
      }
      if (status.status === 308) offset = this.uploadedOffset(status);
      else if (status.status === 404 || status.status === 410) session = null;
      else throw new ProviderError("google_drive", status.status);
    }
    if (!session) {
      const params = "?uploadType=resumable&supportsAllDrives=true&fields=id";
      const response = await this.request(`${UPLOAD}${present ? `/${driveId(item.drive_id)}` : ""}${params}`, {
        method: present ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "X-Upload-Content-Type": mimeType, "X-Upload-Content-Length": String(bytes.length) },
        body: JSON.stringify({ ...(present ? {} : { id: item.drive_id, parents: [parentId] }), name: name(title), mimeType, appProperties: { aclArchiveKey: key, contentHash: hash } }),
      });
      // A prior create completed despite a lost response; retry inspects the reserved ID on the next task attempt.
      if (!response.ok) throw new ProviderError("google_drive", response.status);
      const location = response.headers.get("location");
      if (!location) throw new Error("drive_upload_session_missing");
      session = safeDriveSession(location);
      await this.persist(key, hash, session);
    }
    const chunkSize = 1024 * 1024; // 4 * 256 KiB, as required for non-final resumable chunks.
    let staleRanges = 0;
    for (let requestCount = 0; requestCount < 256; requestCount++) {
      const end = Math.min(offset + chunkSize, bytes.length);
      const body = bytes.slice(offset, end);
      let response: Response;
      try {
        response = await this.request(session, {
          method: "PUT", headers: { "Content-Type": mimeType, "Content-Length": String(body.length), "Content-Range": bytes.length ? `bytes ${offset}-${end - 1}/${bytes.length}` : "bytes */0" }, body: body as BodyInit,
        });
      } catch {
        response = await this.uploadStatus(session, bytes.length);
      }
      if (response.ok) {
        const result = await response.json() as { id?: string };
        if (result.id !== item.drive_id) throw new Error("drive_upload_identity_mismatch");
        await this.persist(key, hash, null); return item.drive_id;
      }
      if (response.status === 404 || response.status === 410) { await this.persist(key, hash, null); throw new Error("drive_upload_session_expired"); }
      if (response.status !== 308) throw new ProviderError("google_drive", response.status);
      const nextOffset = this.uploadedOffset(response);
      if (nextOffset < offset || nextOffset > bytes.length || nextOffset > end) throw new Error("drive_upload_range_invalid");
      staleRanges = nextOffset === offset ? staleRanges + 1 : 0;
      if (staleRanges > 4) throw new Error("drive_upload_stalled");
      offset = nextOffset;
    }
    throw new Error("drive_upload_request_limit");
  }
}

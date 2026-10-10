import type { AshbyApplication, AshbyCandidate, AshbyTakeHome, Page } from "./contracts";
import { ProviderError, providerRequest, type Fetch } from "./http";
import { requireId, safeDownloadUrl } from "./security";

export class AshbyArchiveClient {
  constructor(private apiKey: string, private fetcher: Fetch = fetch) { if (!apiKey) throw new Error("ashby_not_configured"); }

  async request<T>(endpoint: string, body: unknown): Promise<T> {
    const response = await providerRequest(`https://api.ashbyhq.com/${endpoint}`, {
      method: "POST", headers: { Authorization: `Basic ${btoa(`${this.apiKey}:`)}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body),
    }, "ashby", this.fetcher);
    if (!response.ok) throw new ProviderError("ashby", response.status);
    const data = await response.json() as { success: boolean; results: T; errors?: Array<string | { code?: string }>; errorInfo?: { code?: string }; moreDataAvailable?: boolean; nextCursor?: string; syncToken?: string };
    if (data.success !== true) {
      const first = data.errors?.[0];
      const code = data.errorInfo?.code ?? (typeof first === "string" ? first : first?.code);
      throw new ProviderError("ashby", response.status, code && /^[a-z_]{1,64}$/.test(code) ? code : "api_error");
    }
    return data as T;
  }

  async info<T>(endpoint: string, body: unknown): Promise<T> {
    return (await this.request<{ results: T }>(endpoint, body)).results;
  }

  async application(id: string): Promise<AshbyApplication> {
    const application = await this.info<AshbyApplication>("application.info", { applicationId: requireId(id), expand: ["applicationFormSubmissions"] });
    if (application.id !== id) throw new Error("application_identity_mismatch");
    requireId(application.candidate.id); requireId(application.job.id);
    return application;
  }

  async candidate(id: string): Promise<AshbyCandidate> {
    const candidate = await this.info<AshbyCandidate>("candidate.info", { id: requireId(id) });
    if (candidate.id !== id) throw new Error("candidate_identity_mismatch");
    return candidate;
  }

  async all<T>(endpoint: string, body: Record<string, unknown>): Promise<T[]> {
    const results: T[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 1000; page++) {
      const data = await this.request<Page<T>>(endpoint, { ...body, limit: 100, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(data.results)) throw new Error("invalid_ashby_page");
      results.push(...data.results);
      if (!data.moreDataAvailable) return results;
      if (!data.nextCursor || seen.has(data.nextCursor)) throw new Error("ashby_pagination_stalled");
      cursor = data.nextCursor; seen.add(cursor);
    }
    throw new Error("ashby_pagination_limit");
  }

  async takeHomes(applicationId: string): Promise<AshbyTakeHome[]> {
    const rows = await this.all<AshbyTakeHome>("takeHomeAssignment.list", { applicationId });
    if (rows.some((row) => row.applicationId !== applicationId)) throw new Error("assessment_identity_mismatch");
    return rows;
  }

  async download(handle: string, allowedHosts: string[], maxBytes = 30 * 1024 * 1024): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const file = await this.info<{ url: string }>("file.info", { fileHandle: handle });
    let url = safeDownloadUrl(file.url, allowedHosts);
    for (let redirect = 0; redirect < 4; redirect++) {
      // No Ashby Authorization header is sent to signed storage URLs.
      const response = await this.fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("download_redirect_missing");
        url = safeDownloadUrl(new URL(location, url).toString(), allowedHosts); continue;
      }
      if (!response.ok) throw new ProviderError("ashby_file", response.status);
      if (Number(response.headers.get("content-length")) > maxBytes || !response.body) throw new Error("file_too_large_or_empty");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let length = 0;
      while (true) {
        const part = await reader.read(); if (part.done) break;
        length += part.value.length;
        if (length > maxBytes) { await reader.cancel(); throw new Error("file_too_large"); }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return { bytes, mimeType: response.headers.get("content-type")?.split(";")[0] || "application/octet-stream" };
    }
    throw new Error("download_redirect_limit");
  }

  async writeSyncFields(application: AshbyApplication, folderId: string, fieldIds: { folder?: string; status?: string }): Promise<void> {
    const folderUrl = `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
    const fields = Array.isArray(application.customFields) ? application.customFields as Array<{ id: string; value: unknown }> : [];
    const desired = [fieldIds.folder && { fieldId: requireId(fieldIds.folder), fieldValue: folderUrl }, fieldIds.status && { fieldId: requireId(fieldIds.status), fieldValue: "Synced" }].filter(Boolean) as Array<{ fieldId: string; fieldValue: string }>;
    const values = desired.filter((field) => fields.find((current) => current.id === field.fieldId)?.value !== field.fieldValue);
    if (values.length) await this.info("customField.setValues", { objectId: application.id, objectType: "Application", values });
  }
}

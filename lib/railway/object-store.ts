import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync, mkdirSync, realpathSync, chmodSync } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import path from "node:path";

export const MAX_OBJECT_BYTES = 10 * 1024 * 1024;
const MAX_HEADER_BYTES = 32 * 1024;
type StoredMetadata = {
  format: 1; key: string; version: string; size: number; etag: string; uploaded: string;
  httpMetadata: Omit<R2HTTPMetadata, "cacheExpiry"> & { cacheExpiry?: string }; customMetadata: Record<string, string>;
};
type ObjectValue = ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string | Blob;
function validKey(key: string) {
  if (typeof key !== "string" || !key || Buffer.byteLength(key) > 1024 || /[\x00-\x1f\x7f\\]/.test(key) || key.startsWith("/") || key.split("/").some(part => !part || part === "." || part === "..")) throw new Error("object_key_invalid");
}
function safeDirectory(directory: string, create = false) {
  if (!path.isAbsolute(directory) || path.resolve(directory) !== directory) throw new Error("object_directory_unsafe");
  if (create) {
    const parent = path.dirname(directory);
    if (realpathSync(parent) !== parent || !lstatSync(parent).isDirectory()) throw new Error("object_directory_unsafe");
    try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
  }
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory) throw new Error("object_directory_unsafe");
  chmodSync(directory, 0o700);
}
function isMissing(error: unknown) { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
async function bytesFrom(value: ObjectValue): Promise<Uint8Array> {
  if (typeof value === "string") value = new TextEncoder().encode(value);
  if (value instanceof Blob) {
    if (value.size > MAX_OBJECT_BYTES) throw new Error("object_too_large");
    value = await value.arrayBuffer();
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (bytes.length > MAX_OBJECT_BYTES) throw new Error("object_too_large");
    return new Uint8Array(bytes);
  }
  if (!(value instanceof ReadableStream)) throw new Error("object_value_unsupported");
  const reader = value.getReader(), parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      if (!(next.value instanceof Uint8Array)) throw new Error("object_stream_invalid");
      size += next.value.length;
      if (size > MAX_OBJECT_BYTES) throw new Error("object_too_large");
      parts.push(new Uint8Array(next.value));
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
function metadata(key: string, bytes: Uint8Array, options: R2PutOptions = {}): StoredMetadata {
  if (Object.keys(options).some(name => !["httpMetadata", "customMetadata"].includes(name))) throw new Error("object_option_unsupported");
  if (options.httpMetadata instanceof Headers) throw new Error("object_option_unsupported");
  const http = { ...options.httpMetadata }, custom = { ...options.customMetadata };
  for (const [name, value] of Object.entries(http)) {
    if (!["contentType", "contentLanguage", "contentDisposition", "contentEncoding", "cacheControl", "cacheExpiry"].includes(name) || (name === "cacheExpiry" ? !(value instanceof Date) || !Number.isFinite(value.getTime()) : typeof value !== "string" || /[\r\n\x00]/.test(value))) throw new Error("object_metadata_invalid");
  }
  for (const [name, value] of Object.entries(custom)) if (!name || typeof value !== "string" || /[\x00]/.test(name + value)) throw new Error("object_metadata_invalid");
  return { format: 1, key, version: randomUUID(), size: bytes.length, etag: createHash("sha256").update(bytes).digest("hex"), uploaded: new Date().toISOString(), httpMetadata: { ...http, ...(http.cacheExpiry ? { cacheExpiry: http.cacheExpiry.toISOString() } : {}) } as StoredMetadata["httpMetadata"], customMetadata: custom };
}
function objectInfo(stored: StoredMetadata): R2Object {
  const http: R2HTTPMetadata = { ...stored.httpMetadata, ...(stored.httpMetadata.cacheExpiry ? { cacheExpiry: new Date(stored.httpMetadata.cacheExpiry) } : {}) } as R2HTTPMetadata;
  const checksum = Uint8Array.from(Buffer.from(stored.etag, "hex")).buffer;
  return { key: stored.key, version: stored.version, size: stored.size, etag: stored.etag, httpEtag: `"${stored.etag}"`, uploaded: new Date(stored.uploaded), storageClass: "Standard", httpMetadata: http, customMetadata: { ...stored.customMetadata }, checksums: { sha256: checksum, toJSON: () => ({ sha256: stored.etag }) }, writeHttpMetadata(headers: Headers) {
    for (const [key, name] of Object.entries({ contentType: "content-type", contentLanguage: "content-language", contentDisposition: "content-disposition", contentEncoding: "content-encoding", cacheControl: "cache-control" })) {
      const value = http[key as keyof R2HTTPMetadata]; if (typeof value === "string") headers.set(name, value);
    }
    if (http.cacheExpiry) headers.set("expires", http.cacheExpiry.toUTCString());
  } };
}

/** Private local R2 subset. One atomically replaced file contains both metadata and original bytes. */
export class FileObjectStore {
  constructor(readonly directory: string) { safeDirectory(directory, true); }
  asR2(): R2Bucket { return this as unknown as R2Bucket; }
  private objectPath(key: string, create = false) {
    validKey(key); safeDirectory(this.directory);
    const hash = createHash("sha256").update(key).digest("hex"), directory = path.join(this.directory, hash.slice(0, 2));
    safeDirectory(directory, create);
    return { directory, filename: path.join(directory, hash + ".object") };
  }
  async health() {
    safeDirectory(this.directory);
    const name = path.join(this.directory, ".health-" + randomUUID());
    const file = await open(name, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile("storage-ready"); await file.sync(); } finally { await file.close(); await unlink(name); }
    return true;
  }
  async put(key: string, value: ObjectValue, options?: R2PutOptions): Promise<R2Object> {
    validKey(key);
    const bytes = await bytesFrom(value), stored = metadata(key, bytes, options), header = Buffer.from(JSON.stringify(stored));
    if (header.length > MAX_HEADER_BYTES) throw new Error("object_metadata_too_large");
    const target = this.objectPath(key, true), temporary = path.join(target.directory, ".tmp-" + randomUUID());
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    let renamed = false;
    try {
      const prefix = Buffer.alloc(4); prefix.writeUInt32BE(header.length);
      await file.writeFile(Buffer.concat([prefix, header, bytes])); await file.sync(); await file.close();
      // Refuse a compromised existing path rather than following or replacing a link.
      try { const existing = await open(target.filename, constants.O_RDONLY | constants.O_NOFOLLOW); try { const stat = await existing.stat(); if (!stat.isFile() || stat.nlink !== 1) throw new Error("object_file_unsafe"); } finally { await existing.close(); } } catch (error) { if (!isMissing(error)) throw error; }
      safeDirectory(target.directory); await rename(temporary, target.filename); renamed = true;
      const directory = await open(target.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await directory.sync(); } finally { await directory.close(); }
      return objectInfo(stored);
    } finally { await file.close().catch(() => undefined); if (!renamed) await unlink(temporary).catch(() => undefined); }
  }
  private async read(key: string, body: boolean): Promise<{ stored: StoredMetadata; bytes?: Uint8Array } | null> {
    let target: ReturnType<FileObjectStore["objectPath"]>;
    try { target = this.objectPath(key); } catch (error) { if (isMissing(error)) return null; throw error; }
    let file: Awaited<ReturnType<typeof open>>;
    try { file = await open(target.filename, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (error) { if (isMissing(error)) return null; throw error; }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size < 4 || stat.size > MAX_OBJECT_BYTES + MAX_HEADER_BYTES + 4) throw new Error("object_file_unsafe");
      const prefix = Buffer.alloc(4); if ((await file.read(prefix, 0, 4, 0)).bytesRead !== 4) throw new Error("object_corrupt");
      const length = prefix.readUInt32BE(); if (!length || length > MAX_HEADER_BYTES || length + 4 > stat.size) throw new Error("object_corrupt");
      const header = Buffer.alloc(length); if ((await file.read(header, 0, length, 4)).bytesRead !== length) throw new Error("object_corrupt");
      const stored = JSON.parse(header.toString("utf8")) as StoredMetadata;
      if (stored.format !== 1 || stored.key !== key || !Number.isSafeInteger(stored.size) || stored.size < 0 || stored.size > MAX_OBJECT_BYTES || stored.size + length + 4 !== stat.size || !/^[a-f0-9]{64}$/.test(stored.etag) || !Number.isFinite(Date.parse(stored.uploaded)) || !stored.httpMetadata || !stored.customMetadata) throw new Error("object_corrupt");
      if (!body) return { stored };
      const bytes = Buffer.alloc(stored.size); if ((await file.read(bytes, 0, stored.size, length + 4)).bytesRead !== stored.size || createHash("sha256").update(bytes).digest("hex") !== stored.etag) throw new Error("object_corrupt");
      return { stored, bytes };
    } finally { await file.close(); }
  }
  async head(key: string): Promise<R2Object | null> { const result = await this.read(key, false); return result ? objectInfo(result.stored) : null; }
  async get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null> {
    if (options && Object.keys(options).length) throw new Error("object_option_unsupported");
    const result = await this.read(key, true); if (!result) return null;
    const response = new Response(new Uint8Array(result.bytes!));
    return Object.defineProperties(Object.assign(objectInfo(result.stored), {
      arrayBuffer: () => response.arrayBuffer(), bytes: async () => new Uint8Array(await response.arrayBuffer()),
      text: () => response.text(), json: <T>() => response.json() as Promise<T>, blob: () => response.blob(),
    }), { body: { enumerable: true, get: () => response.body! }, bodyUsed: { enumerable: true, get: () => response.bodyUsed } }) as R2ObjectBody;
  }
  async delete(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      let target: ReturnType<FileObjectStore["objectPath"]>;
      try { target = this.objectPath(key); } catch (error) { if (isMissing(error)) continue; throw error; }
      try {
        const file = await open(target.filename, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { const stat = await file.stat(); if (!stat.isFile() || stat.nlink !== 1) throw new Error("object_file_unsafe"); } finally { await file.close(); }
        await unlink(target.filename);
      } catch (error) { if (!isMissing(error)) throw error; }
    }
  }
}

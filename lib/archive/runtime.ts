import { ArchiveStore, type ArchiveDb } from "./store";
import { internalAuthorized } from "./security";

export async function archiveEnv(): Promise<Record<string, unknown>> {
  let bindings: Record<string, unknown> = {};
  try { bindings = (await import("cloudflare:workers")).env as unknown as Record<string, unknown>; } catch { /* Node test/dev fallback */ }
  return { ...process.env, ...bindings };
}

export async function archiveContext(request?: Request): Promise<{ env: Record<string, unknown>; store: ArchiveStore } | Response> {
  const env = await archiveEnv();
  if (request && !await internalAuthorized(request, env.HIRING_INTERNAL_SECRET as string | undefined)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = env.DB as ArchiveDb | undefined;
  if (!db?.prepare) return Response.json({ error: "archive_database_unavailable" }, { status: 503 });
  return { env, store: new ArchiveStore(db) };
}

export async function limitedBody(request: Request, max = 256 * 1024): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > max) throw new Error("body_too_large");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.length;
    if (length > max) { await reader.cancel(); throw new Error("body_too_large"); }
    chunks.push(part.value);
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

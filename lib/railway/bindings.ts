import { accessSync, chmodSync, constants, lstatSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { SQLiteD1Database } from "./sqlite";
import { FileObjectStore } from "./object-store";

export interface RailwayStorageOptions { dataDir?: string; migrationsDir?: string; production?: boolean }
export interface RailwayStorage { DB: D1Database; BUCKET: R2Bucket; dataDir: string; sqlite: SQLiteD1Database; objects: FileObjectStore }
const STORAGE = Symbol.for("ai-case-leads.railway.storage");
const globalStorage = globalThis as typeof globalThis & { [STORAGE]?: RailwayStorage };

export function initializeRailwayStorage(options: RailwayStorageOptions = {}): RailwayStorage {
  if (globalStorage[STORAGE]) {
    if (options.dataDir && path.resolve(options.dataDir) !== globalStorage[STORAGE]!.dataDir) throw new Error("railway_storage_already_initialized");
    return globalStorage[STORAGE]!;
  }
  const production = options.production ?? process.env.NODE_ENV === "production";
  const configured = options.dataDir ?? process.env.DATA_DIR;
  if (production && (!configured || !path.isAbsolute(configured))) throw new Error("railway_durable_volume_required");
  const dataDir = path.resolve(configured || path.join(process.cwd(), ".railway-data"));
  if (production && (process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_DEPLOYMENT_ID || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID)) {
    const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH;
    if (!mount || !path.isAbsolute(mount) || path.resolve(mount) !== dataDir) throw new Error("railway_durable_volume_required");
  }
  if (!production) mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  // Never silently create a missing production mount or follow a volume symlink.
  let stat; try { stat = lstatSync(dataDir); } catch { throw new Error("railway_durable_volume_required"); }
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(dataDir) !== dataDir) throw new Error("railway_volume_unsafe");
  accessSync(dataDir, constants.R_OK | constants.W_OK); chmodSync(dataDir, 0o700);
  const sqlite = new SQLiteD1Database(path.join(dataDir, "hiring.sqlite"));
  try {
    sqlite.migrate(options.migrationsDir ?? path.join(process.cwd(), "drizzle"));
    const objects = new FileObjectStore(path.join(dataDir, "objects"));
    const storage: RailwayStorage = { DB: sqlite.asD1(), BUCKET: objects.asR2(), dataDir, sqlite, objects };
    globalStorage[STORAGE] = storage;
    return storage;
  } catch (error) { sqlite.close(); throw error; }
}
export function getRailwayStorage(): RailwayStorage { return globalStorage[STORAGE] ?? initializeRailwayStorage(); }
export function closeRailwayStorage(): void { const storage = globalStorage[STORAGE]; if (storage) { storage.sqlite.close(); delete globalStorage[STORAGE]; } }
export async function healthRailwayStorage(): Promise<boolean> {
  const storage = getRailwayStorage();
  await storage.DB.prepare("SELECT 1 AS ready").first(); await storage.objects.health(); return true;
}
/** Vite aliases cloudflare:workers here. Both server and worker bundles share the global singleton. */
export const env: Record<string, unknown> = new Proxy({}, {
  get(_target, key) { if (key === "DB" || key === "BUCKET") return getRailwayStorage()[key]; return typeof key === "string" ? process.env[key] : undefined; },
  has(_target, key) { return key === "DB" || key === "BUCKET" || typeof key === "string" && key in process.env; },
  ownKeys() { return [...new Set([...Object.keys(process.env), "DB", "BUCKET"])]; },
  getOwnPropertyDescriptor(_target, key) { return { enumerable: true, configurable: true, value: typeof key === "string" && ["DB", "BUCKET"].includes(key) ? getRailwayStorage()[key as "DB" | "BUCKET"] : typeof key === "string" ? process.env[key] : undefined }; },
});

import path from "node:path";

export interface RailwayConfig { origin: string; dataDir: string; port: number; backgroundEnabled: boolean }
/** Validate before loading routes or opening persistent storage. Never include values in errors. */
export function railwayConfig(env: NodeJS.ProcessEnv = process.env): RailwayConfig {
  if (env.HOSTING_PLATFORM !== "railway") throw new Error("railway_runtime_required");
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("node24_runtime_required");
  let site: URL;
  try { site = new URL(env.PUBLIC_SITE_ORIGIN || ""); } catch { throw new Error("public_origin_required"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(site.hostname);
  if (site.username || site.password || site.pathname !== "/" || site.search || site.hash || (site.protocol !== "https:" && !(env.NODE_ENV !== "production" && local && site.protocol === "http:"))) throw new Error("public_origin_invalid");
  const owners = (env.ADMIN_EMAILS || "").split(",").map(value => value.trim()).filter(Boolean);
  if (!owners.length || owners.some(value => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) throw new Error("staff_owner_required");
  if (!env.GOOGLE_CLIENT_ID?.trim() || !env.GOOGLE_CLIENT_SECRET?.trim()) throw new Error("staff_google_credentials_required");
  if (!/^[a-fA-F0-9]{64}$/.test(env.GOOGLE_TOKEN_KEY || "")) throw new Error("google_token_key_required");
  if (!env.DATA_DIR || !path.isAbsolute(env.DATA_DIR) || path.resolve(env.DATA_DIR) !== env.DATA_DIR) throw new Error("persistent_data_dir_required");
  if (env.NODE_ENV === "production" && (!env.RAILWAY_VOLUME_MOUNT_PATH || env.RAILWAY_VOLUME_MOUNT_PATH !== env.DATA_DIR)) throw new Error("persistent_volume_required");
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("http_port_invalid");
  if (env.BACKGROUND_ENABLED !== undefined && !["true", "false"].includes(env.BACKGROUND_ENABLED)) throw new Error("background_setting_invalid");
  return { origin: site.origin, dataDir: env.DATA_DIR, port, backgroundEnabled: env.BACKGROUND_ENABLED !== "false" };
}

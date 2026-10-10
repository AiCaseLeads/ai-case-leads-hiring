import { env } from "cloudflare:workers";
import { LocalHiringProvider, LocalHiringStore, acceptLocalApplication } from "./local";
import { readSession, type HiringDependencies } from "./http";

export type HiringEnv = { APPLICATIONS_ENABLED?: string; DB?: D1Database; BUCKET?: R2Bucket };
export function getHiringEnv(): HiringEnv {
  const bindings = env as unknown as HiringEnv;
  return { ...bindings, APPLICATIONS_ENABLED: bindings.APPLICATIONS_ENABLED || process.env.APPLICATIONS_ENABLED };
}
export function hiringDependencies(request?: Request): HiringDependencies {
  const config = getHiringEnv(), db = config.DB, enabled = config.APPLICATIONS_ENABLED === "true";
  return {
    provider: db ? new LocalHiringProvider(db,request ? readSession(request) : undefined,request ? new URL(request.url).origin : undefined) : undefined,
    store: db ? new LocalHiringStore(db) : undefined,
    applicationsEnabled: enabled,
    customSubmit: db ? (input,session)=>acceptLocalApplication(db,input,session,enabled,true) : undefined,
  };
}

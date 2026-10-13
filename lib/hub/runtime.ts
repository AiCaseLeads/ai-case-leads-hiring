import { configurationFingerprint } from "../google/config-state";
import { workspaceEnv, workspaceStatus,resolvedWorkspaceEnv } from "../workspace-config";
import { HubStore } from "./store";
import { HiringError } from "../hiring/errors";
export async function getHubStore(request?:Request):Promise<HubStore>{
  const bindings=workspaceEnv();
  if(!bindings.DB)throw new HiringError("database_unavailable",503,"The hiring database is unavailable.");
  const status=await workspaceStatus(bindings);
  return new HubStore(bindings.DB,{origin:request?new URL(request.url).origin:bindings.PUBLIC_SITE_ORIGIN,expectedRecruitingSender:status.expectedSender,googleFingerprint:await configurationFingerprint(await resolvedWorkspaceEnv(bindings)),integrations:{google:status.connected,drive:status.connected&&!!status.driveRootId,applicationsEnabled:bindings.APPLICATIONS_ENABLED==="true"}});
}
export async function getHubRuntime(request?:Request){return {store:await getHubStore(request)};}

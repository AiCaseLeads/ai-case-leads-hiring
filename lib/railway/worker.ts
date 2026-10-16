import { initializeRailwayStorage, closeRailwayStorage } from "./bindings";
import { railwayConfig } from "./config";
import { BackgroundRunner } from "./background";
import { workspaceEnv, workspaceStatus, workspaceClient } from "../workspace-config";
import { HubStore } from "../hub/store";
import { processAiMatches } from "../ai/matching";
import { processHubTasks } from "../task-runner";
export { railwayConfig } from "./config";

export async function initializeRuntime() {
  const config = railwayConfig();
  const storage = initializeRailwayStorage();
  const runner = new BackgroundRunner(async () => {
    const bindings = workspaceEnv(), status = await workspaceStatus(bindings);

    const store = new HubStore(storage.DB, { origin: config.origin, integrations: { google: status.connected, drive: !!status.driveRootId, applicationsEnabled: bindings.APPLICATIONS_ENABLED === "true" } });
    // This processor also repairs missing archive tasks and Gmail deltas every
    // cycle, more frequently than the required hourly reconciliation.
    await processHubTasks(store, storage.DB, storage.BUCKET, status.connected ? await workspaceClient(bindings) : undefined, 10);
    const ready = await storage.DB.prepare("SELECT 1 AS ready FROM hub_tasks t WHERE t.attempts<8 AND ((t.status IN ('pending','failed') AND t.run_after<=?) OR (t.kind='calendar' AND t.status='uncertain' AND t.run_after<=?) OR (t.kind<>'gmail' AND t.status='running' AND t.lease_until<=?)) AND NOT EXISTS (SELECT 1 FROM hub_tasks active WHERE active.application_id=t.application_id AND active.status='running' AND active.lease_until>?) LIMIT 1").bind(Date.now(),Date.now(),Date.now(),Date.now()).first();
    return { hasMore: !!ready };
  }, { enabled: config.backgroundEnabled, log: code => console.error(`[railway] ${code}`) });
  let aiTimer:ReturnType<typeof setTimeout>|undefined, aiPending:Promise<void>|undefined, aiStopping=false;
  const aiCycle=async()=>{
    if(aiStopping)return;
    let busy=false;
    aiPending=(async()=>{
      try{
        const bindings=workspaceEnv();
        const result=await processAiMatches({store:new HubStore(storage.DB,{origin:config.origin}),bucket:storage.BUCKET,encryptionKey:bindings.GOOGLE_TOKEN_KEY});
        busy=result.hasMore;
      }catch{console.error('[railway] ai_match_cycle_failed');}
    })();
    await aiPending;aiPending=undefined;
    if(!aiStopping)aiTimer=setTimeout(()=>{void aiCycle();},busy?5000:60000);
  };
  await runner.start();
  // Separate awaited loop: PDF/OCR/provider latency cannot delay Gmail or Calendar.
  if(config.backgroundEnabled)aiTimer=setTimeout(()=>{void aiCycle();},1000);
  return { async stop() {
    aiStopping=true;if(aiTimer)clearTimeout(aiTimer);
    const googleStopped=await runner.stop();
    if(aiPending)await aiPending;
    return googleStopped;
  }, closeStorage() { closeRailwayStorage(); } };
}

import { initializeRailwayStorage, closeRailwayStorage } from "./bindings";
import { railwayConfig } from "./config";
import { BackgroundRunner } from "./background";
import { workspaceEnv, workspaceStatus, workspaceClient, resolvedWorkspaceEnv } from "../workspace-config";
import { HubStore } from "../hub/store";
import { processAiMatches } from "../ai/matching";
import { processHubTasks } from "../task-runner";
import { processResumeTextBatch } from "../resume-text/worker";
import { requeueFailedFileText, RESUME_BATCH_SIZE } from "../resume-text/cache";
import { startTextCycle, finishTextCycle } from "../resume-text/health";
export { railwayConfig } from "./config";

/** Optional operator-triggered bounded backfill, sharing the live worker's lease.
 * No applicant state, notifications or Google tasks are changed. */
export async function backfillResumeText(maxFiles=1,options:{retryFailed?:boolean}={}) {
  if(!Number.isSafeInteger(maxFiles)||maxFiles<1||maxFiles>30)throw new Error('resume_backfill_limit_1_to_30');
  if(options.retryFailed!==undefined&&typeof options.retryFailed!=='boolean')throw new Error('resume_backfill_retry_flag_invalid');
  const storage=initializeRailwayStorage();let processed=0,requeued=0;
  try{
    if(options.retryFailed)requeued=await requeueFailedFileText(new HubStore(storage.DB),maxFiles);
    while(processed<maxFiles){
      const result=await processResumeTextBatch({store:new HubStore(storage.DB),bucket:storage.BUCKET},Math.min(RESUME_BATCH_SIZE,maxFiles-processed));
      processed+=result.processed;if(!result.processed)break;
    }
    const rows=await storage.DB.prepare('SELECT status,COUNT(*) AS count FROM hub_file_text GROUP BY status').all();
    return {processed,requeued,statusCounts:rows.results};
  }finally{closeRailwayStorage();}
}

/** Explicit operator diagnostic, restricted to the configured owner's own mailbox.
 * Never scheduled by the worker and never exposed through MCP or HTTP. */
export async function sendOwnerRecruitingTest(email:string,testId:string) {
  const storage=initializeRailwayStorage();
  try {
    const {sendOwnerMailTest}=await import('../personal-mail/diagnostic');
    return await sendOwnerMailTest(new HubStore(storage.DB),email,testId,{...await resolvedWorkspaceEnv(),ADMIN_EMAILS:process.env.ADMIN_EMAILS});
  }finally{closeRailwayStorage();}
}

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
  let textTimer:ReturnType<typeof setTimeout>|undefined,textPending:Promise<void>|undefined,textStopping=false;
  const textCycle=async()=>{
    if(textStopping)return;
    let busy=false;
    startTextCycle();
    textPending=(async()=>{
      let failed=false;
      try {
        const result=await processResumeTextBatch({store:new HubStore(storage.DB,{origin:config.origin}),bucket:storage.BUCKET,shouldStop:()=>textStopping});
        busy=result.hasMore && result.processed>0;
      } catch {
        failed=true;
        console.error('[railway] resume_text_cycle_failed');
      } finally {
        finishTextCycle(failed);
      }
    })();
    await textPending;
    textPending=undefined;
    if(!textStopping)textTimer=setTimeout(()=>{void textCycle();},busy?250:5000);

  };
  await runner.start();
  // Separate awaited loop: PDF/OCR/provider latency cannot delay Gmail or Calendar.
  if(config.backgroundEnabled)aiTimer=setTimeout(()=>{void aiCycle();},1000);
  if(config.backgroundEnabled)textTimer=setTimeout(()=>{void textCycle();},1500);
  return { async stop() {
    aiStopping=true;if(aiTimer)clearTimeout(aiTimer);
    textStopping=true;if(textTimer)clearTimeout(textTimer);
    const googleStopped=await runner.stop();
    if(aiPending)await aiPending;
    if(textPending)await textPending;
    return googleStopped;
  }, closeStorage() { closeRailwayStorage(); } };
}

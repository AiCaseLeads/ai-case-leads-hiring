import { initializeRailwayStorage, closeRailwayStorage } from "./bindings";
import { railwayConfig } from "./config";
import { BackgroundRunner } from "./background";
import { workspaceEnv, workspaceStatus, workspaceClient } from "../workspace-config";
import { HubStore } from "../hub/store";
import { processHubTasks } from "../task-runner";
export { railwayConfig } from "./config";

export async function initializeRuntime() {
  const config = railwayConfig();
  const storage = initializeRailwayStorage();
  const runner = new BackgroundRunner(async () => {
    const bindings = workspaceEnv(), status = await workspaceStatus(bindings);
    if (!status.connected) return;
    const store = new HubStore(storage.DB, { origin: config.origin, integrations: { google: true, drive: !!status.driveRootId, applicationsEnabled: bindings.APPLICATIONS_ENABLED === "true" } });
    // This processor also repairs missing archive tasks and Gmail deltas every
    // cycle, more frequently than the required hourly reconciliation.
    await processHubTasks(store, storage.DB, storage.BUCKET, await workspaceClient(bindings), 10);
  }, { enabled: config.backgroundEnabled, log: code => console.error(`[railway] ${code}`) });
  await runner.start();
  return { async stop() { return runner.stop(); }, closeStorage() { closeRailwayStorage(); } };
}

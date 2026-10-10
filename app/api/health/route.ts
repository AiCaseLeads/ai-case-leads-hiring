import { healthRailwayStorage } from "@/lib/railway/bindings";
import { backgroundHealth } from "@/lib/railway/background";
export const dynamic = "force-dynamic";
export async function GET() {
  let storage = false;
  try { storage = await healthRailwayStorage(); } catch { /* No paths, SQL, or configuration values in public health. */ }
  const worker = backgroundHealth();
  const background = !!worker && !worker.stopping && (!worker.enabled || (!!worker.lastCycleAt && Date.now() - worker.lastCycleAt < 150_000 && !worker.error));
  const ready = storage && background;
  return Response.json({ status: ready ? "ready" : "unavailable", checks: { storage, background, backgroundEnabled: worker?.enabled ?? false } }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

import path from "node:path";
import { fileURLToPath } from "node:url";
import { railwayRequestHandler } from "./railway-http.mjs";

process.env.HOSTING_PLATFORM = "railway";
process.env.NODE_ENV ||= "production";
const root = fileURLToPath(new URL("..", import.meta.url));
process.chdir(root);
let runtime, server, closing;
async function shutdown(exitCode = 0) {
  if (closing) return closing;
  closing = (async () => {
    console.log("[railway] shutting_down");
    const httpClosed = server ? new Promise(resolve => { server.close(() => resolve(true)); server.closeIdleConnections(); }) : Promise.resolve(true);
    let timer;
    const results = await Promise.race([Promise.all([runtime?.stop() ?? true, httpClosed]), new Promise(resolve => { timer = setTimeout(() => resolve([false, false]), 48_000); })]);
    clearTimeout(timer);
    if (results.every(Boolean)) runtime?.closeStorage();
    else { server?.closeAllConnections(); console.error("[railway] shutdown_deadline_reached"); }
    process.exit(exitCode);
  })();
  return closing;
}
try {
  const worker = await import(new URL("../dist/railway/worker.mjs", import.meta.url));
  const config = worker.railwayConfig();
  // Vinext trusts only the headers normalized by our Node request boundary.
  process.env.VINEXT_TRUST_PROXY = "1";
  process.env.VINEXT_TRUSTED_HOSTS = new URL(config.origin).host;
  runtime = await worker.initializeRuntime();
  const { startProdServer } = await import("vinext/server/prod-server");
  ({ server } = await startProdServer({ port: 0, host: "127.0.0.1", outDir: path.join(root, "dist"), silent: true }));
  const listeners = server.listeners("request");
  server.removeAllListeners("request");
  server.on("request", railwayRequestHandler(listeners, config.origin));
  await new Promise(resolve => server.close(resolve));
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(config.port, "0.0.0.0", resolve); });
  console.log("[railway] http_ready");
  process.on("SIGTERM", () => { void shutdown(); });
  process.on("SIGINT", () => { void shutdown(); });
  process.on("uncaughtException", () => { console.error("[railway] runtime_failed"); void shutdown(1); });
  process.on("unhandledRejection", () => { console.error("[railway] runtime_failed"); void shutdown(1); });
} catch (error) {
  const code = error instanceof Error && /^[a-z0-9_]{1,100}$/.test(error.message) ? error.message : "startup_failed";
  console.error(`[railway] ${code}`);
  if (runtime) await shutdown(1);
  process.exitCode = 1;
}

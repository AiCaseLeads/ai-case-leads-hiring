import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
const root = process.cwd(), canonical = "https://careers.example.invalid";
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function availablePort() {
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address()!; assert.ok(typeof address !== "string");
  await new Promise<void>(resolve => server.close(() => resolve())); return address.port;
}
async function stop(child: ChildProcess) {
  const exited = new Promise<number | null>(resolve => child.once("exit", resolve)); child.kill("SIGTERM");
  const result = await Promise.race([exited, pause(5000).then(() => "timeout")]);
  if (result === "timeout") { child.kill("SIGKILL"); throw new Error("runtime_did_not_drain"); }
  assert.equal(result, 0);
}
async function launch(volume: string) {
  const port = await availablePort(), origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["scripts/start-railway.mjs"], { cwd: root, env: { ...process.env, NODE_ENV: "production", HOSTING_PLATFORM: "sites", PORT: String(port), DATA_DIR: volume, RAILWAY_VOLUME_MOUNT_PATH: volume, PUBLIC_SITE_ORIGIN: canonical, ADMIN_EMAILS: "owner@example.invalid", GOOGLE_CLIENT_ID: "synthetic.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "synthetic-secret", GOOGLE_TOKEN_KEY: "f".repeat(64), APPLICATIONS_ENABLED: "false", BACKGROUND_ENABLED: "false" }, stdio: ["ignore", "pipe", "pipe"] });
  let logs = ""; child.stdout!.on("data", chunk => { logs += chunk; }); child.stderr!.on("data", chunk => { logs += chunk; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error("native_server_start_failed: " + logs);
    if (logs.includes("[railway] http_ready")) return { child, origin };
    await pause(50);
  }
  child.kill("SIGKILL"); throw new Error("native_server_start_timeout");
}

test("built Node production server serves assets, protects staff data, fixes OAuth origin and restarts on its volume", { skip: !existsSync(path.join(root, "dist/railway/worker.mjs")) }, async () => {
  const volume = await realpath(await mkdtemp(path.join(tmpdir(), "railway-prod-")));
  let instance: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    instance = await launch(volume);
    const base = instance.origin;
    const health = await fetch(base + "/api/health"); assert.equal(health.status, 200); assert.deepEqual(await health.json(), { resumeCoverage: { totalFiles: 0, pending: 0, running: 0, ready: 0, partial: 0, failed: 0, worker: null }, status: "ready", checks: { storage: true, background: true, backgroundEnabled: false } });
    const home = await fetch(base + "/"); assert.equal(home.status, 200); const html = await home.text(); assert.match(html, /AI Case Leads/);
    const team = await fetch(base + "/team"); assert.equal(team.status, 200); assert.match(await team.text(), /Sign in with Google/);
    const jobs = await (await fetch(base + "/api/jobs")).json() as { jobs: unknown[]; submissionEnabled: boolean }; assert.deepEqual(jobs.jobs, []); assert.equal(jobs.submissionEnabled, false);
    const forged = { "OAI-Authenticated-User-ID": "synthetic-owner", "OAI-Authenticated-User-Email": "owner@example.invalid", "X-OpenAI-User-Email": "owner@example.invalid", "X-Forwarded-Host": "evil.invalid", "X-Forwarded-Proto": "http", Host: "evil.invalid" };
    for (const endpoint of ["/api/hub/settings", "/api/hub/applications", "/api/files/private-probe"]) {
      const response = await fetch(base + endpoint, { headers: forged }); assert.equal(response.status, 403); assert.equal(((await response.json()) as { error: { code: string } }).error.code, "staff_access_required");
    }
    const signIn = await fetch(base + "/api/auth/google/start?return_to=//evil.invalid", { redirect: "manual", headers: forged }); assert.equal(signIn.status, 303);
    const authorization = new URL(signIn.headers.get("location")!); assert.equal(authorization.origin, "https://accounts.google.com"); assert.equal(authorization.searchParams.get("redirect_uri"), canonical + "/api/auth/google/callback"); assert.match(signIn.headers.get("set-cookie")!, /__Host-aicl_staff_oauth=.*; Secure/);
    const callback = await fetch(base + "/api/auth/google/callback?state=invalid&error=synthetic-private-provider-error", { redirect: "manual", headers: forged }); assert.equal(callback.status, 303); assert.equal(callback.headers.get("location"), canonical + "/team?auth=expired");
    const js = /src="([^\"]*\/_next\/static\/[^\"]+\.js)"/.exec(html)?.[1]; assert.ok(js, "production HTML must reference a real JS chunk");
    const asset = await fetch(base + js); assert.equal(asset.status, 200); assert.match(asset.headers.get("content-type")!, /javascript/); assert.equal(asset.headers.get("cache-control"), "no-store"); await asset.arrayBuffer();
    const missing = await fetch(base + "/_next/static/missing-runtime-probe.js"); assert.equal(missing.status, 404); assert.equal(missing.headers.get("cache-control"), "no-store"); assert.equal(missing.headers.get("etag"), null); assert.equal(missing.headers.get("last-modified"), null);
    await stop(instance.child); instance = undefined;
    const before = new DatabaseSync(path.join(volume, "hiring.sqlite")); const states = before.prepare("SELECT COUNT(*) AS n FROM staff_oauth_states").get()!.n; before.close(); assert.equal(states, 1);
    instance = await launch(volume);
    assert.equal((await fetch(instance.origin + "/api/health")).status, 200);
    const after = new DatabaseSync(path.join(volume, "hiring.sqlite")); assert.equal(after.prepare("SELECT COUNT(*) AS n FROM staff_oauth_states").get()!.n, states); after.close();
  } finally { if (instance) await stop(instance.child); await rm(volume, { recursive: true, force: true }); }
});

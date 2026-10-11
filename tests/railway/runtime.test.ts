import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, request as httpRequest } from "node:http";
import { BackgroundRunner, backgroundHealth } from "../../lib/railway/background";
import { railwayConfig } from "../../lib/railway/config";
import { initializeRailwayStorage, closeRailwayStorage } from "../../lib/railway/bindings";
import { GET as health } from "../../app/api/health/route";
import { normalizeRailwayRequest, railwayRequestHandler } from "../../scripts/railway-http.mjs";
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const production: NodeJS.ProcessEnv = { NODE_ENV: "production", HOSTING_PLATFORM: "railway", PUBLIC_SITE_ORIGIN: "https://careers.example.invalid", ADMIN_EMAILS: "owner@example.invalid", GOOGLE_CLIENT_ID: "synthetic", GOOGLE_CLIENT_SECRET: "synthetic", GOOGLE_TOKEN_KEY: "f".repeat(64), DATA_DIR: "/data", RAILWAY_VOLUME_MOUNT_PATH: "/data", PORT: "3000" };

test("runtime refuses missing production configuration and unmounted storage without leaking values", () => {
  assert.deepEqual(railwayConfig(production), { origin: "https://careers.example.invalid", dataDir: "/data", port: 3000, backgroundEnabled: true });
  for (const key of ["PUBLIC_SITE_ORIGIN", "ADMIN_EMAILS", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY", "DATA_DIR", "RAILWAY_VOLUME_MOUNT_PATH"]) {
    assert.throws(() => railwayConfig({ ...production, [key]: undefined }), error => error instanceof Error && /^[a-z0-9_]+$/.test(error.message));
  }
  for (const origin of ["http://careers.example.invalid", "https://owner:password@example.invalid", "https://careers.example.invalid/path", "https://careers.example.invalid?next=x"]) assert.throws(() => railwayConfig({ ...production, PUBLIC_SITE_ORIGIN: origin }));
  assert.throws(() => railwayConfig({ ...production, RAILWAY_VOLUME_MOUNT_PATH: "/other" }), /persistent_volume_required/);
  assert.equal(railwayConfig({ ...production, BACKGROUND_ENABLED: "false" }).backgroundEnabled, false);
});

test("explicitly disabled background processing never starts a cycle", async () => {
  let calls = 0;
  const runner = new BackgroundRunner(async () => { calls++; }, { enabled: false, intervalMs: 1 });
  await runner.start(); await pause(5);
  assert.equal(calls, 0); assert.equal(backgroundHealth()?.enabled, false); assert.equal(backgroundHealth()?.lastCycleAt, null);
  assert.equal(await runner.stop(), true);
});

test("background loop has one in-flight cycle and stops scheduling after draining", async () => {
  let calls = 0, release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  const runner = new BackgroundRunner(async () => { calls++; if (calls === 2) { entered(); await held; } }, { intervalMs: 2, drainMs: 100 });
  await runner.start(); await ready; await pause(10); assert.equal(calls, 2);
  const stopping = runner.stop(); release(); assert.equal(await stopping, true);
  await pause(10); assert.equal(calls, 2); assert.equal(backgroundHealth()?.stopping, true);
});

test("shutdown deadline leaves unfinished provider work leased for recovery", async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const runner = new BackgroundRunner(() => held, { intervalMs: 1, drainMs: 5 });
  const start = runner.start(); await pause(1); assert.equal(await runner.stop(), false);
  assert.equal(backgroundHealth()?.running, true); assert.equal(backgroundHealth()?.stopping, true);
  release(); await start;
});

test("ready backlog drains promptly and returns to idle cadence without overlapping", async () => {
  let calls = 0, active = 0, maxActive = 0, drained!: () => void;
  const ready = new Promise<void>(resolve => { drained = resolve; });
  const runner = new BackgroundRunner(async () => {
    calls++; active++; maxActive = Math.max(maxActive, active);
    await pause(2); active--;
    if (calls === 3) drained();
    return { hasMore: calls < 3 };
  }, { intervalMs: 30_000, busyIntervalMs: 1 });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await runner.start();
    await Promise.race([ready, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("backlog did not drain")), 2000); })]);
    await pause(15);
    assert.equal(calls, 3); assert.equal(maxActive, 1);
  } finally { clearTimeout(timeout); await runner.stop(); }
});

test("health checks real temporary storage and background readiness without exposing configuration", async () => {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "railway-health-")));
  const runner = new BackgroundRunner(async () => {}, { intervalMs: 60_000 });
  try {
    initializeRailwayStorage({ dataDir: dir, production: false });
    await runner.start();
    const ready = await health(); assert.equal(ready.status, 200); assert.equal(ready.headers.get("cache-control"), "no-store");
    assert.deepEqual(await ready.json(), { status: "ready", checks: { storage: true, background: true, backgroundEnabled: true } });
    await runner.stop(); const stopped = await health(); assert.equal(stopped.status, 503); assert.equal(JSON.stringify(await stopped.json()).includes(dir), false);
  } finally { await runner.stop(); closeRailwayStorage(); await rm(dir, { recursive: true, force: true }); }
});

test("Node boundary fixes origin and strips forged identity/proxy/IP headers", () => {
  const request = { headers: { host: "evil.invalid", "x-forwarded-host": "evil.invalid", "x-forwarded-proto": "http", "oai-authenticated-user-email": "owner@example.invalid", "cf-connecting-ip": "198.51.100.1", "x-real-ip": "203.0.113.1", "x-forwarded-for": "203.0.113.2, 203.0.113.3" }, socket: { remoteAddress: "127.0.0.1" } };
  normalizeRailwayRequest(request, production.PUBLIC_SITE_ORIGIN!, false);
  assert.equal(request.headers.host, "careers.example.invalid"); assert.equal(request.headers["x-forwarded-proto"], "https");
  assert.equal(request.headers["cf-connecting-ip"], "127.0.0.1"); assert.equal("oai-authenticated-user-email" in request.headers, false); assert.equal("x-real-ip" in request.headers, false); assert.equal("x-forwarded-for" in request.headers, false);
  const edge = { headers: { "x-real-ip": "203.0.113.1", "cf-connecting-ip": "198.51.100.1" }, socket: { remoteAddress: "127.0.0.1" } };
  normalizeRailwayRequest(edge, production.PUBLIC_SITE_ORIGIN!, true); assert.equal(edge.headers["cf-connecting-ip"], "203.0.113.1");
  const invalid = { headers: { "x-real-ip": "203.0.113.1,203.0.113.2", "cf-connecting-ip": "198.51.100.1" }, socket: { remoteAddress: "127.0.0.1" } };
  normalizeRailwayRequest(invalid, production.PUBLIC_SITE_ORIGIN!, true); assert.equal(invalid.headers["cf-connecting-ip"], "127.0.0.1");
});

test("legacy Railway host redirects navigation safely but never replays writes", async () => {
  const legacy = "hiring-production.up.railway.app";
  let reached = 0;
  const listener = (_request: unknown, response: import("node:http").ServerResponse) => { reached++; response.end("ready"); };
  const server = createServer(railwayRequestHandler([listener], production.PUBLIC_SITE_ORIGIN!, legacy));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address()!; assert.ok(typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const send = (url: string, options: { method?: string; headers?: Record<string, string>; body?: string; redirect?: string }) => new Promise<{ status: number; headers: Headers }>((resolve, reject) => {
    const req = httpRequest(url, { method: options.method, headers: options.headers }, res => {
      res.resume(); res.on("end", () => resolve({ status: res.statusCode!, headers: new Headers(Object.entries(res.headers).filter(([, value]) => typeof value === "string") as [string, string][]) }));
    });
    req.on("error", reject); req.end(options.body);
  });
  try {
    for (const method of ["GET", "HEAD"]) {
      const response = await send(base + "/interview/private-token?source=old", { method, headers: { Host: legacy }, redirect: "manual" });
      assert.equal(response.status, 307);
      assert.equal(response.headers.get("location"), production.PUBLIC_SITE_ORIGIN + "/interview/private-token?source=old");
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.equal(reached, 0);
    const write = await send(base + "/api/applications", { method: "POST", headers: { Host: legacy }, body: "private data", redirect: "manual" });
    assert.equal(write.status, 403); assert.equal(write.headers.get("location"), null); assert.equal(reached, 0);
    for (const host of ["evil.invalid", "careers.example.invalid"]) {
      const response = await send(base + "/", { headers: { Host: host, "X-Forwarded-Host": legacy }, redirect: "manual" });
      assert.equal(response.status, 200); assert.equal(response.headers.get("location"), null);
    }
    const health = await send(base + "/api/health", { headers: { Host: legacy }, redirect: "manual" });
    assert.equal(health.status, 200); assert.equal(health.headers.get("location"), null);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("actual Node stream caps chunked bodies and prevents missing-asset caching", async () => {
  const listener = async (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => {
    let bytes = 0; for await (const chunk of request) bytes += chunk.length;
    response.writeHead(request.url?.startsWith("/_next/static/") ? 404 : 200, { "Content-Type": "application/json", "Cache-Control": "public,max-age=31536000", ETag: "test", "Last-Modified": "test" });
    response.end(JSON.stringify({ bytes, host: request.headers.host, proto: request.headers["x-forwarded-proto"] }));
  };
  const server = createServer(railwayRequestHandler([listener], production.PUBLIC_SITE_ORIGIN!));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address()!; assert.ok(typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const okay = await fetch(origin + "/api/synthetic", { method: "POST", body: "synthetic", headers: { Host: "evil.invalid", "X-Forwarded-Proto": "http" } }); assert.equal(okay.status, 200); assert.equal(okay.headers.get("cache-control"), "no-store"); assert.deepEqual(await okay.json(), { bytes: 9, host: "careers.example.invalid", proto: "https" });
    const uploadPath = "/api/uploads/" + "f".repeat(64);
    const oneMiB = await fetch(origin + uploadPath, { method: "POST", body: new Uint8Array(1024 * 1024) }); assert.equal(oneMiB.status, 200); assert.equal(((await oneMiB.json()) as { bytes: number }).bytes, 1024 * 1024);
    const maxMultipart = await fetch(origin + uploadPath, { method: "POST", body: new Uint8Array(10 * 1024 * 1024 + 65536) }); assert.equal(maxMultipart.status, 200); assert.equal(((await maxMultipart.json()) as { bytes: number }).bytes, 10 * 1024 * 1024 + 65536);
    const tooLarge = await fetch(origin + uploadPath, { method: "POST", body: new Uint8Array(10 * 1024 * 1024 + 65537) }); assert.equal(tooLarge.status, 413); await tooLarge.arrayBuffer();
    const stream = new ReadableStream({ start(controller) { for (let index = 0; index < 10; index++) controller.enqueue(new Uint8Array(64 * 1024)); controller.close(); } });
    const large = await fetch(origin + "/api/synthetic", { method: "POST", body: stream, duplex: "half" } as RequestInit); assert.equal(large.status, 413);
    const missing = await fetch(origin + "/_next/static/missing.js"); assert.equal(missing.status, 404); assert.equal(missing.headers.get("cache-control"), "no-store"); assert.equal(missing.headers.get("etag"), null); assert.equal(missing.headers.get("last-modified"), null);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

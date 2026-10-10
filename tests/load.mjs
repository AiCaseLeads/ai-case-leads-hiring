// Run with: npx --yes tsx tests/load.mjs
// This uses the production HTTP handler, HiringService, D1HiringStore SQL and migration.
// Only the remote Ashby account and Drive task transport are isolated fixtures.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { postApplication, getReceipt } from "../lib/hiring/http.ts";
import { HiringService } from "../lib/hiring/service.ts";
import { applicationInput, FixtureProvider, SESSION, sqliteStore } from "./hiring/fixtures.ts";

class IsolatedAshbyProvider extends FixtureProvider {
  instances = new Map();
  active = 0;
  maximumActive = 0;
  async submit() {
    this.submitCalls++;
    this.active++;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    try {
      // Yield like a remote call, without predicting Ashby's rate limits or latency.
      await new Promise(resolve => setTimeout(resolve, 3));
      const instanceId = randomUUID();
      this.instances.set(instanceId, randomUUID());
      return { blocked: false, submittedFormInstanceId: instanceId };
    } finally { this.active--; }
  }
  async resolveApplicationId(instanceId) {
    const applicationId = this.instances.get(instanceId);
    assert.ok(applicationId);
    return applicationId;
  }
}

const { database, store } = sqliteStore();
const provider = new IsolatedAshbyProvider();
const archiveRequests = new Map();
const deps = { provider, store, applicationsEnabled: true, archive: async (applicationId, dedupeKey) => { archiveRequests.set(dedupeKey, applicationId); } };
let serverOrigin;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, serverOrigin);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    const webRequest = new Request(url, { method: request.method, headers, ...(request.method === "GET" ? {} : { body: Buffer.concat(chunks) }) });
    const result = url.pathname === "/api/applications"
      ? await postApplication(webRequest, deps)
      : url.pathname.startsWith("/api/applications/")
        ? await getReceipt(url.pathname.split("/").at(-1), deps)
        : Response.json({ error: "not found" }, { status: 404 });
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Verification HTTP bridge failed" }));
  }
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
serverOrigin = `http://127.0.0.1:${server.address().port}`;
const started = performance.now();
const latencies = [], receipts = [];
let completed = 0;
try {
  for (let batch = 0; batch < 30; batch++) {
    const results = await Promise.all(Array.from({ length: 100 }, async (_, index) => {
      const sequence = batch * 100 + index;
      const input = applicationInput();
      input.fieldSubmissions = input.fieldSubmissions.map(field => field.path === "_systemfield_email"
        ? { ...field, value: `synthetic-${sequence}@example.invalid` }
        : field.path === "_systemfield_name" ? { ...field, value: `Synthetic Applicant ${sequence}` } : field);
      const session = randomBytes(32).toString("hex");
      const requestStarted = performance.now();
      const response = await fetch(`${serverOrigin}/api/applications`, { method: "POST", headers: { "Content-Type": "application/json", Origin: serverOrigin, Cookie: `hiring_session=${session}` }, body: JSON.stringify(input) });
      const result = await response.json();
      latencies.push(performance.now() - requestStarted);
      assert.equal(response.status, 201, `Submission ${sequence}: ${JSON.stringify(result)}`);
      assert.equal(result.status, "accepted");
      assert.match(result.receipt, /^[a-f0-9]{64}$/);
      receipts.push(result.receipt);
      completed++;
      return result;
    }));
    assert.equal(results.length, 100);
  }
  assert.equal(completed, 3000);
  assert.equal(provider.submitCalls, 3000);
  assert.equal(new Set(receipts).size, 3000);
  assert.equal(archiveRequests.size, 3000);
  const persisted = database.prepare("SELECT COUNT(*) AS count, COUNT(DISTINCT application_id) AS distinct_applications, SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted FROM hiring_submissions").get();
  assert.equal(persisted.count, 3000);
  assert.equal(persisted.accepted, 3000);
  assert.equal(persisted.distinct_applications, 3000);
  for (const receipt of [receipts[0], receipts[1499], receipts[2999]]) {
    const response = await fetch(`${serverOrigin}/api/applications/${receipt}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "accepted");
  }
  const forgedResponse = await fetch(`${serverOrigin}/api/applications/${"f".repeat(64)}`);
  assert.equal(forgedResponse.status, 404);

  const service = new HiringService(provider, store, true);
  const repeatedInput = applicationInput();
  const beforeRepeated = provider.submitCalls;
  const repeated = await Promise.all(Array.from({ length: 100 }, () => service.submit(repeatedInput, SESSION)));
  assert.equal(provider.submitCalls - beforeRepeated, 1);
  assert.ok(repeated.some(result => result.status === "accepted"));
  assert.ok(repeated.every(result => ["accepted", "pending"].includes(result.status)));
  assert.equal(provider.active, 0);

  latencies.sort((a, b) => a - b);
  console.log(JSON.stringify({
    status: "passed",
    syntheticApplications: completed,
    concurrentHttpRequestsPerBatch: 100,
    maximumIsolatedUpstreamCalls: provider.maximumActive,
    duplicateServiceCalls: 100,
    duplicateUpstreamWrites: provider.submitCalls - beforeRepeated,
    elapsedMs: Math.round(performance.now() - started),
    requestMedianMs: Math.round(latencies[Math.floor(latencies.length * 0.5)]),
    requestP95Ms: Math.round(latencies[Math.floor(latencies.length * 0.95)]),
    limitations: "Local HTTP, production service and D1 SQL on in-memory SQLite; isolated Ashby provider and Drive task transport. This does not measure production latency, Cloudflare quotas, Ashby rate limits, or Google Drive capacity.",
  }, null, 2));
} finally {
  await new Promise(resolve => server.close(resolve));
  database.close();
}

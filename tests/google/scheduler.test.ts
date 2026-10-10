import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../scripts/WorkspaceScheduler.gs", import.meta.url), "utf8");
function scheduler(status = 200, data: unknown = {configured:true,healthy:true,processed:1,failed:0,uncertain:0}) {
  const values: Record<string, string> = { HIRING_SITE_URL: "https://jobs.example.com", HIRING_SCHEDULER_SECRET: "secret".repeat(8), SITE_SERVICE_TOKEN: "private-bypass-token" };
  const requests: Array<{ url: string; options: Record<string, unknown> }> = [];
  const triggers = [{ getHandlerFunction: () => "runHiringQueue" }, { getHandlerFunction: () => "unrelatedHandler" }];
  let removed = 0, created = 0, released = 0;
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => values[key], setProperty: (key: string, value: string) => { values[key] = value; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { released++; } }) },
    UrlFetchApp: { fetch: (url: string, options: Record<string, unknown>) => { requests.push({ url, options }); return { getResponseCode: () => status,getContentText:()=>JSON.stringify({data}) }; } },
    ScriptApp: { getProjectTriggers: () => triggers, deleteTrigger: (trigger: unknown) => { assert.equal(trigger, triggers[0]); removed++; }, newTrigger: (handler: string) => ({ timeBased: () => ({ everyMinutes: (minutes: number) => { assert.equal(handler, "runHiringQueue"); assert.equal(minutes, 1); return { create: () => { created++; } }; } }) }) },
  });
  vm.runInContext(source, context);
  return { run: () => vm.runInContext("runHiringQueue()", context), install: () => vm.runInContext("installWorkspaceScheduler()", context), requests, values, counts: () => ({ removed, created, released }) };
}

test("scheduler sends only bounded queue wakeup with both private auth headers and no redirects", () => {
  const f = scheduler(); f.install(); f.run();
  assert.deepEqual(f.counts(), { removed: 1, created: 1, released: 1 });
  assert.equal(f.requests[0].url, "https://jobs.example.com/api/hub/process");
  assert.equal(f.requests[0].options.followRedirects, false);
  assert.equal(f.requests[0].options.timeoutSeconds, 50);
  const headers = f.requests[0].options.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${f.values.HIRING_SCHEDULER_SECRET}`);
  assert.equal(headers["OAI-Sites-Authorization"], "Bearer private-bypass-token");
  assert.equal(f.requests[0].options.payload, '{"limit":10}');
  assert.ok(f.values.HIRING_LAST_SUCCESS_AT);
});

test("scheduler records only wakeup health for disconnected or failing processing",()=>{
  for(const data of [{configured:false,processed:0},{configured:true,processed:0,failed:5,pending:100},{configured:true,healthy:false,error:"sync needs repair"}]){
    const f=scheduler(200,data);
    assert.throws(()=>f.run(),/disconnected|need attention/);
    assert.ok(f.values.HIRING_LAST_WAKEUP_AT);
    assert.equal(f.values.HIRING_LAST_SUCCESS_AT,undefined);
    assert.ok(f.values.HIRING_LAST_ERROR);
    assert.equal(f.counts().released,1);
  }
});

test("scheduler surfaces login redirects/failures, releases its lock and does not claim success", () => {
  const f = scheduler(302);
  assert.throws(() => f.run(), /HTTP 302/);
  assert.equal(f.requests.length, 1); assert.equal(f.counts().released, 1); assert.equal(f.values.HIRING_LAST_SUCCESS_AT, undefined);
});

test("scheduler rejects unsafe origin paths and credential/header injection before sending", () => {
  const f = scheduler(); f.values.HIRING_SITE_URL = "https://user:password@jobs.example.com/api/other";
  assert.throws(() => f.run(), /exact HTTPS site origin/); assert.equal(f.requests.length, 0);
  f.values.HIRING_SITE_URL = "https://jobs.example.com"; f.values.SITE_SERVICE_TOKEN = "token\r\nheader: value";
  assert.throws(() => f.run(), /Invalid private Sites service token/); assert.equal(f.requests.length, 0);
});

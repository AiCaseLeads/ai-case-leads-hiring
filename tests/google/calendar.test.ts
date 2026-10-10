import test from "node:test";
import assert from "node:assert/strict";
import { calendarEventId, GoogleError, GoogleWorkspace } from "../../lib/google/workspace";

function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
const config = { clientId: "client", clientSecret: "secret", refreshToken: "refresh", sender: "recruiting@example.com", calendarId: "interviews@example.com" };
const interview = { id: "interview-1", title: "Engineer interview", email: "candidate@example.com", start: "2026-10-15T15:00:00Z", end: "2026-10-15T15:30:00Z", timeZone: "America/New_York" };
const meetUrl = "https://meet.google.com/abc-defg-hij";

function fixture(options: { busy?: boolean; missingAvailability?: boolean; loseInsert?: boolean; pendingMeet?: boolean; conflicts?: boolean } = {}) {
  let stored: Record<string, unknown> | null = null; let inserts = 0, patches = 0, deletes = 0;
  const requests: Array<{ url: URL; method: string; headers: Headers }> = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method ?? "GET"; requests.push({ url, method, headers: new Headers(init.headers) });
    assert.equal(init.redirect, "manual");
    if (url.hostname === "oauth2.googleapis.com") return response({ access_token: "access", token_type: "Bearer", expires_in: 3600 });
    if (url.pathname.endsWith("/freeBusy")) return response({ calendars: options.missingAvailability ? {} : { [config.calendarId]: { busy: options.busy ? [{ start: interview.start, end: interview.end }] : [] } } });
    if (method === "GET" && url.pathname.endsWith("/events")) return response({ items: [stored, ...(options.conflicts ? [{ id: "other", start: { dateTime: "2026-10-15T16:00:00Z" }, end: { dateTime: "2026-10-15T16:30:00Z" } }] : [])].filter(Boolean) });
    if (method === "GET") return stored ? response(stored) : response({}, 404);
    if (method === "POST") {
      inserts++;
      const data = JSON.parse(String(init.body));
      assert.match(data.id, /^acl[a-f0-9]{64}$/);
      assert.equal(url.searchParams.get("conferenceDataVersion"), "1"); assert.equal(url.searchParams.get("sendUpdates"), "all");
      assert.equal(data.conferenceData.createRequest.conferenceSolutionKey.type, "hangoutsMeet");
      assert.equal(data.extendedProperties.private.aclInterviewId, data.id);
      stored = { ...data, etag: '"etag-1"', status: "confirmed", ...(options.pendingMeet ? {} : { hangoutLink: meetUrl }) };
      if (options.loseInsert) throw new Error("response lost after insert");
      return response(stored);
    }
    if (method === "PATCH") {
      patches++;
      assert.equal(new Headers(init.headers).get("If-Match"), '"etag-1"');
      assert.equal(url.searchParams.get("sendUpdates"), "all");
      stored = { ...stored, ...JSON.parse(String(init.body)), etag: '"etag-2"' };
      return response(stored);
    }
    if (method === "DELETE") { deletes++; stored = null; return new Response(null, { status: 204 }); }
    throw new Error("unexpected_test_request");
  };
  return { workspace: new GoogleWorkspace(config, fetcher), counts: () => ({ inserts, patches, deletes }), requests, replace: (value: Record<string, unknown>) => { stored = value; } };
}

test("Calendar creates Meet with deterministic event identity and repeats read the same event", async () => {
  const f = fixture(); const first = await f.workspace.createInterview(interview), again = await f.workspace.createInterview(interview);
  assert.equal(first.id, await calendarEventId(interview.id)); assert.equal(first.meetUrl, meetUrl);
  assert.deepEqual(again, first); assert.equal(f.counts().inserts, 1);
});

test("Calendar lost create response recovers the existing event without a second invitation", async () => {
  const f = fixture({ loseInsert: true });
  await assert.rejects(() => f.workspace.createInterview(interview), (error) => error instanceof GoogleError && error.code === "google_network_error" && error.uncertain);
  assert.equal((await f.workspace.createInterview(interview)).meetUrl, meetUrl);
  assert.equal(f.counts().inserts, 1);
});

for (const option of ["busy", "missingAvailability"] as const) test(`Calendar ${option} availability blocks event creation`, async () => {
  const f = fixture({ [option]: true });
  await assert.rejects(() => f.workspace.createInterview(interview), option === "busy" ? /interview_slot_conflict/ : /calendar_availability_unavailable/);
  assert.equal(f.counts().inserts, 0);
});

test("pending Meet never reports a completed interview or creates duplicate events", async () => {
  const f = fixture({ pendingMeet: true });
  await assert.rejects(() => f.workspace.createInterview(interview), /calendar_meet_pending/);
  await assert.rejects(() => f.workspace.createInterview(interview), /calendar_meet_pending/);
  assert.equal(f.counts().inserts, 1);
});

test("Calendar changes exclude their own appointment but honor other conflicts", async () => {
  const f = fixture(); await f.workspace.createInterview(interview);
  const changed = { ...interview, start: "2026-10-15T16:00:00Z", end: "2026-10-15T16:30:00Z" };
  assert.equal((await f.workspace.updateInterview(changed)).start, "2026-10-15T16:00:00.000Z");
  await f.workspace.updateInterview(changed); assert.equal(f.counts().patches, 1);
  const blocked = fixture({ conflicts: true }); await blocked.workspace.createInterview(interview);
  await assert.rejects(() => blocked.workspace.updateInterview(changed), /interview_slot_conflict/);
  assert.equal(blocked.counts().patches, 0);
});

test("Calendar cancellation is idempotent and refuses an unrelated event", async () => {
  const f = fixture(); const created = await f.workspace.createInterview(interview);
  await f.workspace.cancelInterview(created.id); await f.workspace.cancelInterview(interview.id);
  assert.equal(f.counts().deletes, 1);
  f.replace({ id: await calendarEventId(interview.id), etag: '"etag-1"', extendedProperties: { private: { aclInterviewId: "another" } } });
  await assert.rejects(() => f.workspace.cancelInterview(interview.id), /calendar_event_identity_mismatch/);
  assert.equal(f.counts().deletes, 1);
});

test("local timestamps, invalid time zones and absent calendar fail before scheduling", async () => {
  const f = fixture();
  await assert.rejects(() => f.workspace.createInterview({ ...interview, start: "2026-10-15T15:00:00" }), /requires_offset/);
  await assert.rejects(() => f.workspace.createInterview({ ...interview, timeZone: "Mars/Base" }), /invalid_interview_time_zone/);
  assert.equal(f.requests.length, 0);
  const disabled = new GoogleWorkspace({ ...config, calendarId: undefined }, async () => assert.fail("must not call Google"));
  await assert.rejects(() => disabled.createInterview(interview), /calendar_not_configured/);
});

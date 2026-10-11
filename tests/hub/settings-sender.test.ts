import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "./fixtures";

test("settings exposes configured recruiting account independently of previous connection", async () => {
  const f = createStore({ expectedRecruitingSender: "sales@aicaseleads.com" });
  try {
    await f.store.setSetting("google_sender", "previous@example.invalid");
    const settings = await f.store.settings();
    assert.equal(settings.google.expectedSender, "sales@aicaseleads.com");
    assert.equal(settings.google.sender, "previous@example.invalid");
  } finally { f.database.close(); }
});

test("settings does not invent a recruiting account when runtime configuration is absent", async () => {
  const f = createStore();
  try { assert.equal((await f.store.settings()).google.expectedSender, ""); }
  finally { f.database.close(); }
});

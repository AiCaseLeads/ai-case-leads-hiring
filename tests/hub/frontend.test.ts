import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { displayDate } from "../../components/hub/api";
import { InterviewBooking } from "../../components/hub/candidate";
import { applicationsCsv } from "../../components/hub/export";
import type { ApplicationSummary } from "../../components/hub/types";

test("staff interview time uses the named booking zone regardless of reviewer zone", () => {
  const prior = process.env.TZ;
  try {
    process.env.TZ = "America/Bogota";
    const shown = displayDate("2026-10-20T15:00:00Z", "America/New_York");
    assert.match(shown, /11:00/);
    assert.doesNotMatch(shown, /10:00/);
  } finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
});

test("failed Calendar request is unconfirmed and still exposes cancellation", () => {
  const html = renderToStaticMarkup(React.createElement(InterviewBooking, { token:"a".repeat(64), data:{kind:"interview",jobTitle:"Synthetic role",status:"failed",interview:{id:"synthetic",status:"failed",start:"2026-10-20T15:00:00Z",timeZone:"UTC"},slots:[],availabilityError:"Calendar availability could not be checked."}, reload:async()=>{} }));
  assert.match(html, /Calendar update needs attention/);
  assert.match(html, /not a confirmed interview/);
  assert.match(html, /Cancel this interview request/);
  assert.doesNotMatch(html, /invitation reflects the confirmed Calendar event/);
  assert.match(html, /Calendar availability could not be checked/);
});

test("confirmed booking preserves Meet and cancel controls while availability is down", () => {
  const html = renderToStaticMarkup(React.createElement(InterviewBooking, { token:"a".repeat(64), data:{kind:"interview",jobTitle:"Synthetic role",status:"booked",interview:{id:"synthetic",status:"booked",start:"2026-10-20T15:00:00Z",timeZone:"UTC",meetUrl:"https://meet.google.com/synthetic"},slots:[],availabilityError:"Availability is down."}, reload:async()=>{} }));
  assert.match(html, /Join Google Meet/);
  assert.match(html, /Cancel this interview/);
  assert.match(html, /Availability is down/);
});

test("CSV export preserves separate qualifications and grades and neutralizes spreadsheet formulas", () => {
  const csv = applicationsCsv([{id:"synthetic",revision:1,name:"=HYPERLINK(\"unsafe\")",email:"test@example.invalid",jobId:"synthetic-role",jobTitle:"Role",stage:"Screening",qualification:"pass",assignee:null,createdAt:0,updatedAt:0,source:"fixture"} satisfies ApplicationSummary]);
  assert.match(csv, /Qualification/); assert.match(csv, /Average reviewer score/); assert.match(csv, /Ungraded/);
  assert.match(csv, /'\=HYPERLINK/);
});

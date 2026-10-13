import { interviewCalendar,personalScheduling,requireActiveInterviewer } from "../personal-calendar/service";
import { jobNotificationStatements } from "../job-team/service";
import { sha256 } from "../hiring/crypto";
import { HiringError } from "../hiring/errors";
import { assertSameOrigin, errorResponse, jsonResponse } from "../hiring/http";
import { boundedBytes } from "../hiring/files";
import { candidateInput, parse } from "./validation";
import type { CandidateHooks } from "./types";
import { HubStore } from "./store";

export type CandidateSlot = { start: string; end: string };
export async function availableSlots(
  store: HubStore,
  hooks: CandidateHooks,
  excludeInterviewId?: string,
  pinnedCalendarId?: string | null,
): Promise<CandidateSlot[]> {
  const personal = await interviewCalendar(store,excludeInterviewId);
  if(personal)await requireActiveInterviewer(store,personal.ownerEmail);
  const policy = personal ? personalScheduling(personal) : await store.scheduling();
  if (!policy.configured || (personal ? !hooks.personalBusy : !hooks.busy) || !store.options.integrations?.google)
    throw new HiringError(
      "scheduling_not_configured",
      503,
      "Interview scheduling is temporarily unavailable. Contact the hiring team.",
    );
  if(personal && pinnedCalendarId && personal.calendarId !== pinnedCalendarId)throw new HiringError("interview_calendar_identity_mismatch",503,"Contact the hiring team to check the interview calendar.");
  const calendarId = personal?.calendarId || pinnedCalendarId || await store.setting("google_calendar_id", "");
  const from = Date.now() + (personal?.availability.minimumNoticeHours??2) * 3600000,
    to = from + (personal?.availability.horizonDays??14) * 86400000;
  let busy: CandidateSlot[];
  try {
    const range={start:new Date(from).toISOString(),end:new Date(to).toISOString(),calendarIds:[calendarId]};
    busy = personal ? await hooks.personalBusy!(personal,range) : await hooks.busy!(range);
  } catch {
    throw new HiringError(
      "calendar_unavailable",
      503,
      "Calendar availability could not be checked. Please try again shortly.",
    );
  }
  const reservations = await store.rows<
    CandidateSlot & { interview_id: string }
  >(
    "SELECT start,end,interview_id FROM hub_reservations WHERE calendar_id=? AND end>? AND start<?",
    calendarId,
    new Date(from).toISOString(),
    new Date(to).toISOString(),
  );
  const ranges = [
    ...busy,
    ...reservations.filter((r) => r.interview_id !== excludeInterviewId),
  ].map((r) => ({ start: Date.parse(r.start), end: Date.parse(r.end) }));
  if (
    ranges.some(
      (r) =>
        !Number.isFinite(r.start) ||
        !Number.isFinite(r.end) ||
        r.end <= r.start,
    )
  )
    throw new HiringError(
      "calendar_unavailable",
      503,
      "Calendar availability could not be verified.",
    );
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: policy.timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const slots: CandidateSlot[] = [];
  const step = 15 * 60000,
    duration = policy.durationMinutes * 60000;
  for (
    let start = Math.ceil(from / step) * step;
    start + duration <= to;
    start += step
  ) {
    const parts = Object.fromEntries(
      formatter.formatToParts(start).map((p) => [p.type, p.value]),
    );
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    if (
      !policy.weekdays.includes(weekdays[parts.weekday]) ||
      minutes < policy.startHour * 60 ||
      minutes + policy.durationMinutes > policy.endHour * 60 ||
      (minutes - policy.startHour * 60) % policy.durationMinutes !== 0
    )
      continue;
    if (ranges.some((r) => start < r.end && start + duration > r.start))
      continue;
    slots.push({
      start: new Date(start).toISOString(),
      end: new Date(start + duration).toISOString(),
    });
  }
  return slots;
}
async function details(token: string, store: HubStore, hooks: CandidateHooks) {
  const hash = await sha256(token),
    link = await store.candidateLink(hash),
    app = await store.applicationRow(link.application_id);
  if (["Rejected", "Withdrawn", "Hired"].includes(app.stage))
    throw new HiringError(
      "link_unavailable",
      404,
      "This invitation is no longer available. Contact the hiring team.",
    );
  const payload = JSON.parse(link.payload_json) as {
    assessmentId?: string;
    interviewId?: string;
  };
  if (link.kind === "assessment") {
    const assessment = await store
      .stmt(
        "SELECT id,status,prompt FROM hub_assessments WHERE id=? AND application_id=?",
        payload.assessmentId || "",
        app.id,
      )
      .first<{ id: string; status: string; prompt: string }>();
    if (
      !assessment ||
      (link.used_at !== null && assessment.status !== "submitted")
    )
      throw new HiringError(
        "link_unavailable",
        404,
        "This invitation is no longer available.",
      );
    return {
      hash,
      link,
      app,
      payload,
      public: {
        kind: "assessment",
        jobTitle: app.job_title,
        status: assessment.status,
        prompt: assessment.prompt,
      },
    };
  }
  if (link.used_at !== null)
    throw new HiringError(
      "link_unavailable",
      404,
      "This invitation is no longer available.",
    );
  const interview = await store
    .stmt(
      "SELECT * FROM hub_interviews WHERE id=? AND application_id=?",
      payload.interviewId || "",
      app.id,
    )
    .first<{
      id: string;
      status: string;
      start: string | null;
      end: string | null;
      time_zone: string | null;
      meet_url: string | null;
      revision: number;
      calendar_id: string | null;
    }>();
  if (!interview)
    throw new HiringError(
      "link_unavailable",
      404,
      "This invitation is no longer available.",
    );
  let slots: CandidateSlot[] = [];
  let availabilityError: string | undefined;
  if (!["pending", "cancel_pending", "cancelled"].includes(interview.status)) {
    try {
      slots = await availableSlots(store, hooks, interview.id, interview.calendar_id);
    } catch (error) {
      // Availability is needed for a new choice, never for viewing or cancelling
      // a booking already recorded by the hiring system.
      if (!interview.start) throw error;
      availabilityError = error instanceof HiringError
        ? error.message
        : "Interview availability is temporarily unavailable. Please try again shortly.";
    }
  }
  return {
    hash,
    link,
    app,
    payload,
    public: {
      kind: "interview",
      jobTitle: app.job_title,
      status: interview.status,
      interview: {
        ...(interview.start ? { start: interview.start } : {}),
        ...(interview.end ? { end: interview.end } : {}),
        ...(interview.time_zone ? { timeZone: interview.time_zone } : {}),
        ...(interview.meet_url ? { meetUrl: interview.meet_url } : {}),
      },
      slots,
      ...(availabilityError ? { availabilityError } : {}),
    },
  };
}
export async function handleCandidateRequest(
  request: Request,
  token: string,
  store: HubStore,
  hooks: CandidateHooks = {},
): Promise<Response> {
  try {
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new HiringError(
        "link_unavailable",
        404,
        "This private link is unavailable.",
      );
    if (request.method === "GET")
      return jsonResponse({
        data: (await details(token, store, hooks)).public,
      });
    if (request.method !== "POST")
      throw new HiringError(
        "method_not_allowed",
        405,
        "This action is not supported.",
      );
    assertSameOrigin(request);
    const bytes = await boundedBytes(request, 128 * 1024);
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new HiringError(
        "invalid_request",
        400,
        "The response could not be read.",
      );
    }
    const input = parse(candidateInput, raw),
      hash = await sha256(token),
      link = await store.candidateLink(hash),
      app = await store.applicationRow(link.application_id),
      payload = JSON.parse(link.payload_json) as {
        assessmentId?: string;
        interviewId?: string;
      };
    if (["Rejected", "Withdrawn", "Hired"].includes(app.stage))
      throw new HiringError(
        "link_unavailable",
        404,
        "This invitation is no longer available.",
      );
    const now = Date.now(),
      event = crypto.randomUUID();
    const mutation = () =>
      store.stmt(
        "UPDATE hub_applications SET id=CASE WHEN revision=? AND stage NOT IN ('Rejected','Withdrawn','Hired') AND EXISTS (SELECT 1 FROM hub_links WHERE token_hash=? AND used_at IS NULL AND expires_at>?) THEN id ELSE NULL END,revision=revision+1,updated_at=? WHERE id=?",
        app.revision,
        hash,
        Date.now(),
        now,
        app.id,
      );
    if (input.action === "assessment") {
      if (link.kind !== "assessment" || !input.answer?.trim())
        throw new HiringError(
          "assessment_required",
          422,
          "Enter your assessment response.",
        );
      const current = await store
        .stmt(
          "SELECT id,status,answer FROM hub_assessments WHERE id=? AND application_id=?",
          payload.assessmentId || "",
          app.id,
        )
        .first<{ id: string; status: string; answer: string | null }>();
      if (!current)
        throw new HiringError(
          "link_unavailable",
          404,
          "This assessment is unavailable.",
        );
      if (current.status === "submitted") {
        if (current.answer !== input.answer)
          throw new HiringError(
            "assessment_already_submitted",
            409,
            "This assessment has already been submitted.",
          );
        return jsonResponse({ data: { status: "submitted" } });
      }
      if (link.used_at !== null)
        throw new HiringError(
          "link_unavailable",
          404,
          "This assessment invitation has been revoked.",
        );
      try {
        await store.db.batch([
          ...await jobNotificationStatements(store,app.job_id,app.id,"assessmentSubmission",current.id,now),
          mutation(),
          store.stmt(
            "UPDATE hub_assessments SET id=CASE WHEN status='invited' AND EXISTS (SELECT 1 FROM hub_links WHERE token_hash=? AND used_at IS NULL AND expires_at>?) THEN id ELSE NULL END,status='submitted',answer=?,submitted_at=? WHERE id=?",
            hash,
            now,
            input.answer,
            now,
            current.id,
          ),
          store.stmt(
            "UPDATE hub_links SET used_at=? WHERE token_hash=? AND used_at IS NULL",
            now,
            hash,
          ),
          store.stmt(
            "INSERT INTO hub_history (id,application_id,type,text,actor,created_at) VALUES (?,?,'assessment','Assessment response submitted','candidate',?)",
            event,
            app.id,
            now,
          ),
          store.taskStatement(
            `drive:${app.id}:revision:${app.revision + 1}`,
            app.id,
            "drive",
            { applicationId: app.id },
            now,
          ),
        ]);
      } catch {
        throw new HiringError(
          "record_changed",
          409,
          "The application changed. Refresh your invitation before retrying.",
        );
      }
      return jsonResponse({ data: { status: "submitted" } });
    }
    if (link.kind !== "interview" || link.used_at !== null)
      throw new HiringError(
        "link_unavailable",
        404,
        "This interview invitation is unavailable.",
      );
    const interview = await store.latestInterview(app.id);
    if (!interview || interview.id !== payload.interviewId)
      throw new HiringError(
        "link_unavailable",
        404,
        "This interview invitation is no longer current.",
      );
    if (["pending", "cancel_pending"].includes(interview.status))
      throw new HiringError(
        "booking_pending",
        409,
        "Your calendar change is being processed. Please check back shortly.",
      );
    const revision = interview.revision + 1;
    if (input.action === "cancel") {
      if (interview.status === "cancelled")
        return jsonResponse({ data: { status: "cancelled" } });
      if (!["booked", "failed"].includes(interview.status))
        throw new HiringError(
          "booking_required",
          422,
          "There is no scheduled interview to cancel.",
        );
      const statements = [
        mutation(),
        store.stmt(
          "UPDATE hub_interviews SET id=CASE WHEN revision=? THEN id ELSE NULL END,status='cancel_pending',revision=revision+1,updated_at=? WHERE id=?",
          interview.revision,
          now,
          interview.id,
        ),
        store.taskStatement(
          `calendar:${interview.id}:revision:${revision}`,
          app.id,
          "calendar",
          {
            operation: "cancel",
            interviewId: interview.id,
            id: interview.id,
            revision,
            calendarId: interview.calendar_id || await store.setting("google_calendar_id", ""),
          },
          now,
        ),
        store.stmt(
          "INSERT INTO hub_history (id,application_id,type,text,actor,created_at) VALUES (?,?,'interview','Interview cancellation requested','candidate',?)",
          event,
          app.id,
          now,
        ),
        store.taskStatement(
          `drive:${app.id}:interview:${revision}`,
          app.id,
          "drive",
          { applicationId: app.id },
          now,
        ),
      ];
      try {
        await store.db.batch(statements);
      } catch {
        throw new HiringError(
          "record_changed",
          409,
          "The application changed. Refresh your invitation before retrying.",
        );
      }
      return jsonResponse({ data: { status: "cancel_pending" } }, 202);
    }
    if (input.action !== "book" && input.action !== "reschedule")
      throw new HiringError(
        "invalid_action",
        422,
        "Choose an interview time or cancel your booking.",
      );
    if (interview.status === "cancelled")
      throw new HiringError(
        "link_unavailable",
        422,
        "Contact the hiring team for a new interview invitation.",
      );
    if (!input.start || !input.timeZone)
      throw new HiringError(
        "booking_required",
        422,
        "Choose an interview time and time zone.",
      );
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timeZone }).format(
        new Date(),
      );
    } catch {
      throw new HiringError(
        "invalid_time_zone",
        422,
        "Choose a valid time zone.",
      );
    }
    if (input.action === "reschedule" && interview.status !== "booked")
      throw new HiringError(
        "booking_required",
        422,
        "Schedule an interview before rescheduling.",
      );
    if (input.action === "book" && interview.status === "booked")
      throw new HiringError(
        "already_booked",
        409,
        "You already have a booking. Use reschedule to change it.",
      );
    const calendarId = interview.calendar_id || await store.setting("google_calendar_id", "");
    const slots = await availableSlots(store, hooks, interview.id, calendarId),
      start = new Date(input.start).toISOString(),
      slot = slots.find((s) => s.start === start);
    if (!slot)
      throw new HiringError(
        "slot_unavailable",
        409,
        "That interview time is no longer available. Choose another time.",
      );
    const reservationKey = `${calendarId}:${start}`;
    const statements = [
      mutation(),
      store.stmt(
        "UPDATE hub_links SET expires_at=MAX(expires_at,?) WHERE token_hash=? AND used_at IS NULL",
        Date.parse(slot.end) + 86400000,
        hash,
      ),
      store.stmt(
        "UPDATE hub_interviews SET id=CASE WHEN revision=? AND EXISTS (SELECT 1 FROM hub_links WHERE token_hash=? AND used_at IS NULL AND expires_at>?) THEN id ELSE NULL END,status='pending',start=?,end=?,time_zone=?,calendar_id=?,reservation_key=?,revision=revision+1,updated_at=? WHERE id=?",
        interview.revision,
        hash,
        now,
        start,
        slot.end,
        input.timeZone,
        calendarId,
        reservationKey,
        now,
        interview.id,
      ),
      store.stmt(
        "DELETE FROM hub_reservations WHERE interview_id=?",
        interview.id,
      ),
      store.stmt(
        "INSERT INTO hub_reservations (key,interview_id,calendar_id,start,end,created_at) SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM hub_reservations WHERE calendar_id=? AND start<? AND end>?) THEN ? ELSE NULL END,?,?,?,?,?",
        calendarId,
        slot.end,
        start,
        reservationKey,
        interview.id,
        calendarId,
        start,
        slot.end,
        now,
      ),
      store.taskStatement(
        `calendar:${interview.id}:revision:${revision}`,
        app.id,
        "calendar",
        {
          operation:
            input.action === "reschedule" || interview.provider_id
              ? "update"
              : "create",
          interviewId: interview.id,
          id: interview.id,
          title: `Interview: ${app.job_title}`,
          email: app.email,
          start,
          end: slot.end,
          timeZone: input.timeZone,
          revision,
          calendarId,
        },
        now,
      ),
      store.stmt(
        "INSERT INTO hub_history (id,application_id,type,text,actor,created_at) VALUES (?,?,'interview',?,'candidate',?)",
        event,
        app.id,
        `Interview ${input.action === "reschedule" ? "rescheduling" : "booking"} requested for ${start}`,
        now,
      ),
      store.taskStatement(
        `drive:${app.id}:interview:${revision}`,
        app.id,
        "drive",
        { applicationId: app.id },
        now,
      ),
    ];
    try {
      await store.db.batch(statements);
    } catch {
      throw new HiringError(
        "slot_unavailable",
        409,
        "That interview time was just reserved. Refresh and choose another time.",
      );
    }
    return jsonResponse(
      {
        data: {
          status: "pending",
          start,
          end: slot.end,
          timeZone: input.timeZone,
        },
      },
      202,
    );
  } catch (error) {
    return errorResponse(error);
  }
}

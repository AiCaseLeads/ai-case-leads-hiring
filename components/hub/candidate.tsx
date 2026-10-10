"use client";
import { useState } from "react";
import {
  CalendarDays,
  ClipboardCheck,
  ExternalLink,
  LockKeyhole,
} from "lucide-react";
import { PageChrome } from "@/components/careers/chrome";
import { displayDate, useHubMutation, useHubResource } from "./api";
import { Badge, EmptyState, Feedback, Field, ResourceState } from "./shared";
import type { CandidateView } from "./types";

export function SecureCandidatePage({
  token,
  kind,
}: {
  token: string;
  kind: "assessment" | "interview";
}) {
  const resource = useHubResource<CandidateView>(
    "/api/candidate/" + encodeURIComponent(token),
  );
  return (
    <PageChrome>
      <main id="main" className="site-width candidate-main">
        <div className="candidate-lock">
          <LockKeyhole size={15} /> Your secure application link
        </div>
        <ResourceState
          loading={resource.loading}
          error={resource.error}
          retry={() => void resource.reload()}
        />
        {!resource.loading &&
          resource.data &&
          (resource.data.kind === kind ? (
            kind === "assessment" ? (
              <AssessmentForm
                token={token}
                data={resource.data}
                reload={resource.reload}
              />
            ) : (
              <InterviewBooking
                token={token}
                data={resource.data}
                reload={resource.reload}
              />
            )
          ) : (
            <EmptyState title="This link belongs to a different step">
              <p>
                Use the assessment or interview link from your recruiting email.
              </p>
            </EmptyState>
          ))}
        <p className="candidate-footnote">
          Keep this link private. Contact your recruiting sender if you need
          help or a replacement link.
        </p>
      </main>
    </PageChrome>
  );
}
function AssessmentForm({
  token,
  data,
}: {
  token: string;
  data: CandidateView;
  reload: () => Promise<void>;
}) {
  const [answer, setAnswer] = useState(""),
    [saved, setSaved] = useState(false),
    mutation = useHubMutation(),
    status = data.assessment?.status || data.status || "pending";
  const submitted =
    saved || ["submitted", "completed", "used"].includes(status);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = await mutation.run(
      "/api/candidate/" + encodeURIComponent(token),
      "POST",
      { action: "assessment", answer },
      "Your assessment response was saved.",
    );
    if (result !== undefined) setSaved(true);
  }
  return (
    <>
      <div className="candidate-heading">
        <ClipboardCheck size={28} />
        <p className="hub-kicker">{data.jobTitle}</p>
        <h1>Your assessment</h1>
        <Badge tone={submitted ? "success" : "neutral"}>
          {submitted ? "Submitted" : status}
        </Badge>
      </div>
      <section className="hub-card">
        <h2>Instructions</h2>
        <p className="hub-preserve">
          {data.assessment?.prompt ||
            data.prompt ||
            "Contact the recruiting team for your assessment instructions."}
        </p>
      </section>
      {submitted ? (
        <div className="hub-notice hub-success" role="status">
          Your response has been received. The recruiting team will review it.
        </div>
      ) : (
        <form className="hub-card" onSubmit={submit}>
          <Field label="Your response">
            <textarea
              rows={12}
              required
              maxLength={50000}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              disabled={mutation.busy}
              placeholder="Write your response. Include portfolio or document links if requested."
            />
          </Field>
          <button
            className="hub-button"
            type="submit"
            disabled={mutation.busy || !answer.trim()}
          >
            {mutation.busy ? "Submitting…" : "Submit assessment"}
          </button>
          <Feedback error={mutation.error} success={mutation.success} />
        </form>
      )}
    </>
  );
}
export function InterviewBooking({
  token,
  data,
  reload,
}: {
  token: string;
  data: CandidateView;
  reload: () => Promise<void>;
}) {
  const [timeZone, setTimeZone] = useState(
      data.interview?.timeZone ||
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        "UTC",
    ),
    [day, setDay] = useState(""),
    [start, setStart] = useState(""),
    [cancelApproved, setCancelApproved] = useState(false),
    mutation = useHubMutation();
  const status = data.interview?.status || data.status || "pending",
    interview = data.interview,
    pending = ["pending", "cancel_pending"].includes(status),
    booked = status === "booked" && !!interview?.start,
    failed = status === "failed",
    hasBooking =
      !!interview?.start && !["cancelled", "canceled"].includes(status);
  let validZone = true;
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
  } catch {
    validZone = false;
  }
  const slots = data.slots || [];
  let zones: string[] = [
    "UTC",
    timeZone,
    "America/Bogota",
    "America/New_York",
    "Europe/London",
    "Asia/Manila",
  ];
  try {
    zones = Array.from(
      new Set(["UTC", timeZone, ...Intl.supportedValuesOf("timeZone")]),
    );
  } catch {
    zones = Array.from(new Set(zones));
  }
  function slotDay(value: string) {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(value));
    } catch {
      return "";
    }
  }
  const days = Array.from(
    new Set(
      slots.map((slot) =>
        slotDay(typeof slot === "string" ? slot : slot.start),
      ),
    ),
  );
  const selectedDay = days.includes(day) ? day : days[0];
  const visibleSlots = slots.filter(
    (slot) =>
      slotDay(typeof slot === "string" ? slot : slot.start) === selectedDay,
  );
  function slotLabel(value: string) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "full",
        timeStyle: "short",
        timeZone,
      }).format(new Date(value));
    } catch {
      return value;
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validZone || !start) return;
    const result = await mutation.run(
      "/api/candidate/" + encodeURIComponent(token),
      "POST",
      { action: booked ? "reschedule" : "book", start, timeZone },
      "Your booking request was saved. Check the current interview status below.",
    );
    if (result !== undefined) {
      setStart("");
      await reload();
    }
  }
  async function cancel() {
    if (!cancelApproved) return;
    const result = await mutation.run(
      "/api/candidate/" + encodeURIComponent(token),
      "POST",
      { action: "cancel" },
      "Your cancellation was recorded.",
    );
    if (result !== undefined) {
      setCancelApproved(false);
      await reload();
    }
  }
  return (
    <>
      <div className="candidate-heading">
        <CalendarDays size={28} />
        <p className="hub-kicker">{data.jobTitle}</p>
        <h1>
          {pending
            ? "Your interview request"
            : booked
              ? "Your interview"
              : "Choose your interview time"}
        </h1>
        <Badge>{status}</Badge>
      </div>
      {hasBooking && (
        <section className="hub-card">
          <h2>{pending ? "Calendar update in progress" : failed ? "Calendar update needs attention" : "Current booking"}</h2>
          <p className="candidate-time">
            {validZone && interview?.start
              ? slotLabel(new Date(interview.start).toISOString())
              : displayDate(interview?.start)}
          </p>
          <p className="hub-muted">
            {validZone ? timeZone : interview?.timeZone}
          </p>
          {booked && interview?.meetUrl && (
            <a
              className="hub-button secondary"
              href={interview.meetUrl}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
            >
              Join Google Meet <ExternalLink size={16} />
            </a>
          )}
          <p className="hub-muted">
            {pending
              ? "Your calendar invitation will be available after the update is confirmed."
              : failed
                ? "This calendar change could not be confirmed. This time is a recorded request, not a confirmed interview. Contact your recruiting sender, choose another time, or cancel the request below."
              : "The recruiting team’s invitation reflects the confirmed Calendar event."}
          </p>
        </section>
      )}
      {pending ? (
        <section className="hub-card">
          <p className="hub-notice" role="status">
            {status === "cancel_pending"
              ? "Your cancellation is being processed. Check the status before making another change."
              : "Your selected time is reserved while the calendar event is being created. It is confirmed when this status changes to booked."}
          </p>
          <button
            className="hub-button secondary"
            onClick={() => void reload()}
          >
            Refresh booking status
          </button>
        </section>
      ) : (
        <form className="hub-card" onSubmit={submit}>
          <h2>{booked ? "Reschedule" : "Available times"}</h2>
          <Field
            label="Your time zone"
            hint="All choices are displayed in this time zone."
          >
            <select
              value={timeZone}
              onChange={(e) => {
                setTimeZone(e.target.value);
                setStart("");
                setDay("");
              }}
              required
              aria-invalid={!validZone}
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </Field>
          {!validZone && (
            <p className="hub-notice hub-error" role="alert">
              Enter a valid time zone, such as America/Bogota or Europe/London.
            </p>
          )}
          {slots.length ? (
            <fieldset
              className="candidate-slots"
              disabled={mutation.busy || !validZone}
            >
              <legend>Select one available interview time</legend>
              <Field label="Interview day">
                <select
                  value={selectedDay}
                  onChange={(e) => {
                    setDay(e.target.value);
                    setStart("");
                  }}
                >
                  {days.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </Field>
              {visibleSlots.map((slot) => {
                const value = typeof slot === "string" ? slot : slot.start;
                return (
                  <label
                    className={
                      "candidate-slot " + (start === value ? "selected" : "")
                    }
                    key={value}
                  >
                    <input
                      type="radio"
                      name="interview-time"
                      value={value}
                      checked={start === value}
                      onChange={() => setStart(value)}
                      required
                    />
                    <span>{slotLabel(value)}</span>
                  </label>
                );
              })}
              <button
                className="hub-button"
                disabled={mutation.busy || !start || !validZone}
                type="submit"
              >
                {mutation.busy
                  ? "Saving booking…"
                  : booked
                    ? "Confirm reschedule"
                    : "Book interview"}
              </button>
            </fieldset>
          ) : (
            <EmptyState title={data.availabilityError ? "Availability temporarily unavailable" : "No available times right now"}>
              <p>
                {data.availabilityError || "Refresh availability or contact your recruiting sender for another time."}
              </p>
              <button
                type="button"
                className="hub-button secondary"
                onClick={() => void reload()}
              >
                Refresh availability
              </button>
            </EmptyState>
          )}
          <Feedback error={mutation.error} success={mutation.success} />
        </form>
      )}
      {(booked || (failed && hasBooking)) && (
        <section className="hub-card">
          <h2>{failed ? "Cancel this interview request" : "Cancel this interview"}</h2>
          <label className="hub-checkbox">
            <input
              type="checkbox"
              checked={cancelApproved}
              onChange={(e) => setCancelApproved(e.target.checked)}
            />{" "}
            I want to cancel the current interview.
          </label>
          <button
            className="hub-button danger"
            disabled={!cancelApproved || mutation.busy}
            onClick={() => void cancel()}
          >
            Cancel interview
          </button>
        </section>
      )}
    </>
  );
}

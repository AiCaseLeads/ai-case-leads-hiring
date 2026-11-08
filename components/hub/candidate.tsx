"use client";
import { useEffect, useMemo, useState } from "react";
import {InterviewCalendar,interviewDayLabel} from "./interview-calendar";
import {
  CalendarDays,
  Check,
  Globe2,
  Video,
  ClipboardCheck,
  ExternalLink,
  LockKeyhole,
} from "lucide-react";
import { PageChrome } from "@/components/careers/chrome";
import { useHubMutation, useHubResource } from "./api";
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
        {kind === "assessment" && <div className="candidate-lock">
          <LockKeyhole size={15} /> Your secure application link
        </div>}
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
function candidateTimeZone(preferred?: string) {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: preferred || local }).resolvedOptions().timeZone;
  } catch {
    return local;
  }
}

function supportedZones(selected: string) {
  const zones = typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : ["America/New_York", "America/Los_Angeles", "America/Bogota", "Europe/London", "Asia/Manila"];
  return [...new Set([selected, "UTC", ...zones])];
}

function TimePicker({ slots, timeZone, changeZone, busy, preview, reschedule, availabilityError, refresh, submit }: {
  slots: NonNullable<CandidateView["slots"]>;
  timeZone: string;
  changeZone: (value: string) => void;
  busy: boolean;
  preview: boolean;
  reschedule: boolean;
  availabilityError?: string;
  refresh: () => void;
  submit: (start: string) => void;
}) {
  const [day, setDay] = useState("");
  const [start, setStart] = useState("");
  const zones = useMemo(() => supportedZones(timeZone), [timeZone]);
  const days = useMemo(() => {
    const dates = new Map<string, string[]>();
    const formatter = new Intl.DateTimeFormat("en-CA", {timeZone, year:"numeric", month:"2-digit", day:"2-digit"});
    for (const slot of slots) {
      const value = typeof slot === "string" ? slot : slot.start;
      const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
      const key = [parts.year, parts.month, parts.day].join("-");
      const existing = dates.get(key);
      if (existing) existing.push(value);
      else dates.set(key, [value]);
    }
    return dates;
  }, [slots, timeZone]);
  const visibleSlots = days.get(day) || [];
  const clock = new Intl.DateTimeFormat("en-US", { timeZone, hour12:true, hour:"numeric", minute:"2-digit" });
  const times = visibleSlots.map(value => clock.format(new Date(value)));
  const canBook = !busy && !preview && visibleSlots.includes(start);
  function selectDay(value: string) {
    setDay(value);
    setStart("");
  }
  if (!slots.length) return <EmptyState title={availabilityError ? "Availability temporarily unavailable" : "No available times right now"}>
    <p>{availabilityError || "Check again later or reply to your interview invitation for help."}</p>
    <button className="hub-button secondary" type="button" onClick={refresh}>Refresh availability</button>
  </EmptyState>;
  return <form className="booking-picker" onSubmit={event => { event.preventDefault(); if (canBook) submit(start); }}>
    <div className="booking-date-column">
      <InterviewCalendar key={timeZone} days={[...days.keys()]} selectedDay={day} onSelect={selectDay}/>
      <label className="booking-zone">
        <Globe2 size={17} aria-hidden="true"/>
        <span>Your time zone<select value={timeZone} onChange={event => { selectDay(""); changeZone(event.target.value); }}>
          {zones.map(zone => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}
        </select></span>
      </label>
    </div>
    <section className="booking-times" aria-label="Available interview times">
      <h2 aria-live="polite">{visibleSlots.length ? interviewDayLabel(day) : "Available times"}</h2>
      {visibleSlots.length ? <>
        <fieldset className="booking-time-grid" aria-label="Interview time" disabled={busy}>
          {visibleSlots.map((value, index) => {
            // A repeated local hour on the autumn clock change needs an offset to distinguish the two slots.
            const clockTime = times[index];
            const ambiguous = times.indexOf(clockTime) !== times.lastIndexOf(clockTime);
            const label = ambiguous ? new Intl.DateTimeFormat("en-US", {timeZone, hour12:true, hour:"numeric", minute:"2-digit", timeZoneName:"shortOffset"}).format(new Date(value)) : clockTime;
            return <label className="booking-time-choice" key={value}>
              <input type="radio" name="interview-time" value={value} checked={start === value} onChange={() => setStart(value)} required/>
              <span>{label}</span>
            </label>;
          })}
        </fieldset>
        <button className="hub-button booking-submit" disabled={!canBook} type="submit">
          {busy ? "Saving…" : reschedule ? "Confirm reschedule" : "Book interview"}
        </button>
      </> : <p>Select a highlighted date to see available times.</p>}
    </section>
  </form>;
}

type BookingChange = { status: string; start?: string; end?: string; timeZone?: string };

export function InterviewBooking({ token, data, reload }: {
  token: string;
  data: CandidateView;
  reload: () => Promise<void>;
}) {
  const [timeZone, setTimeZone] = useState(() => candidateTimeZone(data.interview?.timeZone));
  const [cancelApproved, setCancelApproved] = useState(false);
  const [receipt, setReceipt] = useState<{ snapshot: CandidateView; change: BookingChange } | null>(null);
  const mutation = useHubMutation();
  const localChange = receipt?.snapshot === data ? receipt.change : undefined;
  const interview = data.interview;
  const status = localChange?.status || interview?.status || data.status || "invited";
  const start = localChange?.start || interview?.start;
  const booked = status === "booked" && !!start;
  const past = status === "past";
  const unlinked = status === "unlinked";
  const pending = status === "pending" || status === "cancel_pending";
  const failed = status === "failed";
  const cancelled = status === "cancelled" || status === "canceled";
  const bookingZone = candidateTimeZone(localChange?.timeZone || interview?.timeZone);
  const bookedDate = start ? new Date(start) : null;
  const validDate = bookedDate && Number.isFinite(bookedDate.getTime()) ? bookedDate : null;
  const format = (options: Intl.DateTimeFormatOptions) =>
    validDate && new Intl.DateTimeFormat("en-US", { ...options, timeZone:bookingZone }).format(validDate);

  // Google creates the event asynchronously. Poll sequentially while this tab is visible.
  useEffect(() => {
    if (!pending) return;
    let active = true;
    let delay = 3000;
    let timer: ReturnType<typeof setTimeout>;
    async function update() {
      if (document.visibilityState === "visible") {
        await reload();
        delay = Math.min(30000, delay * 2);
      }
      if (active) timer = setTimeout(update, delay);
    }
    timer = setTimeout(update, delay);
    return () => { active = false; clearTimeout(timer); };
  }, [pending, reload]);

  async function change(action: "book" | "reschedule" | "cancel", newStart?: string) {
    const result = await mutation.run<BookingChange>(
      "/api/candidate/" + encodeURIComponent(token), "POST",
      action === "cancel" ? { action } : { action, start:newStart, timeZone }, "",
    );
    if (result) {
      setReceipt({ snapshot:data, change:result });
      setCancelApproved(false);
      await reload();
    }
  }

  const picker = <TimePicker slots={data.slots || []} timeZone={timeZone} changeZone={setTimeZone}
    busy={mutation.busy} preview={status === "preview"} reschedule={booked}
    availabilityError={data.availabilityError} refresh={() => void reload()}
    submit={value => void change(booked ? "reschedule" : "book", value)}/>;
  const title = past ? "Your interview time has passed" : unlinked ? "Check your booking with the hiring team"
    : booked ? "Your interview is confirmed" : status === "cancel_pending" ? "Cancelling your interview"
    : pending ? "Confirming your interview" : cancelled ? "Interview cancelled"
    : failed ? "Calendar update needs attention" : "Choose your interview time";
  return <article className="booking-card">
    <header className="booking-heading">
      <span className={'booking-mark' + (booked ? ' confirmed' : '')} aria-hidden="true">
        {booked ? <Check size={23}/> : <CalendarDays size={23}/>}
      </span>
      <div><h1 aria-live="polite">{title}</h1><p>{data.jobTitle}</p></div>
    </header>
    {status === "preview" && <p className="booking-message">Booking opens when your recruiter sends the invitation.</p>}
    {(booked || pending || failed || past) && validDate && <section className="booking-details" aria-label="Interview details">
      <div><CalendarDays size={19} aria-hidden="true"/><div>
        <strong>{format({weekday:"long", month:"long", day:"numeric", year:"numeric"})}</strong>
        <span>{format({hour:"numeric", minute:"2-digit", hour12:true, timeZoneName:"long"})}</span>
      </div></div>
      {booked && interview?.meetUrl && <div><Video size={19} aria-hidden="true"/>
        <a href={interview.meetUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
          Join Google Meet <ExternalLink size={14} aria-hidden="true"/>
        </a></div>}
    </section>}
    {booked && <div className="booking-prep"><h2>Before your interview</h2>
      <p>Please join on time from a quiet place. Check your camera and microphone, and come ready to discuss your experience and the role.</p>
    </div>}
    {past && <p className="booking-message">Reply to your invitation if you have questions about next steps.</p>}
    {unlinked && <p className="booking-message">We couldn’t verify this interview on the calendar. Reply to your invitation so the hiring team can check the time or send you a new link.</p>}
    {pending && <div className="booking-message" role="status">
      <p>{status === "cancel_pending" ? "We’re updating the calendar. This page will show when your cancellation is confirmed." : "We’re reserving your time on the calendar. Your confirmation will appear here automatically."}</p>
      <button type="button" className="hub-text-button" onClick={() => void reload()}>Refresh booking status</button>
    </div>}
    {failed && <p className="booking-message">Your requested time is not a confirmed interview. Choose another time or reply to your invitation for help.</p>}
    {cancelled && <p className="booking-message">Reply to your recruiting email if you would like a new invitation.</p>}
    {booked ? <details className="booking-change"><summary>Reschedule interview</summary>{picker}</details> :
      !pending && !cancelled && !past && !unlinked && picker}
    {(booked || (failed && !!start)) && <details className="booking-change">
      <summary>{failed ? "Cancel this interview request" : "Cancel this interview"}</summary>
      <label className="hub-checkbox"><input type="checkbox" checked={cancelApproved} onChange={event => setCancelApproved(event.target.checked)}/>
        I want to cancel the current interview.</label>
      <button type="button" className="hub-button danger" disabled={!cancelApproved || mutation.busy} onClick={() => void change("cancel")}>Cancel interview</button>
    </details>}
    <Feedback error={mutation.error} success=""/>
  </article>;
}

"use client";
import { useEffect, useRef, useState } from "react";
import type { Payload } from "./form";

type Journal = { key: string; jobTitle?: string; jobSlug?: string; payload?: Payload; receipt?: string };

/** Only replays an existing frozen browser journal. It never creates a key or uploads a file. */
export function SubmissionRecovery({ slug }: { slug: string }) {
  const [journals, setJournals] = useState<Journal[]>([]),
    [message, setMessage] = useState(""),
    [busyKey, setBusyKey] = useState<string | null>(null);
  const active = useRef(false);
  useEffect(() => {
    const found: Journal[] = [];
    let unreadable = false;
    try {
      for (let index = 0; index < sessionStorage.length; index++) {
        const key = sessionStorage.key(index);
        if (!key?.startsWith("aicl:submission:")) continue;
        try {
          const value = JSON.parse(sessionStorage.getItem(key) || "{}") as Journal;
          const jobSlug = typeof value.jobSlug === "string" ? value.jobSlug : undefined,
            jobTitle = typeof value.jobTitle === "string" ? value.jobTitle : undefined;
          if (jobSlug && jobSlug !== slug) continue;
          if (typeof value.receipt === "string" && value.receipt) found.push({ ...value, key, jobSlug, jobTitle });
          else if (value.payload && typeof value.payload.jobPostingId === "string" &&
                   typeof value.payload.submissionKey === "string" &&
                   Array.isArray(value.payload.fieldSubmissions)) found.push({ ...value, key, jobSlug, jobTitle });
          else unreadable = true;
        } catch { unreadable = true; }
      }
    } catch { unreadable = true; }
    queueMicrotask(() => {
      setJournals(found);
      if (unreadable) setMessage("Your browser could not read some saved submission status. Contact the hiring team before applying again.");
    });
  }, [slug]);
  async function recover(journal: Journal) {
    if (active.current) return;
    if (journal.receipt) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/applications/${encodeURIComponent(journal.receipt)}`);
      return;
    }
    if (!journal.payload) return;
    active.current = true; setBusyKey(journal.key); setMessage("");
    try {
      const response = await fetch("/api/applications", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(journal.payload),
      });
      const body = await response.json() as { status?: string; receipt?: string };
      if (response.ok && body.status === "accepted" && typeof body.receipt === "string" && body.receipt) {
        try {
          sessionStorage.setItem(journal.key, JSON.stringify({ receipt: body.receipt, jobTitle: journal.jobTitle, jobSlug: journal.jobSlug }));
        } catch { /* Keep the known server receipt usable even if this browser can no longer write its journal. */ }
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(`/applications/${encodeURIComponent(body.receipt)}`);
        return;
      }
      setMessage("We could not confirm this earlier application yet. Its saved answers remain in this browser. Try checking again or contact the hiring team; do not start a duplicate application.");
    } catch {
      setMessage("We could not reach the hiring system or confirm its response. Your earlier submission is still saved here. Try checking again before applying elsewhere on this site.");
    } finally { active.current = false; setBusyKey(null); }
  }
  if (!journals.length && !message) return null;
  return <section className="application-form" aria-labelledby="submission-recovery-title">
    <h2 id="submission-recovery-title">Check an earlier submission</h2>
    <p>This role could not be loaded. If you submitted before it closed or became unavailable, you can check the original request below. This does not start a new application.</p>
    {journals.map((journal, index) => <div key={journal.key}>
      <p><strong>{journal.jobTitle || `Earlier application ${index + 1}`}</strong>{!journal.jobSlug && " · legacy browser record; its role could not be matched to this page."}</p>
      <button type="button" className="button ink" disabled={busyKey !== null} onClick={() => void recover(journal)}>{busyKey === journal.key ? "Checking submission…" : journal.receipt ? "View saved confirmation" : "Check earlier application status"}</button>
    </div>)}
    {message && <p role="alert">{message}</p>}
    <p>Still need help? <a href="mailto:no-reply@aicaseleads.com?subject=Application%20support">Email the recruiting team</a>. This address is monitored. Include the job title and the email address you used to apply.</p>
  </section>;
}

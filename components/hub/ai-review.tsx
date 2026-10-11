"use client";
import { useState } from "react";
import { Badge, Feedback, Field, ResourceState } from "./shared";
import { useHubMutation, useHubResource } from "./api";
import type { ApplicationDetail } from "./types";

type AiConfig = { configured: boolean; enabled: boolean; model: string; provider: string; reviewOnly: boolean };

export function AiReviewSettings() {
  const config = useHubResource<AiConfig>("/api/ai/config");
  const mutation = useHubMutation();
  const [apiKey, setApiKey] = useState("");
  const [enable, setEnable] = useState<boolean | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const result = await mutation.run("/api/ai/config", "PATCH", {
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      enabled: enable ?? config.data?.enabled ?? false,
    }, "AI review settings saved. Candidate data is sent only when a reviewer requests a review.");
    if (result !== undefined) { setApiKey(""); setEnable(null); await config.reload(); }
  }
  return <section className="hub-card" id="ai-review-setup">
    <h3>Optional AI evidence review</h3>
    <p>OpenRouter connects this app to OpenAI GPT-5 Mini. Manager grades continue to determine the sorted shortlist. AI helps you check the evidence; it does not assign grades or reject applicants.</p>
    <ResourceState loading={config.loading} error={config.error} retry={() => void config.reload()} />
    {config.data && <form onSubmit={save}>
      <Badge tone={config.data.enabled && config.data.configured ? "success" : "neutral"}>{config.data.enabled && config.data.configured ? "Enabled for manual reviews" : "AI review off"}</Badge>
      <p className="hub-muted">Model: {config.data.model}. {config.data.configured ? "A key is saved securely. Leave the field empty to keep it." : "No API key is saved yet."} Usage is billed to your OpenRouter account separately.</p>
      <Field label={config.data.configured ? "Replace OpenRouter API key (optional)" : "OpenRouter API key"} hint="Paste the key here, not in chat. It is encrypted on the server and never displayed again.">
        <input type="password" autoComplete="new-password" value={apiKey} maxLength={500} onChange={e => setApiKey(e.target.value)} />
      </Field>
      <label className="hub-checkbox"><input type="checkbox" checked={enable ?? config.data.enabled} onChange={e => setEnable(e.target.checked)} /> Enable reviewer-requested AI evidence reviews</label>
      <p className="hub-muted">Each review requires confirmation before sharing the selected application answers and pasted résumé/profile excerpts with OpenRouter and OpenAI. Uploaded PDFs are not automatically read. Set a spending limit on the OpenRouter key.</p>
      <button className="hub-button secondary" disabled={mutation.busy || (!(config.data.configured || apiKey.trim()) && (enable ?? config.data.enabled))}>{mutation.busy ? "Saving…" : "Save AI connection"}</button>
      <Feedback error={mutation.error} success={mutation.success} />
    </form>}
  </section>;
}

const verificationChecks = [
  "Résumé and profile dates or roles compared",
  "Portfolio contribution explained by candidate",
  "Job-related work sample discussed live",
  "Reference checked with candidate permission",
];

export function useEvidenceDraft() {
  const [resumeText, setResumeText] = useState("");
  const [linkedinText, setLinkedinText] = useState("");
  const [jobCriteria, setJobCriteria] = useState("");
  const [verification, setVerification] = useState(verificationChecks.map(() => "Not checked"));
  const [notes, setNotes] = useState("");
  const [consent, setConsent] = useState(false);
  return { resumeText, setResumeText, linkedinText, setLinkedinText, jobCriteria, setJobCriteria, verification, setVerification, notes, setNotes, consent, setConsent };
}
export function CandidateEvidence({ detail, saved, draft }: { detail: ApplicationDetail; saved: () => void; draft?: ReturnType<typeof useEvidenceDraft> }) {
  const config = useHubResource<AiConfig>("/api/ai/config");
  const mutation = useHubMutation();
  const localDraft = useEvidenceDraft();
  const { resumeText, setResumeText, linkedinText, setLinkedinText, jobCriteria, setJobCriteria, verification, setVerification, notes, setNotes, consent, setConsent } = draft || localDraft;
  const ready = config.data?.configured && config.data.enabled;
  const criteriaLines = jobCriteria.split("\n").map(v => v.trim()).filter(Boolean);
  const criteriaValid = criteriaLines.length > 0 && criteriaLines.length <= 8 && criteriaLines.every(v => v.length <= 500);
  async function saveVerification() {
    const result = await mutation.run("/api/hub/applications/" + encodeURIComponent(detail.id) + "/action", "POST", {
      action: "note", expectedRevision: detail.revision,
      text: "VERIFICATION REVIEW — human recorded; no automatic decision\n" + verificationChecks.map((label, i) => label + ": " + verification[i]).join("\n") + "\nEvidence, source links and candidate clarification:\n" + notes,
    }, "Verification notes saved in this applicant’s history and queued for Drive archival.");
    if (result !== undefined) { setNotes(""); saved(); }
  }
  async function review() {
    const result = await mutation.run("/api/ai/review", "POST", {
      applicationId: detail.id, expectedRevision: detail.revision, resumeText, linkedinText, jobCriteria, consent,
    }, "AI evidence review saved in applicant notes. Check its citations before recording your manager grade.");
    if (result !== undefined) { setConsent(false); saved(); }
  }
  return <section className="hub-card" aria-label="Evidence and verification">
    <h3>Evidence & verification</h3>
    <p>Compare what the candidate says with work they can explain. A tailored résumé or AI-assisted writing does not establish dishonesty. Missing information means “ask the candidate,” not “fraud.”</p>
    <details>
      <summary>Record verification checks</summary>
      <p className="hub-muted">Record the source and the candidate’s explanation. A difference between sources needs clarification; a LinkedIn profile is also a self-reported source.</p>
      {verificationChecks.map((label, i) => <Field label={label} key={label}><select value={verification[i]} onChange={e => setVerification(v => v.map((old, index) => index === i ? e.target.value : old))} disabled={mutation.busy}>
        <option>Not checked</option><option>Checked — evidence recorded below</option><option>Needs candidate clarification</option><option>Not applicable</option>
      </select></Field>)}
      <Field label="Evidence and follow-up notes" hint="Include source links, dates, the specific inconsistency or work-sample result, and the candidate’s explanation. Avoid unrelated personal information."><textarea rows={4} value={notes} maxLength={6000} onChange={e => setNotes(e.target.value)} disabled={mutation.busy} /></Field>
      <button className="hub-button secondary" onClick={() => void saveVerification()} disabled={mutation.busy || !notes.trim()}>Save verification notes</button>
    </details>
    <details>
      <summary>Compare résumé, profile and application with AI</summary>
      <ResourceState loading={config.loading} error={config.error} retry={() => void config.reload()} />
      {!config.loading && config.data && !ready && <p className="hub-notice">AI review is off. An administrator can connect OpenRouter under Team & settings → Optional AI evidence review. You can still review files and record manager scores.</p>}
      <p className="hub-muted">This reads the application answers and the text you paste below. It does not scrape LinkedIn or extract text from uploaded PDFs. Open the original files above, then paste the relevant résumé text and candidate-supplied LinkedIn About/Experience text. Leave profile text empty if unavailable.</p>
      <Field label="Résumé excerpts" hint="Only job-related experience and skills; omit contact details and unrelated personal data."><textarea rows={6} maxLength={30000} value={resumeText} onChange={e => setResumeText(e.target.value)} disabled={mutation.busy} /></Field>
      <Field label="Candidate-supplied LinkedIn / experience excerpts (optional)"><textarea rows={5} maxLength={20000} value={linkedinText} onChange={e => setLinkedinText(e.target.value)} disabled={mutation.busy} /></Field>
      <Field label="Job requirements to check" hint="One specific, job-related requirement per line. Maximum 8 requirements, 500 characters each. Use the same requirements for applicants to this job."><textarea rows={5} maxLength={4007} value={jobCriteria} onChange={e => setJobCriteria(e.target.value)} disabled={mutation.busy} /></Field>
      <label className="hub-checkbox"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={mutation.busy} /> Share these excerpts and application answers with OpenRouter and OpenAI for this review.</label>
      <p className="hub-muted">The review cites supplied text and suggests follow-up questions. It does not verify employment, detect AI authorship, or determine a hiring outcome. Results are saved as notes and archived to Drive.</p>
      <button className="hub-button" onClick={() => void review()} disabled={!ready || mutation.busy || !consent || !criteriaValid}>{mutation.busy ? "Reviewing…" : "Generate evidence review"}</button>
    </details>
    <Feedback error={mutation.error} success={mutation.success} />
  </section>;
}

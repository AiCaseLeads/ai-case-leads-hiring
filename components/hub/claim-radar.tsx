import type { AiMatchDetail } from "../../lib/ai/matchtypes";
import { summarizeClaim } from "../../lib/hub/claim-summary";
import type { ApplicationDetail } from "./types";

function relatedClaimSummaries(detail: ApplicationDetail): string[] {
  const topics = new Map<string, { current: number; others: Set<number> }>();
  for (const application of detail.relatedApplications ?? []) {
    for (const { question, current, other } of application.differences) {
      const topic = topics.get(question) ?? { current, others: new Set<number>() };
      topic.others.add(other);
      topics.set(question, topic);
    }
  }
  return Array.from(topics, ([question, { current, others }]) => {
    const values = Array.from(others).sort((a, b) => a - b);
    const label = question.charAt(0).toUpperCase() + question.slice(1);
    const history = new Intl.ListFormat("en-US").format(values.map(String));
    return `For “${label}”, this application lists ${current} ${current === 1 ? "year" : "years"}. Linked applications list ${history}.`;
  });
}

function SummaryLines({ lines }: { lines: string[] }) {
  return lines.length === 1 ? <p>{lines[0]}</p> : <ul>{lines.map(line => <li key={line}>{line}</li>)}</ul>;
}

export function ClaimRadar({ detail }: { detail: ApplicationDetail }) {
  const match = detail.aiMatch as AiMatchDetail | undefined;
  const ready = match?.status === "ready";
  const findings = ready ? (match.criteria ?? []).filter(item =>
    item.status === "needs_verification" && new Set(item.citations?.map(citation => citation.source)).size >= 2
  ) : [];
  const history = relatedClaimSummaries(detail);
  const summaries = [...new Set([...findings.map(item => summarizeClaim(item, detail.name)), ...history])];
  const priority = findings.length && history.length ? "High" : "Medium";
  const pending = match && ["pending", "preparing", "running"].includes(match.status);
  const status = ready ? "No discrepancies flagged." : pending ? "Source comparison pending." : "No completed source comparison.";
  return <section key={detail.id} className="hub-claim-review" aria-label="Claim review">
    <div className="hub-claim-review-heading">
      <strong>Claim review</strong>
      {summaries.length > 0 ? <span>{priority} priority</span> : <span>{status}</span>}
    </div>
    {summaries.length > 0 && <SummaryLines lines={summaries.slice(0, 2)}/>}
    {summaries.length > 2 && <details><summary>Show {summaries.length - 2} more</summary>
      <SummaryLines lines={summaries.slice(2)}/>
    </details>}
  </section>;
}

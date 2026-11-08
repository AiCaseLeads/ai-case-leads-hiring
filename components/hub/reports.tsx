"use client";
import { ResponseCheckReport } from "./response-checks";
import { useState } from "react";
import { useHubResource } from "./api";
import { EmptyState, ResourceState } from "./shared";
import { stageLabel, type Report } from "./types";

export const reportSections = ["overview","sources","team","response-checks"] as const;
export type ReportSection = typeof reportSections[number];
export function Reports({refresh, initialSection, onSection, isOwner=false}:{
  refresh:number; initialSection?:ReportSection; onSection?:(section:ReportSection)=>void; isOwner?:boolean;
}) {
  const resource = useHubResource<Report>("/api/hub/reports", refresh), report = resource.data;
  const [localSection, setSection] = useState<ReportSection>("overview");
  const section=initialSection ?? localSection;
  const [checkRefresh, setCheckRefresh] = useState(0);
  return <section aria-labelledby="reports-title">
    <div className="hub-section-heading"><div><p className="hub-kicker">HIRING PERFORMANCE</p><h2 id="reports-title">Reports</h2><p>All recorded applications, with screening results and recruiter actions.</p></div><button className="hub-button secondary" type="button" onClick={() => section==="response-checks" ? setCheckRefresh(n=>n+1) : void resource.reload()} disabled={section!=="response-checks" && resource.loading}>Refresh reports</button></div>
    <nav className="hub-page-tabs" aria-label="Report sections">{[{id:"overview" as const,label:"Overview"},{id:"sources" as const,label:"Sources"},{id:"team" as const,label:"Team"},{id:"response-checks" as const,label:"Response checks"}].map(item => <button type="button" key={item.id} className={"hub-text-button " + (section === item.id ? "active" : "")} aria-current={section === item.id ? "page" : undefined} onClick={() => (onSection ?? setSection)(item.id)}>{item.label}</button>)}</nav>
    {section==="response-checks" ? <ResponseCheckReport refresh={refresh+checkRefresh} isOwner={isOwner}/> : <ResourceState loading={resource.loading} error={resource.error} retry={() => void resource.reload()} /> }
    {report && !resource.loading && section!=="response-checks" && <>
      {report.applications === 0 && <EmptyState title="No applications yet"><p>Applications and recruiter actions populate these reports automatically.</p></EmptyState>}
      {section === "overview" && <>
        <div className="hub-metric-grid hub-report-summary">
          <Metric label="Applications received" value={report.applications.toLocaleString()} description="All accepted submissions, including rejected and withdrawn applicants." />
          <Metric label="Passed screening" value={report.applications ? formatRate(report.qualificationRate) : "—"} description="Passed saved screening rules. This does not mean a recruiter has reviewed the applicant." />
          <Metric label="Interview attendance" value={report.attendance.total ? `${report.attendance.attended} / ${report.attendance.total}` : "—"} description="Recorded attendance out of interviews with an attendance result." />
          <Metric label="Hired" value={String(report.stageCounts.find(row => row.stage === "Hired")?.count ?? 0)} description="Applications currently marked Hired by the team." />
        </div>
        <div className="hub-report-grid">
          <CountReport title="Current pipeline" description="Where applicants are now." headers={["Stage","Applicants"]} rows={report.stageCounts.map(row => [stageLabel(row.stage),row.count])} />
          <CountReport title="Stage progression" description="Applicants who reached each stage. An applicant may appear in more than one stage." headers={["Reached stage","Applicants","Share of all applications"]} rows={report.conversion.map(row => [stageLabel(row.stage),row.count,report.applications ? ((row.count / report.applications) * 100).toFixed(1) + "%" : "—"])} />
        </div>
      </>}
      {section === "sources" && <CountReport title="Application sources" description="Compare where applicants came from. Passed screening counts saved rule outcomes; interviewed counts applicants with confirmed attendance, and hired counts applicants currently in Hired." headers={["Source","Applications","Passed screening","Interviewed","Hired","Screening pass rate"]} rows={report.sources.map(row => [row.source || "Direct / untracked",row.count,row.qualified ?? "—",row.interviewed ?? "—",row.hired ?? "—",sourceQualificationRate(row)])} />}
      {section === "team" && <div className="hub-report-grid">
        <CountReport title="Assigned applicants" description="Current applications assigned to each recruiter. Unassigned applicants have no individual owner." headers={["Recruiter","Applicants"]} rows={report.workload.map(row => [row.assignee || "Unassigned",row.count])} />
        <CountReport title="Time in stage" description="Average recorded time in each stage, in hours." headers={["Stage","Average hours"]} rows={report.timeInStage.map(row => [stageLabel(row.stage),Number(row.averageHours).toFixed(1)])} />
      </div>}
    </>}
  </section>;
}
function formatRate(rate:number):string {
  return Number.isFinite(rate) ? `${(rate <= 1 ? rate * 100 : rate).toFixed(1)}%` : "—";
}
function sourceQualificationRate(row:Report["sources"][number]):string {
  if (!row.count) return "—";
  const rate = row.qualificationRate ?? (row.qualified === undefined ? undefined : row.qualified / row.count);
  if (rate === undefined || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}
export function Metric({ label, value, description }: { label:string; value:string; description?:string }) {
  return <article className="hub-metric"><span>{label}</span><strong>{value}</strong>{description && <p className="hub-metric-description">{description}</p>}</article>;
}
function CountReport({ title, description, headers, rows }: { title:string; description?:string; headers:string[]; rows:(string | number)[][] }) {
  return <section className="hub-card hub-report-panel"><h3>{title}</h3>{description && <p className="hub-muted">{description}</p>}{rows.length ? <div className="hub-table-wrap"><table className="hub-table"><thead><tr>{headers.map(header => <th scope="col" key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row,index) => <tr key={index}>{row.map((value,cell) => <td key={cell}>{value}</td>)}</tr>)}</tbody></table></div> : <p className="hub-muted">No recorded data yet.</p>}</section>;
}

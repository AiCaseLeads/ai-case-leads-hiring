"use client";
import { useHubResource } from "./api";
import { EmptyState, ResourceState } from "./shared";
import type { Report } from "./types";
export function Reports({ refresh }: { refresh: number }) {
  const resource = useHubResource<Report>("/api/hub/reports", refresh),
    report = resource.data;
  return (
    <section aria-labelledby="reports-title">
      <div className="hub-section-heading">
        <div>
          <p className="hub-kicker">HIRING PERFORMANCE</p>
          <h2 id="reports-title">Reports</h2>
          <p>
            All recorded applications. Metrics update from accepted applications
            and recruiter actions.
          </p>
        </div>
        <button
          className="hub-button secondary"
          onClick={() => void resource.reload()}
          disabled={resource.loading}
        >
          Refresh reports
        </button>
      </div>
      <ResourceState
        loading={resource.loading}
        error={resource.error}
        retry={() => void resource.reload()}
      />
      {report && !resource.loading && (
        <>
          <div className="hub-metric-grid">
            <Metric
              label="Applications"
              value={report.applications.toLocaleString()}
            />
            <Metric
              label="Qualification rate"
              value={
                report.applications
                  ? (report.qualificationRate <= 1
                      ? report.qualificationRate * 100
                      : report.qualificationRate
                    ).toFixed(1) + "%"
                  : "—"
              }
            />
            <Metric
              label="Interview attendance"
              value={
                report.attendance.total
                  ? report.attendance.attended + " / " + report.attendance.total
                  : "—"
              }
            />
            <Metric
              label="Attendance rate"
              value={
                report.attendance.total
                  ? Math.round(
                      (report.attendance.attended / report.attendance.total) *
                        100,
                    ) + "%"
                  : "—"
              }
            />
          </div>
          {report.applications === 0 && (
            <EmptyState title="Reports are ready for real data">
              <p>
                After applications arrive, this view shows qualification, stage
                conversion, source quality, time in stage, and reviewer
                workload.
              </p>
            </EmptyState>
          )}
          <div className="hub-report-grid">
            <CountReport
              title="Stage conversion"
              headers={["Stage", "Applications", "Share of applications"]}
              rows={report.conversion.map((row) => [
                row.stage,
                row.count,
                report.applications
                  ? ((row.count / report.applications) * 100).toFixed(1) + "%"
                  : "—",
              ])}
            />
            <CountReport
              title="Current hiring stages"
              headers={["Stage", "Applications"]}
              rows={report.stageCounts.map((row) => [row.stage, row.count])}
            />
            <CountReport
              title="Application sources"
              description="Qualified: passed approved requirements. Interviewed: reached the Interview stage. Hired: currently in Hired. Rates use applications from the same source."
              headers={[
                "Source",
                "Applications",
                "Qualified",
                "Interviewed",
                "Hired",
                "Qualification rate",
              ]}
              rows={report.sources.map((row) => [
                row.source || "Direct / untracked",
                row.count,
                row.qualified ?? "—",
                row.interviewed ?? "—",
                row.hired ?? "—",
                sourceQualificationRate(row),
              ])}
            />
            <CountReport
              title="Time in stage"
              headers={["Stage", "Average hours"]}
              rows={report.timeInStage.map((row) => [
                row.stage,
                Number(row.averageHours).toFixed(1),
              ])}
            />
            <CountReport
              title="Reviewer workload"
              headers={["Reviewer", "Applications"]}
              rows={report.workload.map((row) => [
                row.assignee || "Unassigned",
                row.count,
              ])}
            />
          </div>
        </>
      )}
    </section>
  );
}
function sourceQualificationRate(row: Report["sources"][number]): string {
  if (!row.count) return "—";
  const rate =
    row.qualificationRate ??
    (row.qualified === undefined ? undefined : row.qualified / row.count);
  if (rate === undefined || !Number.isFinite(rate)) return "—";
  const counts =
    row.qualified === undefined ? "" : ` (${row.qualified} / ${row.count})`;
  return `${(rate * 100).toFixed(1)}%${counts}`;
}
export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="hub-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
function CountReport({
  title,
  description,
  headers,
  rows,
}: {
  title: string;
  description?: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <section className="hub-card">
      <h3>{title}</h3>
      {description && <p className="hub-muted">{description}</p>}
      {rows.length ? (
        <div className="hub-table-wrap">
          <table className="hub-table">
            <thead>
              <tr>
                {headers.map((header) => (
                  <th scope="col" key={header}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {row.map((value, cell) => (
                    <td key={cell}>{value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="hub-muted">No recorded data yet.</p>
      )}
    </section>
  );
}

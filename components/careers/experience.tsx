"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Code2,
  Palette,
  MapPin,
  Globe2,
  Search,
  FileText,
  MessageSquare,
  Check,
  ChevronRight,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageChrome } from "./chrome";
import type { CareerJob, JobsResponse, JobResponse } from "./types";
import { ApplicationForm } from "./form";
import { SubmissionRecovery } from "./recovery";
import { captureAttribution } from "./attribution";

function useResource<T>(url: string) {
  const [data, setData] = useState<T | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(url, { cache: "no-store" });
      const body = (await response.json()) as T & { message?: unknown };
      if (!response.ok)
        throw new Error(
          typeof body?.message === "string"
            ? body.message
            : "We couldn’t load this page. Please try again.",
        );
      setData(body);
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? "We couldn’t load this page. Please try again."
          : e instanceof Error
            ? e.message
            : "Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [url]);
  // Fetching synchronizes the page with a remote resource; reload shares the same path.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void load();
  }, [load]);
  /* eslint-enable react-hooks/set-state-in-effect */
  return { data, loading, error, reload: load };
}
export function CareersHome() {
  useEffect(() => {
    captureAttribution();
  }, []);
  const { data, loading, error, reload } =
    useResource<JobsResponse>("/api/jobs");
  const [department, setDepartment] = useState("all"),
    [query, setQuery] = useState("");
  const jobs = data?.jobs || [];
  const filtered = jobs.filter(
    (job) =>
      (department === "all" || job.department === department) &&
      `${job.title} ${job.department}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const departments = Array.from(
    new Set(jobs.map((job) => job.department).filter(Boolean)),
  );
  const enabled = !!data?.submissionEnabled;
  return (
    <PageChrome>
      <main id="main">
        {data?.mode === "preview" && (
          <div className="preview-banner">
            <div className="site-width">
              <span>Website preview · Explore the roles and forms.</span>
              <a href="/team">
                View hiring setup <ChevronRight size={14} aria-hidden="true" />
              </a>
            </div>
          </div>
        )}
        <section className="hero">
          <div className="site-width hero-grid">
            <div className="hero-copy">
              <p className="eyebrow">
                <span className="eyebrow-rule" /> BUILD YOUR NEXT CHAPTER
              </p>
              <h1>
                Good work starts
                <br />
                with the <em>right people.</em>
              </h1>
              <p className="hero-description">
                Bring your ideas, your craft, and your perspective.
                <br className="desktop-break" /> Find your place at AI Case
                Leads.
              </p>
              <a className="button mint" href="#positions">
                Explore opportunities
              </a>
            </div>
            <div className="hero-aside">
              <span className="hero-index">01 — CAREERS AT AI CASE LEADS</span>
              <div className="hero-note">
                <Globe2 size={26} strokeWidth={1.3} />
                <h2>
                  Different perspectives.
                  <br />
                  Shared ambition.
                </h2>
                <p>
                  We’re welcoming international applicants for our next
                  engineering and creative roles.
                </p>
              </div>
              <div className="hero-aside-footer">
                <span>ENGINEERING</span>
                <span>CREATIVE</span>
              </div>
            </div>
          </div>
        </section>
        <section
          className="positions site-width"
          id="positions"
          aria-labelledby="positions-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow dark">FIND YOUR NEXT OPPORTUNITY</p>
              <h2 id="positions-title">A place for your best work.</h2>
            </div>
            <span className="count-label">
              {loading
                ? "Loading roles…"
                : `${jobs.length} ${jobs.length === 1 ? "role" : "roles"}`}
            </span>
          </div>
          <div className="filter-bar">
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger
                className="filter-select"
                aria-label="Filter by department"
              >
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="job-search">
              <Search size={18} aria-hidden="true" />
              <span className="sr-only">Search opportunities</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search opportunities"
                type="search"
              />
            </label>
          </div>
          {!loading && data && !enabled && (
            <p className="intake-note">
              <AlertCircle size={17} aria-hidden="true" />
              {data.mode === "preview"
                ? "Website preview: click either role to explore its application form. Applications remain closed while the roles and hiring integrations are configured."
                : "Applications are currently paused. You can explore the roles below."}
            </p>
          )}
          {error ? (
            <div className="resource-error" role="alert">
              <AlertCircle />
              <p>{error}</p>
              <button className="button outline" onClick={() => void reload()}>
                <RefreshCw size={16} />
                Try again
              </button>
            </div>
          ) : (
            <div className="job-list" aria-busy={loading}>
              {loading ? (
                <>
                  <Skeleton className="job-skeleton" />
                  <Skeleton className="job-skeleton" />
                </>
              ) : (
                filtered.map((job, index) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    index={index}
                    enabled={enabled}
                  />
                ))
              )}
              {!loading && filtered.length === 0 && (
                <div className="empty-state">
                  <Search size={28} />
                  <h3>
                    {jobs.length === 0
                      ? "No openings right now"
                      : "No matching roles"}
                  </h3>
                  <p>
                    {jobs.length === 0
                      ? "Check back for future opportunities."
                      : "Try another search or department."}
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
        <section className="process-section" id="process">
          <div className="site-width process-grid">
            <div className="process-intro">
              <p className="eyebrow dark">A CLEAR PATH FORWARD</p>
              <h2>
                People first.
                <br />
                At every step.
              </h2>
              <p>Here’s how we get to know you—and how you get to know us.</p>
            </div>
            <ol className="process-list">
              <li>
                <span className="step-number">01</span>
                <div>
                  <FileText size={20} />
                  <h3>Tell us about yourself</h3>
                  <p>
                    Apply directly with your resume and relevant work. No
                    account needed.
                  </p>
                </div>
              </li>
              <li>
                <span className="step-number">02</span>
                <div>
                  <Search size={20} />
                  <h3>We review your application</h3>
                  <p>
                    Our team reviews your experience. We may invite you to a
                    role-specific exercise.
                  </p>
                </div>
              </li>
              <li>
                <span className="step-number">03</span>
                <div>
                  <MessageSquare size={20} />
                  <h3>Let’s have a conversation</h3>
                  <p>
                    If there’s a fit, choose an interview time that works for
                    you.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </section>
        <section className="closing-note site-width">
          <span className="closing-mark" aria-hidden="true">
            +
          </span>
          <p>Your next chapter could start here.</p>
          <a href="#positions">Find your opportunity</a>
        </section>
      </main>
    </PageChrome>
  );
}
function JobRow({
  job,
  index,
  enabled,
}: {
  job: CareerJob;
  index: number;
  enabled: boolean;
}) {
  const creative = (job.department || "").toLowerCase().includes("creative");
  return (
    <article className="job-row">
      <span className={`job-icon ${creative ? "creative" : "engineering"}`}>
        {creative ? (
          <Palette size={25} strokeWidth={1.6} />
        ) : (
          <Code2 size={25} strokeWidth={1.6} />
        )}
      </span>
      <div className="job-main">
        <span className="job-department">
          {job.department || "AI Case Leads"}
        </span>
        <h3>
          <a href={`/jobs/${encodeURIComponent(job.slug)}`}>{job.title}</a>
        </h3>
        <p>
          <MapPin size={14} aria-hidden="true" />
          {job.location || "International applicants"}
          {job.employmentType && (
            <>
              <span className="metadata-divider" />
              {job.employmentType}
            </>
          )}
        </p>
      </div>
      <div className="job-row-side">
        <span className="job-number">
          /{String(index + 1).padStart(2, "0")}
        </span>
        <a
          className="button outline"
          href={`/jobs/${encodeURIComponent(job.slug)}`}
        >
          {enabled ? "View role & apply" : "View role"}
        </a>
      </div>
    </article>
  );
}
export function CareerDetail({ slug }: { slug: string }) {
  useEffect(() => {
    captureAttribution();
  }, []);
  const { data, loading, error, reload } = useResource<JobResponse>(
    `/api/jobs/${encodeURIComponent(slug)}`,
  );
  return (
    <PageChrome>
      <main id="main" className="detail-main site-width">
        <a className="back-link" href="/#positions">
          All opportunities
        </a>
        {loading ? (
          <div className="detail-loading">
            <Skeleton className="title-skeleton" />
            <Skeleton className="body-skeleton" />
          </div>
        ) : error ? (
          <><div role="alert" className="resource-error">
            <AlertCircle />
            <h1>We couldn’t load this role</h1>
            <p>{error}</p>
            <button className="button outline" onClick={() => void reload()}>
              Try again
            </button>
          </div><SubmissionRecovery slug={slug} /></>
        ) : (
          data && (
            <>
              <div className="detail-heading">
                <p className="eyebrow dark">
                  {data.job.department || "AI CASE LEADS"}
                </p>
                <h1>{data.job.title}</h1>
                <div className="detail-meta">
                  <span>
                    <MapPin size={16} />
                    {data.job.location || "International applicants"}
                  </span>
                  {data.job.employmentType && (
                    <span>{data.job.employmentType}</span>
                  )}
                </div>
              </div>
              <div className="detail-grid">
                <div className="job-description">
                  <h2>About this opportunity</h2>
                  {data.job.descriptionHtml ? (
                    <SafeDescription html={data.job.descriptionHtml} />
                  ) : (
                    <p>
                      We’re preparing this opportunity at AI Case Leads. Full
                      role details will be available when applications open.
                    </p>
                  )}
                  <aside className="process-callout">
                    <h3>A thoughtful hiring process</h3>
                    <p>
                      Our team reviews applications before inviting candidates
                      to assessments or interviews. You won’t need to create an
                      account.
                    </p>
                    <a href="/#process">
                      Explore our hiring process <ChevronRight size={15} />
                    </a>
                  </aside>
                </div>
                <div className="application-panel">
                  <ApplicationForm
                    job={data.job}
                    fields={data.fields || []}
                    enabled={data.submissionEnabled}
                    mode={data.mode}
                    formVersion={data.formVersion}
                  />
                </div>
              </div>
            </>
          )
        )}
      </main>
    </PageChrome>
  );
}
function SafeDescription({ html }: { html: string }) {
  // Provider content is rendered as text, never injected as executable HTML.
  const text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return (
    <div className="description-copy">
      {text
        .split(/\n\s*\n/)
        .filter((s) => s.trim())
        .map((p, i) => (
          <p key={i}>{p.trim()}</p>
        ))}
    </div>
  );
}
export function ApplicationConfirmation({ receipt }: { receipt: string }) {
  const { data, loading, error } = useResource<{ status: string }>(
    `/api/applications/${encodeURIComponent(receipt)}`,
  );
  const accepted = data?.status === "accepted";
  return (
    <PageChrome>
      <main id="main" className="site-width confirmation">
        <div className={`confirmation-icon ${accepted ? "success" : ""}`}>
          {accepted ? <Check size={30} /> : <FileText size={30} />}
        </div>
        <p className="eyebrow dark">YOUR APPLICATION</p>
        <h1>
          {loading
            ? "Checking your application…"
            : accepted
              ? "You’re on our radar."
              : "We couldn’t confirm your application."}
        </h1>
        <p>
          {loading
            ? "Please wait while we verify your submission."
            : accepted
              ? "Your application has been received. Our team will review your experience and contact you about next steps."
              : error ||
                "Please return to your application and check its status before submitting again."}
        </p>
        {accepted && (
          <div className="confirmation-detail">
            <Check size={17} /> Application received securely
          </div>
        )}
        <a className="button ink" href="/#positions">
          Back to opportunities
        </a>
      </main>
    </PageChrome>
  );
}

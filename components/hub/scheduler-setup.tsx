"use client";
import { useState } from "react";
import { Copy, Download, ExternalLink } from "lucide-react";
import { useHubMutation, useHubResource } from "./api";
import { Feedback, Field, ResourceState } from "./shared";
type SchedulerConfiguration = {
  properties: {
    HIRING_SITE_URL: string;
    HIRING_SCHEDULER_SECRET: string;
    HIRING_BATCH_LIMIT: string | number;
  };
  scriptUrl: string;
  privateSiteRequiresServiceToken: boolean;
};
export function SchedulerSetup() {
  const [config, setConfig] = useState<SchedulerConfiguration | null>(null),
    [revealed, setRevealed] = useState(false),
    [copied, setCopied] = useState(""),
    [copyError, setCopyError] = useState("");
  const mutation = useHubMutation();
  const runtime = useHubResource<{hostingPlatform?:string;backgroundEnabled?:boolean}>("/api/google/status");
  async function load() {
    const result = await mutation.run<SchedulerConfiguration>(
      "/api/google/scheduler",
      "POST",
      {},
      "Scheduler configuration loaded for this administrator.",
    );
    if (result) {
      setConfig(result);
      setRevealed(false);
    }
  }
  async function copy(key: string, value: string) {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key + " copied.");
    } catch {
      setCopyError(
        "Your browser could not copy the value. Reveal and select it to copy manually.",
      );
    }
  }
  if (!runtime.data) return <section className="hub-card">
    <h3>Background task processing</h3>
    <ResourceState loading={runtime.loading} error={runtime.error} retry={() => void runtime.reload()} />
  </section>;
  if (runtime.data.hostingPlatform === "railway") return <section className="hub-card">
    <h3>Background task processing</h3>
    <p className="hub-muted">Railway runs email, Calendar, reply synchronization, and Drive tasks automatically while the service is running. No Google Apps Script scheduler is needed. Connect the recruiting account, then verify a real delivery in Integration tasks.</p>
    <p className="hub-notice">{runtime.data.backgroundEnabled ? "Automatic processing is enabled. The Integration tasks view shows the last completed run and any delivery failures." : "Automatic processing is disabled in Railway’s Variables. Set BACKGROUND_ENABLED=true and redeploy before opening applications."}</p>
  </section>;
  return (
    <section className="hub-card">
      <h3>Background task processing</h3>
      <p className="hub-muted">
        Use the company’s Google Apps Script scheduler for unattended email and
        Drive tasks. Until it is installed and verified, use Process pending
        tasks in Integration tasks.
      </p>
      {!config ? (
        <button
          className="hub-button secondary"
          onClick={() => void load()}
          disabled={mutation.busy}
        >
          {mutation.busy
            ? "Loading scheduler setup…"
            : "Show scheduler configuration"}
        </button>
      ) : (
        <>
          <ol className="hub-scheduler-steps">
            <li>
              Open{" "}
              <a
                href="https://script.google.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Apps Script <ExternalLink size={12} />
              </a>{" "}
              with the company account and create a project.
            </li>
            <li>
              <a href={config.scriptUrl} download className="hub-text-button">
                <Download size={14} /> Download the scheduler script
              </a>{" "}
              and paste it into the project.
            </li>
            <li>
              In Project Settings, add the three Script Properties below. Keep
              the secret private.
            </li>
            <li>
              Run the installer function described in the script, authorize the
              project, and verify a real task is processed.
            </li>
          </ol>
          {config.privateSiteRequiresServiceToken && (
            <p className="hub-notice">
              This site is private. Scheduler requests also require an
              authenticated Sites service token until the applicant site is
              public. Keep unattended processing pending until that access path
              is verified.
            </p>
          )}
          <div className="hub-scheduler-properties">
            {Object.entries(config.properties).map(([key, value]) => (
              <Field key={key} label={key}>
                <div className="hub-secret-field">
                  <input
                    readOnly
                    value={String(value)}
                    type={
                      key === "HIRING_SCHEDULER_SECRET" && !revealed
                        ? "password"
                        : "text"
                    }
                    autoComplete="off"
                  />
                  <button
                    className="hub-icon-button"
                    type="button"
                    aria-label={"Copy " + key}
                    onClick={() => void copy(key, String(value))}
                  >
                    <Copy size={15} />
                  </button>
                </div>
              </Field>
            ))}
          </div>
          <div className="hub-button-row">
            <button
              className="hub-button secondary"
              onClick={() => setRevealed((value) => !value)}
            >
              {revealed ? "Hide scheduler secret" : "Reveal scheduler secret"}
            </button>
            <button
              className="hub-text-button"
              onClick={() => {
                setConfig(null);
                setRevealed(false);
                setCopied("");
                mutation.clear();
              }}
            >
              Close configuration
            </button>
          </div>
          <Feedback error={copyError} success={copied} />
        </>
      )}
      <Feedback error={mutation.error} success={mutation.success} />
    </section>
  );
}

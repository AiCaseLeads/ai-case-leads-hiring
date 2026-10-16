"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { hubRequest } from "./api";
import type {
  JobRecoveryDraft,
  JobRecoveryState,
} from "@/lib/job-setup/drafts";
function content(state: JobRecoveryState) {
  const { step: _, ...rest } = state;
  void _;
  return JSON.stringify(rest);
}
export function useJobRecovery(
  key: string,
  state: JobRecoveryState,
  apply: (state: JobRecoveryState) => boolean | void,
  available: boolean,
  active: boolean,
) {
  const latest = useRef({ state, apply, available, active });
  useLayoutEffect(() => {
    latest.current = { state, apply, available, active };
  });
  const initial = useRef("");
  const saved = useRef("");
  const revision = useRef(0);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const bypass = useRef(false);
  const [ready, setReady] = useState(false),
    [message, setMessage] = useState("Loading your saved draft…"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<(() => void) | null>(null);
  const [retry, setRetry] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!pending) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, [pending]);
  const pendingRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!available) return;
    let disposed = false;
    initial.current = content(latest.current.state);
    void hubRequest<JobRecoveryDraft | null>(
      "/api/job-drafts?key=" + encodeURIComponent(key),
    )
      .then((record) => {
        if (disposed) return;
        if (record) {
          revision.current = record.revision;
          if (
            record.state.formVersion !== latest.current.state.formVersion &&
            latest.current.state.formVersion !== null
          ) {
            saved.current = initial.current;
            setMessage(
              "An older recovery draft exists, but this job has since been saved. The latest job is loaded. Saving progress replaces the older recovery copy.",
            );
          } else {
            if (latest.current.apply(record.state) === false) {
              saved.current = initial.current;
              setMessage(
                "This recovery copy was already saved as a job. Open that posting from Jobs to edit it. This editor now starts a separate new job.",
              );
            } else {
              saved.current = content(record.state);
              setMessage(
                "Saved draft restored. Review it before publishing; live job settings have not changed.",
              );
            }
          }
        } else {
          saved.current = initial.current;
          setMessage(
            "Changes are saved privately about every minute. Publishing is always manual.",
          );
        }
        setReady(true);
      })
      .catch(() => {
        if (!disposed) {
          setError(
            "We could not load your saved draft. Retry before editing to avoid overwriting another copy.",
          );
          setMessage("");
        }
      });
    return () => {
      disposed = true;
    };
  }, [available, key, retry]);
  async function persist() {
    if (inFlight.current) return inFlight.current;
    const snapshot = latest.current.state;
    setBusy(true);
    setError("");
    const operation = (async () => {
      try {
        const record = await hubRequest<JobRecoveryDraft>(
          "/api/job-drafts",
          "PUT",
          { key, expectedRevision: revision.current, state: snapshot },
        );
        revision.current = record.revision;
        saved.current = content(snapshot);
        setMessage(
          "Draft saved at " +
            new Date(record.updatedAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            }) +
            ". The live job is unchanged.",
        );
        return true;
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Draft could not be saved. Your entries remain here.",
        );
        return false;
      } finally {
        setBusy(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = operation;
    return operation;
  }
  async function clear() {
    if (inFlight.current && !(await inFlight.current)) return false;
    try {
      await hubRequest("/api/job-drafts", "DELETE", {
        key,
        expectedRevision: revision.current,
      });
      revision.current = 0;
      saved.current = content(latest.current.state);
      initial.current = saved.current;
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Draft could not be removed. Try again before leaving.",
      );
      return false;
    }
  }
  const operations = useRef({ persist, clear });
  useLayoutEffect(() => {
    operations.current = { persist, clear };
  });
  useEffect(() => {
    if (!ready || !active) return;
    // Fixed cadence, not a debounce: continuous typing cannot postpone saving forever.
    const timer = window.setInterval(() => {
      if (!bypass.current && content(latest.current.state) !== saved.current)
        void operations.current.persist();
    }, 60000);
    const unload = (event: BeforeUnloadEvent) => {
      if (!bypass.current && content(latest.current.state) !== saved.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const editorUrl = new URL(window.location.href);
    const guard = (leave: () => void, target?: string) => {
      if (bypass.current || !latest.current.active) return false;
      if (target) {
        const to = new URL(target, window.location.href),
          from = editorUrl;
        if (
          to.pathname === from.pathname &&
          to.searchParams.get("jobSession") ===
            from.searchParams.get("jobSession") &&
          to.searchParams.get("jobEditor") ===
            from.searchParams.get("jobEditor") &&
          to.searchParams.get("jobStep") !== "start"
        )
          return false;
      }
      if (content(latest.current.state) === initial.current) return false;
      pendingRef.current = leave;
      setPending(() => leave);
      return true;
    };
    window.__aiclDraftGuard = guard;
    window.addEventListener("beforeunload", unload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", unload);
      if (window.__aiclDraftGuard === guard) delete window.__aiclDraftGuard;
    };
  }, [ready, active]);
  async function leave(save: boolean) {
    if (save) {
      if (inFlight.current) await inFlight.current;
      if (!(await operations.current.persist())) return;
    } else if (!(await operations.current.clear())) return;
    const continuation = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    bypass.current = true;
    continuation?.();
  }
  return {
    ready,
    busy,
    message,
    error,
    retry: () => {
      setError("");
      setRetry((v) => v + 1);
    },
    save: persist,
    clear,
    complete: () => {
      bypass.current = true;
    },
    dialog: pending ? (
      <div className="hub-draft-overlay">
        <section
          ref={dialogRef}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !busy) {
              pendingRef.current = null;
              setPending(null);
            }
            if (event.key !== "Tab") return;
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ),
            );
            if (!buttons.length) {
              event.preventDefault();
              return;
            }
            const first = buttons[0],
              last = buttons.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="draft-dialog-title"
          className="hub-card hub-draft-dialog"
        >
          <h2 id="draft-dialog-title">Save your changes before leaving?</h2>
          <p>
            This job has changes. Save a private draft to continue later, or
            discard your draft changes. The published job will not change.
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="hub-dialog-actions">
            <button
              type="button"
              className="hub-button"
              disabled={busy}
              onClick={() => void leave(true)}
            >
              Save draft &amp; leave
            </button>
            <button
              type="button"
              className="hub-button secondary"
              disabled={busy}
              onClick={() => void leave(false)}
            >
              Leave without saving
            </button>
            <button
              type="button"
              className="hub-text-button"
              disabled={busy}
              onClick={() => {
                pendingRef.current = null;
                setPending(null);
              }}
            >
              Keep editing
            </button>
          </div>
        </section>
      </div>
    ) : null,
  };
}

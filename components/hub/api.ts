"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export class HubError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
function unavailableMessage(status: number) {
  return [502,503,504].includes(status)
    ? `The hiring server is temporarily unavailable (${status}). Your entries are still here. Please try again shortly.`
    : "This action could not be completed. Please try again.";
}
export async function hubRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new HubError(
      "We couldn’t reach the hiring hub. Your entries are still here. Please try again.",
      0,
    );
  }
  let result: { data?: T; error?: { message?: string; code?: string } };
  try {
    const parsed: unknown = await response.json();
    result = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as typeof result : {};
  } catch {
    throw new HubError(
      [502,503,504].includes(response.status) ? unavailableMessage(response.status) : "We couldn’t confirm the server response. Refresh the record before repeating an action.",
      response.status,
    );
  }
  if (!response.ok)
    throw new HubError(
      typeof result.error?.message === "string" ? result.error.message : unavailableMessage(response.status),
      response.status,
      typeof result.error?.code === "string" ? result.error.code : undefined,
    );
  if (!Object.prototype.hasOwnProperty.call(result, "data"))
    throw new HubError(
      "The hiring hub returned an incomplete response. Please refresh.",
      response.status,
    );
  return result.data as T;
}
/** Only job saves have a server ledger keyed by creationId and the exact payload. */
export async function jobSaveRequest<T>(body: unknown, onRetry: () => void): Promise<T> {
  const snapshot = JSON.parse(JSON.stringify(body)) as {action?:unknown;creationId?:unknown};
  if (snapshot.action !== "save" || typeof snapshot.creationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(snapshot.creationId))
    throw new HubError("This save is missing its recovery ID. Reopen the job before saving.",400);
  try { return await hubRequest<T>("/api/job-setup","POST",snapshot); }
  catch (error) {
    if (!(error instanceof HubError) || ![0,502,503,504].includes(error.status)) throw error;
    onRetry();
    await new Promise(resolve=>setTimeout(resolve,1000));
    return hubRequest<T>("/api/job-setup","POST",snapshot);
  }
}
export function useHubResource<T>(path: string, refresh = 0) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const epoch = useRef(0);
  const reload = useCallback(async () => {
    const current = ++epoch.current;
    setLoading(true);
    setError("");
    try {
      const next = await hubRequest<T>(path);
      if (current === epoch.current) setData(next);
    } catch (e) {
      if (current === epoch.current) {
        setData(null);
        setError(e instanceof Error ? e.message : "Please try again.");
      }
    } finally {
      if (current === epoch.current) setLoading(false);
    }
  }, [path]);
  const invalidate = useCallback(() => {
    epoch.current++;
  }, []);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void reload();
    });
    return () => {
      cancelled = true;
      invalidate();
    };
  }, [reload, refresh, invalidate]);
  return { data, error, loading, reload };
}
export function useHubMutation() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [retrying, setRetrying] = useState(false);
  const active = useRef(false);
  async function run<T>(
    path: string,
    method: string,
    body?: unknown,
    message = "Saved.",
    retryJobSave = false,
  ): Promise<T | undefined> {
    if (active.current) return undefined;
    active.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    setRetrying(false);
    try {
      const result = retryJobSave && path === "/api/job-setup" && method === "POST"
        ? await jobSaveRequest<T>(body,()=>setRetrying(true))
        : await hubRequest<T>(path, method, body);
      setSuccess(message);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
      return undefined;
    } finally {
      active.current = false;
      setBusy(false);
      setRetrying(false);
    }
  }
  return {
    busy,
    retrying,
    error,
    success,
    run,
    clear: () => {
      setError("");
      setSuccess("");
    },
  };
}
export function displayDate(value?: number | string, timeZone?: string) {
  if (value === undefined || value === null || value === "")
    return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        ...(timeZone ? { timeZone } : {}),
      });
}
export function displayAnswer(value: unknown): string {
  if (value === null || value === undefined) return "No answer";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (Array.isArray(value)) return value.map(displayAnswer).join(", ");
  return JSON.stringify(value);
}
export function safeNavigation(value: string): boolean {
  try {
    const url = new URL(value, window.location.origin);
    return (
      url.protocol === "https:" ||
      (url.origin === window.location.origin && url.protocol === "http:")
    );
  } catch {
    return false;
  }
}

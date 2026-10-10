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
    result = await response.json();
  } catch {
    throw new HubError(
      "We couldn’t confirm the server response. Refresh the record before repeating an action.",
      response.status,
    );
  }
  if (!response.ok)
    throw new HubError(
      result.error?.message ||
        "This action could not be completed. Please try again.",
      response.status,
      result.error?.code,
    );
  if (!Object.prototype.hasOwnProperty.call(result, "data"))
    throw new HubError(
      "The hiring hub returned an incomplete response. Please refresh.",
      response.status,
    );
  return result.data as T;
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
    [success, setSuccess] = useState("");
  const active = useRef(false);
  async function run<T>(
    path: string,
    method: string,
    body?: unknown,
    message = "Saved.",
  ): Promise<T | undefined> {
    if (active.current) return undefined;
    active.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await hubRequest<T>(path, method, body);
      setSuccess(message);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
      return undefined;
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return {
    busy,
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

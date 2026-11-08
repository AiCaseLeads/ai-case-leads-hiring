"use client";
import { useCallback, useEffect, useRef, useState } from "react";

const preferenceKey = "hiring.booking.timeZone";

function validZone(value?: string | null) {
  if (!value) return undefined;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch { return undefined; }
}

export function candidateTimeZone(preferred?: string | null) {
  return validZone(preferred) ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}

function savedZone() {
  try { return validZone(sessionStorage.getItem(preferenceKey)); }
  catch { return undefined; }
}

function saveZone(zone: string) {
  try { sessionStorage.setItem(preferenceKey, zone); }
  catch { /* The picker still works with private storage disabled. */ }
}

const locationUnavailable = "Location is unavailable. Choose your time zone manually.";

export function useBookingTimeZone(bookedZone: string | undefined, edgeZone: string | undefined, canAutoLocate: boolean) {
  const [preference] = useState(savedZone);
  const [zone, setZone] = useState(() => candidateTimeZone(validZone(bookedZone) ?? preference ?? edgeZone));
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);

  const invalidate = useCallback(() => { request.current++; }, []);
  const stopLocating = useCallback(() => {
    invalidate();
    setLocating(false);
    setError("");
  }, [invalidate]);

  const choose = (value: string) => {
    stopLocating();
    setZone(value);
    saveZone(value);
  };

  const locate = useCallback(async (explicit: boolean) => {
    const sequence = ++request.current;
    try {
      if (!navigator.geolocation) throw new Error("Location unavailable");
      setLocating(true);
      setError("");
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false, maximumAge: 300_000, timeout: 6_000,
        }),
      );
      if (sequence !== request.current) return;
      // Coordinates stay in this browser. The boundary map is a first-party static asset.
      const { default: lookup } = await import("@photostructure/tz-lookup");
      const resolved = validZone(lookup(position.coords.latitude, position.coords.longitude));
      if (!resolved) throw new Error("Unrecognized time zone");
      if (sequence !== request.current) return;
      setZone(resolved);
      if (explicit) saveZone(resolved);
    } catch {
      if (explicit && sequence === request.current) setError(locationUnavailable);
    } finally {
      if (sequence === request.current) setLocating(false);
    }
  }, []);

  useEffect(() => {
    if (canAutoLocate && !validZone(bookedZone) && !preference && !validZone(edgeZone)) {
      const sequence = request.current;
      // A new permission prompt is reserved for the candidate's explicit button.
      void navigator.permissions?.query({ name: "geolocation" }).then(permission => {
        if (permission.state === "granted" && request.current === sequence) void locate(false);
      }).catch(() => { /* Some browsers only support explicit requests. */ });
    }
    return invalidate;
  }, [bookedZone, canAutoLocate, edgeZone, invalidate, locate, preference]);

  return { zone, choose, locate, stopLocating, locating, error };
}

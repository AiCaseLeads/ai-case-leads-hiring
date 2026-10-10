const keys = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
];
const storageKey = "aicl:attribution";
/** Campaign context is transient browser state, not an authoritative hiring record. */
export function captureAttribution(): Record<string, string> {
  const current: Record<string, string> = {};
  const params = new URLSearchParams(window.location.search);
  for (const key of keys) {
    const value = params.get(key);
    if (value) current[key] = value.slice(0, 200);
  }
  try {
    if (Object.keys(current).length) {
      sessionStorage.setItem(storageKey, JSON.stringify(current));
      return current;
    }
    const stored = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
    if (stored && typeof stored === "object")
      for (const key of keys)
        if (typeof stored[key] === "string")
          current[key] = stored[key].slice(0, 200);
  } catch {
    /* Restricted storage only loses source attribution; it cannot affect acceptance. */
  }
  return current;
}

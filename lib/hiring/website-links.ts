import type { ApplicationField } from "./types";

export function isWebsiteField(field: { type: string }): boolean {
  return field.type === "Url" || field.type === "SocialLink";
}

export function websiteLinkError(value: unknown, field: Pick<ApplicationField, "path" | "title">): string | null {
  const linkedIn = /linkedin/i.test(`${field.path} ${field.title}`);
  const message = linkedIn
    ? "Enter a full LinkedIn link starting with https://, such as https://www.linkedin.com/in/your-name."
    : "Enter a full website link starting with https://, such as https://example.com/portfolio.";
  if (typeof value !== "string" || !/^https:\/\/[^/]/i.test(value) || /[\s\\]/.test(value) || value.length > 2000) return message;
  try {
    const url = new URL(value);
    const labels = url.hostname.split(".");
    if (url.protocol !== "https:" || url.username || url.password || labels.length < 2 ||
      labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ||
      !/^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/i.test(labels.at(-1)!)) return message;
    if (linkedIn && url.hostname !== "linkedin.com" && !url.hostname.endsWith(".linkedin.com")) return message;
    return null;
  } catch { return message; }
}

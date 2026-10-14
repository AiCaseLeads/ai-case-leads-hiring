import { sanitizeJobDescription } from "@/lib/job-description";

export function SafeDescription({ html }: { html: string }) {
  // Only attribute-free formatting tags survive this shared allowlist.
  return (
    <div
      className="description-copy"
      dangerouslySetInnerHTML={{ __html: sanitizeJobDescription(html) }}
    />
  );
}

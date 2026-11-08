import type { AiMatchDetail } from "../ai/matchtypes";

type Finding = AiMatchDetail["criteria"][number];

// Old reviews sometimes embedded an entire contact header or serialized form
// answers in the explanation itself. Those fragments belong in neither the
// summary nor its fallback.
function usableProse(text: string) {
  if (/^(?:r[eé]sum[eé]|linkedin|application)(?:\s+(?:excerpt|quote))?\s*:/iu.test(text)) return false;
  return text.length > 0 && !/[{}]|\\["nrt]|"(?:answer|question|quote|source)"\s*:|@|https?:\/\/|www\.|\b(?:linkedin|github)\.com\/|[•]|(?:\+?\d[ ().-]*){10,}\d?|\s\|\s/u.test(text);
}

function removeApplicantName(text: string, name: string) {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  if (!parts.length) return text;
  const fullName = parts.map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${fullName}(?![\\p{L}\\p{N}])`, "giu"), "the applicant")
    .replace(/^the applicant/u, "The applicant");
}

export function summarizeClaim(finding: Finding, applicantName: string): string {
  const explanation = (finding.explanation || "").trim();
  // Keep the narrative ahead of any old appended source blocks. Citations are
  // independently available in the AI review and never supply display copy here.
  const narrative = explanation.split(/(?:^|\s)(?:r[eé]sum[eé]|application|linkedin)(?:\s+(?:excerpt|quote))?\s*:/iu)[0];
  const sentences = narrative.split(/(?:\n+|(?<=[.!?])\s+(?=[\p{Lu}]))/u)
    .map(line => line.replace(/\s+/gu, " ").trim());
  const usable = sentences.filter(usableProse);
  if (usable.length) {
    const genericFollowUp = /^(?:which (?:one |figure |number )?is (?:correct|accurate)|can (?:you|they) clarify (?:this|that|the difference|the discrepancy))\?$/iu;
    // A specific follow-up can introduce a separate fact (e.g., years in ML
    // within total years of experience). Drop only empty or duplicate prompts.
    const distinct = [...new Set(usable)].filter((line, index) => index === 0 || !genericFollowUp.test(line));
    const summary = distinct.join(" ")
      .replace(/^(?:the )?r[eé]sum[eé] summary (?:claims|states|lists|reports)\s+/iu, "The résumé lists ")
      .replace(/,?\s+(?:while|whereas) (?:the )?application answers? lists?\s+/iu, ". The application lists ")
      .replace(/([.!?]\s+)which is the correct total years and how many of those/iu, "$1How many years in total, and how many of those");
    return removeApplicantName(summary, applicantName);
  }

  const topic = (finding.criterion || "").replace(/\s+/gu, " ").trim();
  if (usableProse(topic) && topic.length <= 90) {
    return removeApplicantName(`Clarify the evidence for “${topic}”.`, applicantName);
  }
  return "Clarify which details in the application and supporting sources agree.";
}

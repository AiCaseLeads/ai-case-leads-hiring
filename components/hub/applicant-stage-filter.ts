const terminalStages = new Set(["Rejected", "Withdrawn", "Hired"]);

export function normalizeApplicantScope(params: URLSearchParams) {
  if (params.has("interviewProgress")) {
    params.delete("stage");
    params.delete("excludeStage");
    params.set("active", "false");
  }
  if (params.get("trash") === "true") params.delete("active");
  else if (terminalStages.has(params.get("stage") || "")) params.set("active", "false");
  else if (!params.has("active")) params.set("active", params.get("stage") ? "false" : "true");
  return params;
}
export function applicantStageChoice(params: URLSearchParams) {
  const interview = params.get("interviewProgress");
  if (interview) return `interview:${interview}`;
  const stage = params.get("stage");
  if (stage) return `stage:${stage}`;
  const scope = params.get("active") === "false" ? "all" : "active";
  return params.get("excludeStage") ? `${scope}:exclude:${params.get("excludeStage")}` : scope;
}
export function applyApplicantStageChoice(params: URLSearchParams, choice: string) {
  params.delete("interviewProgress"); params.delete("stage"); params.delete("excludeStage"); params.delete("page");
  if (choice.startsWith("interview:")) {
    params.set("interviewProgress", choice.slice("interview:".length));
    params.set("active", "false");
  } else if (choice.startsWith("stage:")) {
    params.set("stage", choice.slice(6)); params.set("active", "false");
  } else if (choice.includes(":exclude:")) {
    const [scope, , stage] = choice.split(":");
    params.set("active", scope === "active" ? "true" : "false"); params.set("excludeStage", stage);
  } else params.set("active", choice === "active" ? "true" : "false");
  return params;
}

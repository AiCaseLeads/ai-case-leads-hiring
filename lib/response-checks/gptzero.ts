import { z } from "zod";

const endpoint = "https://api.gptzero.me";
export type DetectorClassification = "AI_ONLY" | "HUMAN_ONLY" | "MIXED" | "UNDETERMINED";

export class DetectorError extends Error {
  constructor(readonly status: number, readonly retryAfterSeconds: number) {
    super("The writing assessment service could not complete this request.");
  }
}

function retryDelay(header: string | null) {
  if (!header) return 60;
  const seconds = /^\d+$/.test(header) ? Number(header) : Math.ceil((Date.parse(header) - Date.now()) / 1000);
  return Number.isFinite(seconds) ? Math.max(1, Math.min(seconds, 86_400)) : 60;
}

async function request(path: string, apiKey: string, document?: string) {
  try {
    const response = await fetch(endpoint + path, {
      method: document === undefined ? "GET" : "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json", "User-Agent": "AI-Case-Leads-Hiring/1.0" },
      ...(document === undefined ? {} : { body: JSON.stringify({document}) }),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new DetectorError(response.status, retryDelay(response.headers.get("retry-after")));
    }
    return await response.json();
  } catch (error) {
    if (error instanceof DetectorError) throw error;
    throw new DetectorError(503, 60);
  }
}

const classes: Record<string, DetectorClassification> = {
  ai: "AI_ONLY", human: "HUMAN_ONLY", mixed: "MIXED", unknown: "UNDETERMINED", undetermined: "UNDETERMINED",
};
export async function scanAnswer(text: string, apiKey: string): Promise<{classification:DetectorClassification;confidence:string|null}> {
  const body = await request("/v2/predict/text", apiKey, text);
  const parsed = z.object({documents:z.array(z.object({
    predicted_class:z.string(), confidence_category:z.string().nullable().optional(),
  })).min(1)}).safeParse(body);
  if (!parsed.success) throw new DetectorError(502, 60);
  const doc = parsed.data.documents[0];
  const classification = Object.hasOwn(classes, doc.predicted_class) ? classes[doc.predicted_class] : "UNDETERMINED";
  const confidence = ["high","medium","low"].includes(doc.confidence_category ?? "") ? String(doc.confidence_category) : null;
  return { classification, confidence };
}
export async function getDetectorAllowance(apiKey: string): Promise<number> {
  const body = await request("/v3/usage-stats", apiKey);
  const parsed = z.object({data:z.object({words_left:z.number().int().nonnegative()})}).safeParse(body);
  if (!parsed.success) throw new DetectorError(502, 60);
  return parsed.data.data.words_left;
}

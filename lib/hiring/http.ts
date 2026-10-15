import { requireGrant, verifyChallenge, spamStatus } from "./antispam";
import { privateToken, sha256 } from "./crypto";
import { HiringError } from "./errors";
import type { HiringProvider, HiringStore } from "./types";
import { previewFields, previewJobs } from "./preview";
import { HiringService } from "./service";
import { parseApplication, parseUpload } from "./validation";

const COOKIE_NAME = "hiring_session";
const PRIVATE_TOKEN = /^[a-f0-9]{64}$/;
export type HiringDependencies = { provider?: HiringProvider; store?: HiringStore; applicationsEnabled: boolean; archive?: (applicationId: string, dedupeKey: string) => Promise<void>; customSubmit?: (input: import("./types").ApplicationInput, session: string) => Promise<import("./service").SubmissionResult> };
export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
}
export function errorResponse(error: unknown): Response {
  if (error instanceof HiringError) return jsonResponse({ error: { code: error.code, message: error.message, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) } }, error.status);
  // Do not return provider error bodies, candidate data, database errors, or credentials.
  return jsonResponse({ error: { code: "service_unavailable", message: "We could not process this request. Please try again shortly." } }, 503);
}
export function readSession(request: Request): string | undefined {
  const entry = (request.headers.get("cookie") || "").split(";").map(part => part.trim()).find(part => part.startsWith(`${COOKIE_NAME}=`));
  const session = entry?.slice(COOKIE_NAME.length + 1);
  return session && PRIVATE_TOKEN.test(session) ? session : undefined;
}
function withSession(response: Response, request: Request) {
  if (!readSession(request)) response.headers.set("Set-Cookie", `${COOKIE_NAME}=${privateToken()}; HttpOnly; Path=/; SameSite=Strict; Max-Age=604800${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`);
  return response;
}
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (origin !== new URL(request.url).origin || (site && site !== "same-origin" && site !== "none")) throw new HiringError("invalid_origin", 403, "Open the application on this website before submitting.");
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new HiringError("invalid_content_type", 415, "This request must use JSON.");
}
async function readJson(request: Request): Promise<unknown> {
  const maxBytes = 256 * 1024;
  if (Number(request.headers.get("content-length") || 0) > maxBytes) throw new HiringError("request_too_large", 413, "This application is too large. Shorten your answers and retry.");
  if (!request.body) throw new HiringError("invalid_request", 400, "The application details are missing.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) { await reader.cancel(); throw new HiringError("request_too_large", 413, "This application is too large. Shorten your answers and retry."); }
    chunks.push(value);
  }
  const combined = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(combined)); }
  catch { throw new HiringError("invalid_request", 400, "The application details could not be read."); }
}
function service(deps: HiringDependencies): HiringService {
  if (!deps.provider || !deps.store) throw new HiringError("applications_disabled", 503, "Applications are not open yet. Please check back soon.");
  return new HiringService(deps.provider, deps.store, deps.applicationsEnabled, deps.archive);
}
async function rateLimit(request: Request, deps: HiringDependencies, session: string, kind: string) {
  if (!deps.store) return;
  const window = Math.floor(Date.now() / (10 * 60 * 1000));
  const sessionKey = await sha256(`${kind}:session:${session}`);
  if (!await deps.store.takeRateLimit(sessionKey, window, kind === "upload" ? 20 : 30)) throw new HiringError("rate_limited", 429, "Too many requests. Wait a few minutes and try again.");
  // Cloudflare replaces this header with the actual client address on deployed requests.
  const ip = request.headers.get("cf-connecting-ip");
  if (ip && !await deps.store.takeRateLimit(await sha256(`${kind}:ip:${ip}`), window, kind === "upload" ? 150 : 150)) throw new HiringError("rate_limited", 429, "Too many requests. Wait a few minutes and try again.");
}
export async function getJobs(request: Request, deps: HiringDependencies): Promise<Response> {
  try {
    const jobs = deps.provider ? await deps.provider.listJobs() : previewJobs;
    return withSession(jsonResponse({ jobs, mode: deps.provider ? "live" : "preview", submissionEnabled: !!deps.provider && !!deps.store && deps.applicationsEnabled }), request);
  } catch (error) { return errorResponse(error); }
}
export async function getJob(request: Request, slug: string, deps: HiringDependencies): Promise<Response> {
  try {
    const jobs = deps.provider ? await deps.provider.listJobs() : previewJobs;
    const job = jobs.find(j => j.slug === slug);
    if (!job) throw new HiringError("job_closed", 404, "This job is no longer accepting applications.");
    const detail = deps.provider ? await deps.provider.jobInfo(job.id) : { job, fields: previewFields };
    return withSession(jsonResponse({ ...detail, mode: deps.provider ? "live" : "preview", submissionEnabled: !!deps.provider && !!deps.store && deps.applicationsEnabled && !detail.formUnavailable }), request);
  } catch (error) { return errorResponse(error); }
}
export async function postUpload(request: Request, deps: HiringDependencies): Promise<Response> {
  try {
    assertSameOrigin(request);
    const session = readSession(request);
    if (!session) throw new HiringError("session_required", 409, "Refresh the application page before uploading your file.");
    await rateLimit(request, deps, session, "upload");
    const input = parseUpload(await readJson(request));
    await requireGrant(request.headers.get("x-application-verification"),session,request.headers.get("x-submission-key") || "",input.jobPostingId);
    return jsonResponse(await service(deps).upload(input, session));
  } catch (error) { return errorResponse(error); }
}
export async function postApplication(request: Request, deps: HiringDependencies): Promise<Response> {
  try {
    assertSameOrigin(request);
    const session = readSession(request);
    if (!session) throw new HiringError("session_required", 409, "Refresh the application page before submitting.");
    await rateLimit(request, deps, session, "application");
    const input = parseApplication(await readJson(request));
    const existing = await deps.store?.find(await sha256(input.submissionKey));
    if (!existing || existing.sessionHash !== await sha256(session)) {
      await requireGrant(request.headers.get("x-application-verification"),session,input.submissionKey,input.jobPostingId);
      const email = input.fieldSubmissions.find(field => /email/i.test(field.path))?.value;
      if (typeof email === "string" && deps.store && !await deps.store.takeRateLimit(await sha256(`application:email:${email.trim().toLowerCase()}`),Math.floor(Date.now()/3600000),10)) throw new HiringError("rate_limited",429,"Too many applications for this email address. Please try again later.");
    }
    const result = deps.customSubmit ? await deps.customSubmit(input, session) : await service(deps).submit(input, session);
    return jsonResponse(result, result.status === "pending" ? 202 : result.status === "accepted" ? 201 : 200);
  } catch (error) { return errorResponse(error); }
}
export async function getReceipt(receipt: string, deps: HiringDependencies): Promise<Response> {
  try {
    if (!PRIVATE_TOKEN.test(receipt) || !deps.store) throw new HiringError("receipt_not_found", 404, "This confirmation link is unavailable.");
    const record = await deps.store.receipt(await sha256(receipt));
    if (!record) throw new HiringError("receipt_not_found", 404, "This confirmation link is unavailable.");
    return jsonResponse({ status: record.status, ...(record.status === "accepted" ? { jobTitle: record.jobTitle, submittedAt: new Date(record.createdAt).toISOString() } : {}) });
  } catch (error) { return errorResponse(error); }
}

export async function getVerification() { return jsonResponse(spamStatus()); }
export async function postVerification(request: Request, deps: HiringDependencies) {
  try {
    assertSameOrigin(request);
    const session = readSession(request);
    if (!session) throw new HiringError("session_required",409,"Refresh the application page before continuing.");
    await rateLimit(request,deps,session,"verification");
    const body = await readJson(request) as { token?: unknown; submissionKey?: unknown; jobId?: unknown };
    if (typeof body.submissionKey !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(body.submissionKey) || typeof body.jobId !== "string" || !body.jobId || body.jobId.length > 200) throw new HiringError("invalid_request",400,"Reload the application and try again.");
    return jsonResponse(await verifyChallenge(body.token,session,body.submissionKey,body.jobId,new URL(request.url).hostname));
  } catch(error) { return errorResponse(error); }
}

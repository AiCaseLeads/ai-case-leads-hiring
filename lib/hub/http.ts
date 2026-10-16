import { downloadApplications } from "./exports";
import type { HubMember } from "./auth";
import { HiringError } from "../hiring/errors";
import { assertSameOrigin, errorResponse, jsonResponse } from "../hiring/http";
import { boundedBytes } from "../hiring/files";
import { HubStore } from "./store";
import { changeApplicationTrash } from './application-lifecycle';
import { changeJobLifecycle, jobLifecycleInput } from "./job-lifecycle";
import {
  actionInput,
  bulkInput,
  jobInput,
  jobPatchInput,
  parse,
  settingsInput,
} from "./validation";

async function json(request: Request): Promise<unknown> {
  const bytes = await boundedBytes(request, 512 * 1024);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HiringError(
      "invalid_request",
      400,
      "The request could not be read.",
    );
  }
}
function admin(member: HubMember): void {
  if (member.role !== "admin")
    throw new HiringError(
      "admin_access_required",
      403,
      "Only managers can change this setting.",
    );
}

function applicationFilters(request: Request) {
      const params = new URL(request.url).searchParams;
      if(params.has("top") && params.get("top")!=="10") throw new HiringError("invalid_top",422,"Only the top 10 shortcut is supported.");
      const q = params.get("q") || undefined,
        page = params.get("page") || "1";
      const qualification = params.get("qualification") || undefined,
        grade = params.get("grade") || undefined,
        sort = params.get("sort") || undefined,
        duplicate = params.get("duplicate") || undefined,
        jobId = params.get("jobId") || undefined;
      if ((params.has('trash')&&params.get('trash')!=='true') || (q?.length || 0) > 200 || !/^\d{1,6}$/.test(page))
        throw new HiringError(
          "invalid_filter",
          422,
          "Check the search and page filters.",
        );
      if ((qualification && !["pass", "review", "fail"].includes(qualification)) ||
          (grade && !["reviewed", "ungraded"].includes(grade)) ||
          (sort && !["grade_desc","ai_match_desc"].includes(sort)) || (duplicate && duplicate !== "true") ||
          ((grade || sort) && !jobId))
        throw new HiringError("invalid_filter", 422, "Choose one role before comparing reviewer grades, and check the application filters.");
      return {
        q,
        top: params.get("top") === "10" ? 10 as const : undefined,
        jobId,
        stage: params.get("stage") || undefined,
        assignee: params.get("assignee") || undefined,
        page: Number(page),
        qualification: qualification as "pass" | "review" | "fail" | undefined,
        grade: grade as "reviewed" | "ungraded" | undefined,
        sort: sort as "grade_desc" | "ai_match_desc" | undefined,
        duplicate: duplicate === "true" ? true : undefined,
        trash: params.get('trash')==='true',
      };
}
/** Route authentication must run before this dispatcher; tests supply an explicit authorized member. */
export async function handleHubRequest(
  request: Request,
  path: string[],
  member: HubMember,
  store: HubStore,
): Promise<Response> {
  try {
    if (request.method !== "GET") assertSameOrigin(request);
    const [section, id, operation] = path;
    let data: unknown;
    if (section === "overview" && request.method === "GET")
      data = await store.overview();
    else if (section === "jobs" && request.method === "GET" && !id)
      data = await store.listJobs();
    else if (section === "jobs" && request.method === "POST" && !id) {
      data = await store.saveJob(parse(jobInput, await json(request)));
    } else if (section === "jobs" && id && operation === "lifecycle" && request.method === "POST") {
      data = await changeJobLifecycle(store, id, parse(jobLifecycleInput, await json(request)), member);
    } else if (section === "jobs" && id && !operation && request.method === "PATCH") {
      const existing = await store.getJob(id),
        { formVersion, lifecycleRevision, ...patch } = parse(jobPatchInput, await json(request));
      data = await store.saveJob(
        parse(jobInput, {
          title: existing.title,
          slug: existing.slug,
          department: existing.department,
          descriptionHtml: existing.descriptionHtml,
          location: existing.location,
          status: existing.status,
          fields: existing.fields,
          rules: existing.rules,
          autoReject: existing.autoReject,
          rejectionTemplate: existing.rejectionTemplate,
          assessmentPrompt: existing.assessmentPrompt,
          archiveProject: existing.archiveProject,
          archiveCountry: existing.archiveCountry,
          hiringRound: existing.hiringRound,
          ...patch,
        }),
        id,
        formVersion ?? existing.formVersion,
        lifecycleRevision ?? 0,
      );
    } else if(section === "application-counts" && request.method === "GET") {
      data=await store.applicationCounts();
    } else if (section === "applications" && request.method === "GET" && !id) {
      data = await store.applications(applicationFilters(request));
    } else if (section === "applications-export" && request.method === "GET" && !id) {
      if(new URL(request.url).searchParams.has("format")) {
        const format=new URL(request.url).searchParams.get("format");
        if(format !== "csv" && format !== "zip" && format !== "pdf") throw new HiringError("invalid_export_format",422,"Choose PDF, CSV or ZIP.");
        const bucket=format === "zip" ? (await import("../hiring/runtime")).getHiringEnv().BUCKET : undefined;
        return await downloadApplications(request,store,applicationFilters(request),bucket);
      }
      data = await store.exportApplications(applicationFilters(request));
    } else if (
      section === "applications" &&
      id &&
      request.method === "GET" &&
      !operation
    )
      data = await store.getApplication(id);
    else if(section==='applications' && id && operation==='lifecycle' && request.method==='POST') {
      const input=await json(request) as {action?:unknown;expectedRevision?:unknown};
      if(!input || !['trash','restore'].includes(String(input.action)) || !Number.isSafeInteger(input.expectedRevision)) throw new HiringError('invalid_application_action',422,'Choose Delete or Restore and refresh the application.');
      data=await changeApplicationTrash(store,id,input.action as 'trash'|'restore',input.expectedRevision as number,member);
    }
    else if (
      section === "applications" &&
      id &&
      operation === "action" &&
      request.method === "POST"
    )
      data = await store.action(
        id,
        parse(actionInput, await json(request)),
        member,
      );
    else if (section === "bulk" && request.method === "POST") {
      const input = parse(bulkInput, await json(request));
      data = await store.bulk(input.ids, input, member);
    } else if (section === "reports" && request.method === "GET")
      data = await store.reports();
    else if (section === "settings" && request.method === "GET")
      data = await store.settings();
    else if (section === "settings" && request.method === "PATCH") {
      if (!member.isOwner) throw new HiringError("owner_access_required",403,"Only the account owner can change company settings.");
      const input = parse(settingsInput, await json(request));
      if (input.members) throw new HiringError("use_team_settings",422,"Use Team access to invite or update recruiting staff.");
      data = await store.saveSettings(
        input,
        member,
      );
    } else if (section === "setup" && request.method === "POST") {
      admin(member);
      await json(request);
      data = await store.seedDraftJobs();
    } else if (section === "tasks" && request.method === "GET") {
      const page = new URL(request.url).searchParams.get("page") || "1";
      if (!/^[1-9]\d{0,4}$/.test(page) || Number(page) > 10000)
        throw new HiringError(
          "invalid_filter",
          422,
          "Choose a task page from 1 to 10000.",
        );
      data = (await store.tasks(Number(page))).map((task) => ({
        id: task.id,
        applicationId: task.applicationId,
        kind: task.kind,
        status: task.status,
        attempts: task.attempts,
        runAfter: task.runAfter,
        leaseUntil: task.leaseUntil,
        lastError: task.lastError,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      }));
    } else if (
      section === "tasks" &&
      id &&
      operation === "retry" &&
      request.method === "POST"
    ) {
      await json(request);
      const task = await store.retryTask(id);
      data = { id: task.id, status: task.status };
    } else
      throw new HiringError(
        "route_not_found",
        404,
        "This hiring endpoint was not found.",
      );
    return jsonResponse({ data });
  } catch (error) {
    return errorResponse(error);
  }
}

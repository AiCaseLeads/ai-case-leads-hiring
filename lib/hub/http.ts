import {getRecruiterReview,saveRecruiterReview,workflowOverview,listRoleInterviews,workflowSettings,saveWorkflowSettings} from "./recruiting-workflow";
import {markNotesReviewed} from "./note-review";
import {STAGES} from "./types";
import {sendShareInvitations} from "./share-invitations";
import {manageApplicantShare} from "./applicant-share";
import { APPLICATION_SORTS, type ApplicationFilters } from "./store";
import { withRequiredApplicationFields } from "../hiring/contact-fields";
import { downloadApplications } from "./exports";
import type { HubMember } from "./auth";
import { HiringError } from "../hiring/errors";
import { assertSameOrigin, errorResponse, jsonResponse } from "../hiring/http";
import { boundedBytes } from "../hiring/files";
import { HubStore, applicationDateBounds } from "./store";
import { publicTaskProgress } from "./task-progress";
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
      if ((params.has('active')&&!['true','false'].includes(params.get('active')||'')) || (params.has('trash')&&params.get('trash')!=='true') || (q?.length || 0) > 200 || !/^\d{1,6}$/.test(page))
        throw new HiringError(
          "invalid_filter",
          422,
          "Check the search and page filters.",
        );
      if ((qualification && !["pass", "review", "fail"].includes(qualification)) ||
          (grade && !["reviewed", "ungraded"].includes(grade)) ||
          (sort && !APPLICATION_SORTS.includes(sort as typeof APPLICATION_SORTS[number])) || (duplicate && duplicate !== "true") ||
          ((grade || (sort && ["grade_desc","ai_match_desc","ai_match_asc"].includes(sort))) && !jobId))
        throw new HiringError("invalid_filter", 422, "Choose one role before comparing reviewer grades, and check the application filters.");
      const stage=params.get("stage")||undefined,excludeStage=params.get("excludeStage")||undefined;
      if([stage,excludeStage].some(value=>value&&!STAGES.includes(value as typeof STAGES[number])))throw new HiringError("invalid_filter",422,"Choose a valid application stage.");
      const dates={appliedFrom:params.get('appliedFrom')||undefined,appliedTo:params.get('appliedTo')||undefined,timeZone:params.get('timeZone')||undefined};
      applicationDateBounds(dates);
      return {
        ...dates,
        q,
        top: params.get("top") === "10" ? 10 as const : undefined,
        jobId,
        stage,
        excludeStage,
        assignee: params.get("assignee") || undefined,
        page: Number(page),
        qualification: qualification as "pass" | "review" | "fail" | undefined,
        grade: grade as "reviewed" | "ungraded" | undefined,
        sort: sort as ApplicationFilters["sort"],
        duplicate: duplicate === "true" ? true : undefined,
        trash: params.get('trash')==='true',
        active: params.get('active')==='true',
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
    if (!member?.email) throw new HiringError("staff_access_required",403,"Sign in with an authorized hiring account.");
    if (request.method !== "GET") assertSameOrigin(request);
    const [section, id, operation] = path;
    let data: unknown;
    if(section==='meetgeek') {const {handleMeetGeekRequest}=await import('../meetgeek/service');return handleMeetGeekRequest(request,path,member,store);}
    if(section==='workflow'&&id==='overview'&&request.method==='GET')data=await workflowOverview(store,member);
    else if(section==='workflow'&&id==='settings'&&request.method==='GET')data=await workflowSettings(store);
    else if(section==='workflow'&&id==='settings'&&request.method==='PATCH')data=await saveWorkflowSettings(store,await json(request),member);
    else if(section==='interviews'&&!id&&request.method==='GET'){const params=new URL(request.url).searchParams;data=await listRoleInterviews(store,{jobId:params.get('jobId')||undefined,owner:params.get('owner')||undefined,status:params.get('status')||undefined,page:params.has('page')?Number(params.get('page')):undefined,pageSize:params.has('pageSize')?Number(params.get('pageSize')):undefined});}
    else if(section==='applications'&&id&&operation==='recruiter-review'&&request.method==='GET')data=await getRecruiterReview(store,id,member);
    else if(section==='applications'&&id&&operation==='recruiter-review'&&['PUT','PATCH'].includes(request.method))data=await saveRecruiterReview(store,id,await json(request),member);
    else if (section === "overview" && request.method === "GET")
      data = await store.overview();
    else if(section==='applications' && id && operation==='share-invitations' && request.method==='POST'){
      const body=await json(request) as Record<string,unknown>;
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='token')||typeof body.token!=='string')throw new HiringError('invalid_share',422,'Choose a current sharing link.');
      data=await sendShareInvitations(store,id,body.token,new URL(request.url).origin);
    }
    else if(section==='applications' && id && operation==='share' && ['GET','POST','DELETE'].includes(request.method)){
      let days=7; let options:{access?:unknown;emails?:unknown}={};
      if(request.method==='POST'){
        const body=await json(request) as Record<string,unknown>;
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['expiresInDays','access','emails'].includes(key))||(body.expiresInDays!==undefined&&![7,30].includes(body.expiresInDays as number)))throw new HiringError('invalid_share',422,'Choose a seven-day or thirty-day link.');
        days=(body.expiresInDays as number|undefined)??7; options={access:body.access,emails:body.emails};
      }
      data=await manageApplicantShare(store,id,request.method,days,options);
    }
    else if (section === "jobs" && request.method === "GET" && !id)
      data = await store.listJobs();
    else if (section === "jobs" && request.method === "POST" && !id) {
      const input = parse(jobInput, await json(request));
      data = await store.saveJob({ ...input, fields: withRequiredApplicationFields(input.fields) });
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
          rules: existing.rules,
          autoReject: existing.autoReject,
          rejectionTemplate: existing.rejectionTemplate,
          assessmentPrompt: existing.assessmentPrompt,
          archiveProject: existing.archiveProject,
          archiveCountry: existing.archiveCountry,
          hiringRound: existing.hiringRound,
          ...patch,
          fields: withRequiredApplicationFields(patch.fields ?? existing.fields),
        }),
        id,
        formVersion ?? existing.formVersion,
        lifecycleRevision ?? 0,
      );
    } else if(section === "application-counts" && request.method === "GET") {
      data=await store.applicationCounts();
    } else if (section === "applications" && request.method === "GET" && !id) {
      data = await store.applications(applicationFilters(request),member.email);
    } else if(section==='applications' && id && operation==='navigation' && request.method==='GET') {
      data=await store.applicationNavigation(id,applicationFilters(request));
    } else if(section==='applications' && id && operation==='notes-reviewed' && request.method==='POST') {
      const body=await json(request) as Record<string,unknown>;
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='expectedNotesVersion')||typeof body.expectedNotesVersion!=='string'||! /^[a-f0-9]{64}$/.test(body.expectedNotesVersion))throw new HiringError('invalid_request',422,'Provide the current notes version.');
      data=await markNotesReviewed(store,id,member.email,body.expectedNotesVersion);
    } else if(section==='applications' && id && operation==='viewed'  && request.method==='POST') {
      const input=await json(request);
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new HiringError('invalid_request',422,'Send an empty view acknowledgement.');
      data=await store.markApplicationViewed(id,member.email);
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
      data = await store.getApplication(id,member.email);
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
    else if(section === "bulk-rejection" && request.method === "POST") {
      const body=await json(request) as Record<string,unknown>;
      if(!body||typeof body!=="object"||Array.isArray(body))throw new HiringError("invalid_bulk",422,"Choose applicants to preview.");
      if(id==="preview"){
        if(Object.keys(body).some(key=>!["ids","reason"].includes(key))||body.ids!==undefined&&(!Array.isArray(body.ids)||body.ids.length<1||body.ids.length>10000||body.ids.some(value=>typeof value!=="string"||value.length>128)||new Set(body.ids).size!==body.ids.length)||body.reason!==undefined&&(typeof body.reason!=="string"||!body.reason.trim()||body.reason.length>2000))throw new HiringError("invalid_bulk",422,"Choose valid applicants and a rejection reason.");
        data=await store.previewBulkRejection(applicationFilters(request),body.ids as string[]|undefined,typeof body.reason==="string"?body.reason.trim():"Not selected after recruiter review.",member);
      }else if(id==="execute"){
        if(Object.keys(body).some(key=>!["planId","confirmed"].includes(key))||body.confirmed!==true||typeof body.planId!=="string"||! /^[a-f0-9-]{36}$/.test(body.planId))throw new HiringError("invalid_bulk",422,"Confirm the previewed group before rejecting applicants.");
        data=await store.executeBulkRejection(body.planId,member);
      }else throw new HiringError("not_found",404,"This action is unavailable.");
    }
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
    } else if (section === "mail-recovery" && request.method === "POST" && ["preview", "execute"].includes(id)) {
      admin(member);
      const { previewMailRecovery, executeMailRecovery } = await import("./mail-recovery");
      const { resolvedWorkspaceEnv } = await import("../workspace-config");
      const dependencies = { env: await resolvedWorkspaceEnv() };
      const input = await json(request);
      data = id === "preview" ? await previewMailRecovery(store, member, input, dependencies) : await executeMailRecovery(store, member, input, dependencies);
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
        ...publicTaskProgress(task),
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

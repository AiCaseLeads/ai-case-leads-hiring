import { jobTeam,teamKey,validateTeam } from "../job-team/service";
import type { HubMember } from "../hub/auth-core";
import { HubStore, DEFAULT_REJECTION } from "../hub/store";
import { assertJobEditable, jobLifecycleKey } from "../hub/job-lifecycle";
import { parse, sanitizeDescription, validateJob } from "../hub/validation";
import { HiringError } from "../hiring/errors";
import { assertSameOrigin, errorResponse, jsonResponse } from "../hiring/http";
import { boundedBytes } from "../hiring/files";
import { canonicalJson, sha256 } from "../hiring/crypto";
import { emptyCatalog, type Catalog } from "../scorecards/model";
import {
  catalogCommand,
  emptySetup,
  publicLocation,
  saveCommand,
  type SetupCatalog,
} from "./model";
const KEY = "job_setup_v1",
  SCORE = "scorecard_templates_v1";
async function body(request: Request) {
  try {
    return JSON.parse(
      new TextDecoder().decode(await boundedBytes(request, 512 * 1024)),
    );
  } catch (e) {
    if (e instanceof HiringError) throw e;
    throw new HiringError(
      "invalid_request",
      400,
      "The form could not be read.",
    );
  }
}
export async function handleJobSetup(
  request: Request,
  member: HubMember | null,
  store: HubStore,
  owners:string[]=[],
) {
  try {
    if (!member)
      throw new HiringError(
        "staff_access_required",
        403,
        "Sign in with an authorized hiring account.",
      );
    const setup = await store.setting<SetupCatalog>(
      KEY,
      structuredClone(emptySetup),
    );
    if (request.method === "GET") return jsonResponse({ data: setup });
    assertSameOrigin(request);
    if (request.method === "PATCH") {
      const input = parse(catalogCommand, await body(request));
      if (input.expectedRevision !== setup.revision)
        throw new HiringError(
          "setup_conflict",
          409,
          "Jobs changed. Refresh before saving; your entries remain here.",
        );
      if (input.action === "template") {
        if (setup.templates.length >= 500)
          throw new HiringError(
            "template_limit",
            422,
            "The job template limit was reached.",
          );
        const job = await store.getJob(input.sourceJobId),
          scores = await store.setting<Catalog>(
            SCORE,
            structuredClone(emptyCatalog),
          );
        const { id: _, formVersion: __, lifecycle: ___, ...definition } = job; // Snapshot: later edits to the source never alter a saved template.
        void _;
        void __;
        void ___;
        setup.templates.push({
          id: crypto.randomUUID(),
          name: input.name,
          sourceJobId: job.id,
          job: { ...definition, status: "draft", autoReject: false },
          location: setup.locations[job.id] || null,
          scorecard: scores.bindings[job.id],
          createdAt: Date.now(),
        });
      } else {
        if (setup.requests.length >= 5000)
          throw new HiringError(
            "request_limit",
            422,
            "The hiring request limit was reached.",
          );
        setup.requests.push({
          id: crypto.randomUUID(),
          title: input.title,
          location: input.location,
          description: input.description,
          reason: input.reason,
          createdBy: member.email,
          createdAt: Date.now(),
          status: "pending",
        });
      }
      const previous = setup.revision;
      setup.revision++;
      const result = await store
        .stmt(
          "INSERT INTO hub_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE json_extract(hub_settings.value,'$.revision')=? RETURNING key",
          KEY,
          JSON.stringify(setup),
          Date.now(),
          previous,
        )
        .first();
      if (!result)
        throw new HiringError(
          "setup_conflict",
          409,
          "Another manager saved changes. Refresh before trying again.",
        );
      return jsonResponse({ data: setup });
    }
    if (request.method !== "POST")
      throw new HiringError(
        "method_not_allowed",
        405,
        "Use the job setup form.",
      );
    const input = parse(saveCommand, await body(request)),
      operationKey = `job_save_${input.creationId}`,
      payloadHash = await sha256(canonicalJson(input));
    const completed = await store.setting<{
      jobId: string;
      payloadHash: string;
    } | null>(operationKey, null);
    if (completed) {
      if (completed.payloadHash !== payloadHash)
        throw new HiringError(
          "save_changed",
          409,
          "This save was already accepted. Reopen the saved job before making more changes.",
        );
      return jsonResponse({ data: await store.getJob(completed.jobId) });
    }
    const previous = input.jobId ? await store.getJob(input.jobId) : null;
    if (previous) {
      assertJobEditable(previous);
      if ((previous.lifecycle?.revision || 0) !== (input.expectedLifecycleRevision || 0)) {
        throw new HiringError("record_changed", 409, "This job was paused, restored or otherwise changed. Reopen it before saving; your entries remain here.");
      }
    }
    if (previous && previous.formVersion !== input.formVersion)
      throw new HiringError(
        "record_changed",
        409,
        "This job changed. Reopen it before saving; your entries remain here.",
      );
    const jobId = previous?.id || input.creationId,
      scores = await store.setting<Catalog>(
        SCORE,
        structuredClone(emptyCatalog),
      ),
      oldBinding = scores.bindings[jobId];
    if (
      previous &&
      canonicalJson(oldBinding || null) !== canonicalJson(input.expectedBinding)
    )
      throw new HiringError(
        "scorecard_changed",
        409,
        "The assigned scorecard changed while you were editing. Review the latest assignment before saving.",
      );
    const previousTeam=await jobTeam(store,jobId);
    if(input.hiringTeam&&input.expectedTeamRevision!==(previousTeam?.revision||0))throw new HiringError("job_team_changed",409,"This hiring team changed. Refresh before saving.");
    const team=input.hiringTeam?await validateTeam(store,input.hiringTeam,owners):undefined;
    let binding = input.scorecard;
    if (input.rubric) {
      if (scores.templates.length >= 1000)
        throw new HiringError(
          "template_limit",
          422,
          "The scorecard version limit was reached.",
        );
      const template = {
        ...input.rubric,
        id: crypto.randomUUID(),
        version: 1,
        createdBy: member.email,
        createdAt: Date.now(),
      };
      scores.templates.push(template);
      binding = { templateId: template.id, version: 1 };
    }
    if (binding) {
      const template = scores.templates.find(
        (t) => t.id === binding!.templateId && t.version === binding!.version,
      );
      if (
        !template ||
        (scores.archived.includes(template.id) &&
          (!previous ||
            oldBinding?.templateId !== binding.templateId ||
            oldBinding.version !== binding.version))
      )
        throw new HiringError(
          "template_unavailable",
          409,
          "Choose an available scorecard template.",
        );
      scores.bindings[jobId] = binding;
    } else delete scores.bindings[jobId];
    if (input.requestId) {
      const jobRequest = setup.requests.find((r) => r.id === input.requestId);
      if (!jobRequest || jobRequest.status !== "pending")
        throw new HiringError(
          "request_unavailable",
          409,
          "This hiring request was already used or removed.",
        );
      jobRequest.status = "used";
      jobRequest.jobId = jobId;
    }
    const rejectionTemplate =
      input.job.rejectionTemplate ??
      previous?.rejectionTemplate ??
      (await store.setting("rejection_template", DEFAULT_REJECTION));
    if (!input.location && !previous)
      throw new HiringError(
        "location_required",
        422,
        "Choose a work arrangement and location for this new posting.",
      );
    const job = {
      ...input.job,
      rejectionTemplate,
      location: input.location
        ? publicLocation(input.location)
        : previous?.location,
    };
    validateJob(job);
    if (input.location) setup.locations[jobId] = input.location;
    const setupRevision = setup.revision,
      scoreRevision = scores.revision;
    setup.revision++;
    scores.revision++;
    scores.updatedBy = member.email;
    scores.updatedAt = Date.now();
    const now = Date.now();
    // The NOT NULL guard aborts the whole transaction if either catalog or the job changed.
    // The operation ledger is written in the same transaction as the posting and its rubric.
    const guard =
      "COALESCE((SELECT json_extract(value,'$.revision') FROM hub_settings WHERE key='job_setup_v1'),0)=? AND COALESCE((SELECT json_extract(value,'$.revision') FROM hub_settings WHERE key='scorecard_templates_v1'),0)=?";
    const teamGuard=team?" AND COALESCE((SELECT json_extract(value,'$.revision') FROM hub_settings WHERE key=?),0)=?":"";
    const revisionGuard = previous
      ? " AND (SELECT form_version FROM hub_jobs WHERE id=?)=? AND COALESCE((SELECT json_extract(value,'$.revision') FROM hub_settings WHERE key=?),0)=?"
      : "";
    const statements = [
      store.stmt(
        `INSERT INTO hub_settings(key,value,updated_at) VALUES(?,CASE WHEN ${guard}${revisionGuard}${teamGuard} THEN ? ELSE NULL END,?)`,
        operationKey,
        setupRevision,
        scoreRevision,
        ...(previous ? [jobId, previous.formVersion, jobLifecycleKey(jobId), previous.lifecycle?.revision || 0] : []),
        ...(team?[teamKey(jobId),input.expectedTeamRevision!]:[]),
        JSON.stringify({ jobId, payloadHash }),
        now,
      ),
    ];
    const description =
      previous && job.descriptionHtml === previous.descriptionHtml
        ? job.descriptionHtml
        : sanitizeDescription(job.descriptionHtml);
    const values = [
      job.title,
      job.slug,
      job.department,
      description,
      job.location || null,
      job.status,
      JSON.stringify(job.fields),
      JSON.stringify(job.rules),
      job.autoReject ? 1 : 0,
      (job.aiMatchEnabled ?? previous?.aiMatchEnabled ?? false) ? 1 : 0,
      rejectionTemplate,
      job.assessmentPrompt || null,
      job.archiveProject?.trim() || null,
      job.archiveCountry?.trim() || null,
      job.hiringRound?.trim() || null,
    ];
    if (previous)
      statements.push(
        store.stmt(
          "UPDATE hub_jobs SET title=?,slug=?,department=?,description_html=?,location=?,status=?,fields_json=?,rules_json=?,auto_reject=?,ai_match_enabled=?,rejection_template=?,assessment_prompt=?,archive_project=?,archive_country=?,hiring_round=?,form_version=form_version+1,updated_at=? WHERE id=?",
          ...values,
          now,
          jobId,
        ),
      );
    else
      statements.push(
        store.stmt(
          "INSERT INTO hub_jobs(id,title,slug,department,description_html,location,status,fields_json,rules_json,auto_reject,ai_match_enabled,rejection_template,assessment_prompt,archive_project,archive_country,hiring_round,form_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)",
          jobId,
          ...values,
          now,
          now,
        ),
      );
    if(team)statements.push(store.settingStatement(teamKey(jobId),{...team,revision:(previousTeam?.revision||0)+1,createdAt:previousTeam?.createdAt||now,updatedAt:now}));
    statements.push(
      store.settingStatement(KEY, setup),
      store.settingStatement(SCORE, scores),
    );
    try {
      await store.db.batch(statements);
    } catch {
      const saved = await store.setting<{
        jobId: string;
        payloadHash: string;
      } | null>(operationKey, null);
      if (saved?.payloadHash === payloadHash)
        return jsonResponse({ data: await store.getJob(saved.jobId) });
      throw new HiringError(
        "job_conflict",
        409,
        "The page address is already used or another manager saved changes. Your entries remain here. Refresh the job list before trying again.",
      );
    }
    return jsonResponse({ data: await store.getJob(jobId) });
  } catch (error) {
    return errorResponse(error);
  }
}

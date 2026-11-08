import { z } from "zod";
import { HiringError } from "../hiring/errors";
import type { HubStore } from "./store";
import type { HubMember } from "./auth-core";

const catalogKey = "job_groups_v1";
export type JobGroup = {
  id: string;
  kind: "role" | "folder";
  name: string;
  jobIds: string[];
  revision: number;
};
export type JobGroupCatalog = { revision: number; groups: JobGroup[] };
export const jobGroupPostingIdsSql = `SELECT m.value FROM hub_settings s,
  json_each(s.value,'$.groups') g, json_each(g.value,'$.jobIds') m
  WHERE s.key='${catalogKey}' AND json_extract(g.value,'$.id')=?`;

const revision = z.number().int().nonnegative();
const save = z.object({
  action: z.literal("save"), expectedRevision: revision,
  id: z.string().uuid().optional(), kind: z.enum(["role","folder"]),
  name: z.string().trim().min(1).max(100),
  jobIds: z.array(z.string().min(1).max(200)).max(2000),
}).strict();
const remove = z.object({ action: z.literal("delete"), expectedRevision: revision, id: z.string().uuid() }).strict();
export async function jobGroupCatalog(store: HubStore) {
  return store.setting<JobGroupCatalog>(catalogKey,{revision:0, groups:[]});
}

export async function changeJobGroups(store: HubStore, member: HubMember, input: unknown): Promise<JobGroupCatalog> {
  if (!member?.email || !["admin","recruiter"].includes(member.role))
    throw new HiringError("staff_access_required",403,"Sign in with an authorized hiring account.");
  const parsed = z.discriminatedUnion("action",[save, remove]).safeParse(input);
  if (!parsed.success) throw new HiringError("invalid_job_group",422,"Choose a name and valid postings.");
  const data = parsed.data;
  const current = await jobGroupCatalog(store);
  const conflict = () => new HiringError("job_groups_changed",409,"Someone updated the job groups. Reload the groups before saving.");
  if (current.revision !== data.expectedRevision) throw conflict();
  const prior = current.groups.find(group=>group.id===data.id);
  if (data.id && !prior) throw new HiringError("job_group_missing",404,"This group is no longer available.");
  let groups = current.groups.filter(group=>group.id!==data.id);
  if (data.action === "save") {
    if (!prior && groups.length >= 500) throw new HiringError("job_groups_full",422,"Remove an unused group before creating another.");
    if (prior && prior.kind!==data.kind) throw new HiringError("job_group_kind",422,"A saved group’s type cannot change.");
    if (groups.some(group=>group.kind===data.kind && group.name.toLowerCase()===data.name.toLowerCase()))
      throw new HiringError("job_group_name_used",409,"A group with this name already exists.");
    const ids = [...new Set(data.jobIds)];
    const wanted = new Set(ids);
    if (ids.length) {
      const count = await store.stmt("SELECT COUNT(*) AS n FROM hub_jobs WHERE id IN (SELECT value FROM json_each(?))",JSON.stringify(ids)).first<{n:number}>();
      if (count?.n!==ids.length) throw new HiringError("job_missing",422,"A selected posting is no longer available.");
    }
    if (data.kind==="role" && groups.some(group=>group.kind==="role" && group.jobIds.some(id=>wanted.has(id))))
      throw new HiringError("job_already_grouped",409,"Remove that posting from its current role before adding it to another.");
    groups = [...groups,{id:data.id||crypto.randomUUID(),kind:data.kind,name:data.name,jobIds:ids,revision:(prior?.revision||0)+1}];
  }
  const next = {revision:current.revision+1, groups};
  // The membership check and revision compare cover the entire catalog. Two
  // simultaneous saves cannot both claim an ungrouped job for different roles.
  const row = await store.stmt(`INSERT INTO hub_settings(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at
    WHERE json_extract(hub_settings.value,'$.revision')=? RETURNING key`,
    catalogKey,JSON.stringify(next),Date.now(),current.revision).first();
  if (!row) throw conflict();
  return next;
}

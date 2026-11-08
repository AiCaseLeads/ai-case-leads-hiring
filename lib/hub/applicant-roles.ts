import { activeApplicationsSql } from "./application-lifecycle";
import { openPostingSql } from "./job-lifecycle";
import { rolePostingMembershipSql } from "./job-groups";
import type { HubStore } from "./store";

export type ApplicantRole = {
  jobId?: string;
  jobGroupId?: string;
  name: string;
  locations: string[];
  reviewCount: number;
  postingCount: number;
};

type Posting = {
  id: string; title: string; location: string | null;
  groupId: string | null; groupName: string | null; reviewCount: number;
};

/** Use explicit role memberships. The same posting may appear in several folders. */
export async function applicantRoleDirectory(store: HubStore): Promise<{roles: ApplicantRole[]}> {
  const postings = await store.rows<Posting>(`
    WITH memberships AS (${rolePostingMembershipSql})
    SELECT j.id, j.title, j.location, m.groupId, m.groupName, COUNT(a.id) AS reviewCount
    FROM hub_jobs j
    LEFT JOIN memberships m ON m.jobId=j.id
    LEFT JOIN hub_applications a ON a.job_id=j.id AND a.stage='Application Review' AND ${activeApplicationsSql("a")}
    WHERE ${openPostingSql("j")}
    GROUP BY j.id
    ORDER BY j.created_at DESC, j.id
  `);
  const roles = new Map<string,ApplicantRole>();
  for (const posting of postings) {
    const key = posting.groupId ? "group:" + posting.groupId : "job:" + posting.id;
    const role = roles.get(key) ?? {
      ...(posting.groupId ? { jobGroupId: posting.groupId } : { jobId: posting.id }),
      name: posting.groupName ?? posting.title, locations: [], reviewCount: 0, postingCount: 0,
    };
    role.reviewCount += posting.reviewCount;
    role.postingCount++;
    if (posting.location && !role.locations.includes(posting.location)) role.locations.push(posting.location);
    roles.set(key, role);
  }
  // Stable sorting retains newest-posting order within each section.
  return { roles: [...roles.values()].sort((a,b) => Number(b.reviewCount > 0) - Number(a.reviewCount > 0)) };
}

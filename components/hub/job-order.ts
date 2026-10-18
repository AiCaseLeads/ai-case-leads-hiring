import type { HubJob } from './types';

/** Current openings first; use creation time so editing an old job cannot bump it above a new posting. */
export function sortHubJobs<T extends Pick<HubJob, 'id' | 'title' | 'status' | 'lifecycle' | 'createdAt'>>(jobs: readonly T[]): T[] {
  const lifecycleOrder = { active: 0, archived: 1, deleted: 2 };
  const statusOrder = { open: 0, draft: 1, closed: 2 };
  return [...jobs].sort((a, b) =>
    lifecycleOrder[a.lifecycle?.state || 'active'] - lifecycleOrder[b.lifecycle?.state || 'active'] ||
    statusOrder[a.status] - statusOrder[b.status] ||
    (b.createdAt || 0) - (a.createdAt || 0) ||
    a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
  );
}

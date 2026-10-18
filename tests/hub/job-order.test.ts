import test from 'node:test';
import assert from 'node:assert/strict';
import { sortHubJobs } from '../../components/hub/job-order';
import type { HubJob } from '../../components/hub/types';
test('job lists prioritize current openings newest first without changing the source array',()=>{
 const jobs=[
  {id:'paused',title:'Paused',status:'closed',createdAt:90},
  {id:'older',title:'Older open',status:'open',createdAt:10,updatedAt:100},
  {id:'draft',title:'Draft',status:'draft',createdAt:70},
  {id:'recent',title:'Recent open',status:'open',createdAt:20},
  {id:'archived',title:'Archived',status:'open',createdAt:99,lifecycle:{state:'archived'}},
 ] as HubJob[];
 const before=jobs.map(j=>j.id);
 assert.deepEqual(sortHubJobs(jobs).map(j=>j.id),['recent','older','draft','paused','archived']);
 assert.deepEqual(jobs.map(j=>j.id),before);
});

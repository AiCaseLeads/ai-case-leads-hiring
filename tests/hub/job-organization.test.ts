import assert from "node:assert/strict";
import { test } from "node:test";
import { availableJobSlug, jobBatch, jobGroup, jobLocation, matchingJobs, nextBatch, withExperienceQuestions } from "../../components/hub/job-organization";
import type { HubJob } from "../../components/hub/types";

const base: HubJob = {id:"spain",title:"Creative Strategist",slug:"creative-strategist-spain-batch-1",archiveProject:"Creative Strategist",archiveCountry:"Spain",hiringRound:"Batch 1",department:"",descriptionHtml:"",status:"draft",fields:[],rules:[],autoReject:false,rejectionTemplate:"Thanks",formVersion:1};
const jobs = [base, {...base,id:"usa",archiveCountry:"USA"}, {...base,id:"engineer",archiveProject:"Engineer"}, {...base,id:"second",hiringRound:"Batch 2"}];

test("existing batch choices use exact job and location while retaining separate posting identities", () => {
  assert.deepEqual(matchingJobs(jobs,"Creative Strategist","Spain").map(job => job.id), ["spain","second"]);
  assert.deepEqual(matchingJobs(jobs,"Creative Strategist","USA").map(job => job.id), ["usa"]);
  assert.equal(nextBatch(jobs,"Creative Strategist","Spain"), "Batch 3");
  assert.equal(nextBatch(jobs,"Creative Strategist","USA"), "Batch 2");
});

test("legacy grouping matches existing archive defaults rather than silently relocating by public wording", () => {
  const legacy = {...base,archiveProject:undefined,archiveCountry:undefined,hiringRound:undefined,location:"Remote in Spain"};
  assert.equal(jobGroup(legacy), "Creative Strategist");
  assert.equal(jobLocation(legacy), "International");
  assert.equal(jobBatch(legacy), "Original batch");
});

test("new posting addresses are readable, valid, bounded, and avoid known existing addresses", () => {
  assert.equal(availableJobSlug("Creative Strategist","Spain","Batch 1",jobs), "creative-strategist-spain-batch-1-2");
  assert.equal(availableJobSlug("Diseñador", "España", "Octubre", []), "disenador-espana-octubre");
  assert.equal(availableJobSlug("職", "", "", []), "job");
  const long = availableJobSlug("Role ".repeat(100),"USA","Batch 1",[]);
  assert.ok(long.length <= 160);
  assert.match(long,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

test("experience preset preserves existing answers and adds optional profile fields only once", () => {
  const existing = [{path:"linkedin_profile",title:"Our custom LinkedIn question",type:"Url" as const,required:false}];
  const once = withExperienceQuestions(existing), twice = withExperienceQuestions(once);
  assert.deepEqual(once,twice);
  assert.equal(once.length,4);
  assert.deepEqual(once[0],existing[0]);
  assert.equal(once.find(field => field.path === "accuracy_confirmation")?.required,true);
  assert.equal(once.find(field => field.path === "experience_summary")?.required,false);
  assert.equal(existing.length,1);
});

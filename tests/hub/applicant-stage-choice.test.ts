import test from 'node:test';
import assert from 'node:assert/strict';
import {applyApplicantStageChoice,applicantStageChoice,normalizeApplicantScope} from '../../components/hub/applicant-stage-filter';
test('one stage selection replaces conflicting scope and preserves the rest of the cohort',()=>{
 const query=new URLSearchParams('jobId=j&active=true&excludeStage=Screening&page=3&qualification=pass&appliedFrom=2026-10-01&sort=newest');
 applyApplicantStageChoice(query,'stage:Rejected');
 assert.equal(query.get('active'),'false');assert.equal(query.get('stage'),'Rejected');assert.equal(query.has('excludeStage'),false);assert.equal(query.has('page'),false);
 assert.equal(query.get('qualification'),'pass');assert.equal(query.get('appliedFrom'),'2026-10-01');assert.equal(query.get('sort'),'newest');
 assert.equal(applicantStageChoice(query),'stage:Rejected');
 for(const choice of ['all','active']){applyApplicantStageChoice(query,choice);assert.equal(query.has('stage'),false);assert.equal(query.has('excludeStage'),false);assert.equal(applicantStageChoice(query),choice);}
});
test('active-not-shortlisted and all-exclusion remain explicit, reversible filters',()=>{
 const query=new URLSearchParams('jobId=j&stage=Interview');
 for(const scope of ['active','all']){applyApplicantStageChoice(query,`${scope}:exclude:Screening`);assert.equal(query.get('excludeStage'),'Screening');assert.equal(query.has('stage'),false);assert.equal(query.get('active'),scope==='active'?'true':'false');assert.equal(applicantStageChoice(query),`${scope}:exclude:Screening`);}
});
test('legacy terminal stage links recover from conflicting active scope; normal links retain their scope',()=>{
 for(const stage of ['Rejected','Withdrawn','Hired']){const query=normalizeApplicantScope(new URLSearchParams({stage,active:'true'}));assert.equal(query.get('active'),'false');assert.equal(query.get('stage'),stage);}
 assert.equal(normalizeApplicantScope(new URLSearchParams('stage=Screening&active=true')).get('active'),'true');
 assert.equal(normalizeApplicantScope(new URLSearchParams('stage=Rejected')).get('active'),'false');
 assert.equal(normalizeApplicantScope(new URLSearchParams()).get('active'),'true');
});

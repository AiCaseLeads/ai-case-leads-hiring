import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ApplicantMessages} from '../../components/hub/applicant-messages';
import {AgentAccess} from '../../components/hub/agent-access';
import {HandoffSummary,type InterviewHandoffReview} from '../../components/hub/workflow-review';
import {ApplicantFilterDisclosure} from '../../components/hub/applicant-filter-disclosure';
import {RecordingEvidence} from '../../components/hub/interview-workspace';
import {HubSettings} from '../../components/hub/settings';
import type {ApplicationDetail,Member} from '../../components/hub/types';

test('automatic email body and delivery explanation are collapsed while recipients remain inspectable',()=>{
 const detail={communications:[{id:'mail',direction:'outgoing',purpose:'acknowledgment',subject:'Application received',body:'private mail contents',status:'sent',createdAt:1,sender:'recruiter@example.test',to:['candidate@example.test'],cc:['requester@example.test']}]} as ApplicationDetail;
 const html=renderToStaticMarkup(createElement(ApplicantMessages,{detail,busy:false,compose:()=>undefined}));
 assert.match(html,/View automatic email/);
 const start=html.indexOf('<details');const end=html.indexOf('</details>');
 assert.ok(start>=0&&html.indexOf('private mail contents')>start&&html.indexOf('private mail contents')<end);
 assert.ok(html.indexOf('inbox delivery is not confirmed')>start);
 assert.match(html,/candidate@example.test/);assert.match(html,/requester@example.test/);
 assert.doesNotMatch(html,/<details[^>]*\bopen(?:\s|=|>)/);
});
test('assistant connection credentials are not mounted before New connection and are owner-gated',()=>{
 assert.equal(renderToStaticMarkup(createElement(AgentAccess,{isOwner:false})), '');
 const owner=renderToStaticMarkup(createElement(AgentAccess,{isOwner:true}));
 assert.match(owner,/New connection/);assert.doesNotMatch(owner,/type="password"/);assert.doesNotMatch(owner,/hub-input/);
});
test('settings labels distinguish email templates from scorecards and keep administrator destinations gated',()=>{
 const member:Member={email:'recruiter@example.test',role:'recruiter'};
 const html=renderToStaticMarkup(createElement(HubSettings,{member,refresh:0,changed:()=>undefined,startSection:'scorecards'}));
 assert.match(html,/My calendar &amp; email/);assert.match(html,/Email templates/);assert.match(html,/Scorecards/);
 assert.doesNotMatch(html,/Team &amp; permissions/);assert.doesNotMatch(html,/>Diagnostics</);assert.doesNotMatch(html,/>Integrations</);
});

test('complete interview handoff defaults to readable evidence without form controls',()=>{
 const review:InterviewHandoffReview={version:1,recommendation:'advance',notes:'Detailed interview notes',summary:'Concise interview summary.',recordingUrl:'https://recordings.example.invalid/meeting',salaryExpectation:'$3,000 USD per month',availability:'Two weeks',concerns:'Verify incident ownership.',readiness:{ready:true,missing:[]},canApprove:true};
 const html=renderToStaticMarkup(createElement(HandoffSummary,{review,edit:()=>undefined}));
 assert.match(html,/Move forward/);assert.match(html,/Edit handoff/);assert.match(html,/Open call recording/);assert.match(html,/Concise interview summary/);assert.match(html,/Two weeks/);
 assert.doesNotMatch(html,/<(?:input|textarea|select|form)\b/);assert.doesNotMatch(html,/<details[^>]*\bopen(?:\s|=|>)/);
 assert.ok(html.indexOf('Detailed interview notes')>html.indexOf('<details'));assert.ok(html.indexOf('Verify incident ownership')<html.indexOf('<details'));
});
test('incomplete interview handoff names missing evidence and offers completion without mounting seven inputs',()=>{
 const review:InterviewHandoffReview={version:0,recommendation:'',notes:'',summary:'',recordingUrl:'',salaryExpectation:'',availability:'',concerns:'',readiness:{ready:false,missing:['Call recording','Interview notes']},canApprove:false};
 const html=renderToStaticMarkup(createElement(HandoffSummary,{review,edit:()=>undefined}));assert.match(html,/Complete handoff/);assert.match(html,/Call recording/);assert.match(html,/Interview notes/);assert.doesNotMatch(html,/<(?:input|textarea|select|form)\b/);
});


test('handoff recording is not repeated while distinct recording attachments remain accessible',()=>{
 const recordingUrl='https://recordings.example.invalid/first';
 const uploads=[{id:'same',filename:'First interview',url:recordingUrl},{id:'second',filename:'Second interview',url:'https://recordings.example.invalid/second'}];
 const html=renderToStaticMarkup(createElement(RecordingEvidence,{recordingUrl,uploads,primaryRecordingInHandoff:true}));
 assert.doesNotMatch(html,/Open recording/);assert.doesNotMatch(html,/First interview/);assert.match(html,/Second interview/);assert.match(html,/https:\/\/recordings.example.invalid\/second/);
 const standalone=renderToStaticMarkup(createElement(RecordingEvidence,{recordingUrl,uploads:[]}));assert.match(standalone,/Open recording/);
 const playable=renderToStaticMarkup(createElement(RecordingEvidence,{recordingUrl:'/api/hub/interview-recordings/synthetic',uploads:[],primaryRecordingInHandoff:true}));assert.match(playable,/<video[^>]*controls/);assert.doesNotMatch(playable,/Open recording/);
});


test('mobile filter disclosure starts collapsed and preserves a single set of controls plus active count',()=>{
 const html=renderToStaticMarkup(createElement(ApplicantFilterDisclosure,{activeCount:2},createElement('select',{'aria-label':'Screening'},createElement('option',null,'Requirements met'))));
 assert.match(html,/aria-expanded="false"/);assert.match(html,/Filters &amp; order/);assert.match(html,/aria-label="2 active filters"/);assert.equal((html.match(/<select/g)||[]).length,1);assert.match(html,/aria-controls="[^"]+"/);
});


test('download action stays outside collapsed filters and secondary shortcuts stay inside',()=>{
 const html=renderToStaticMarkup(createElement(ApplicantFilterDisclosure,{activeCount:0,headerAction:createElement('button',null,'Download')},createElement('button',null,'Top 10 AI matches')));
 const body=html.indexOf('class="hub-extra-filters-body"');assert.ok(body>0);assert.ok(html.indexOf('Download')<body);assert.ok(html.indexOf('Top 10 AI matches')>body);assert.equal((html.match(/Top 10 AI matches/g)||[]).length,1);
});

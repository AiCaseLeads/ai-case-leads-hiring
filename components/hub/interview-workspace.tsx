"use client";
import type { InterviewProgress } from '../../lib/hub/interview-progress';
import { interviewProgressLabels } from './interview-progress';
import {useState} from 'react';
import {useHubResource,useHubMutation,displayDate} from './api';
import {Feedback,ResourceState} from './shared';
type ImportedMeeting={meetingId:string;title:string;start:string;applicationId:string|null;status:string;reason:string};
export function RecordingPanel({applicationId,recordingUrl,primaryRecordingInHandoff=false,changed,refresh=0}:{applicationId:string;recordingUrl?:string;primaryRecordingInHandoff?:boolean;changed?:()=>void;refresh?:number}){const review=useHubResource<{recordingUrl?:string}>('/api/hub/applications/'+encodeURIComponent(applicationId)+'/recruiter-review',refresh);recordingUrl=recordingUrl||review.data?.recordingUrl;const uploads=useHubResource<{id:string;filename:string;url:string}[]>('/api/hub/interview-recordings?applicationId='+encodeURIComponent(applicationId),refresh);const resource=useHubResource<ImportedMeeting[]>('/api/hub/meetgeek/meetings',refresh),mutation=useHubMutation();const [meeting,setMeeting]=useState(''),[uploading,setUploading]=useState(false),[error,setError]=useState('');async function attach(){const result=await mutation.run('/api/hub/meetgeek/meetings/'+encodeURIComponent(meeting)+'/attach','POST',{applicationId},'Interview recording attached.');if(result!==undefined){resource.reload();review.reload();uploads.reload();changed?.();}}async function upload(file:File){setUploading(true);setError('');try{if(file.size>100*1024*1024)throw new Error('Direct uploads support up to 100 MB. Use a MeetGeek recording or paste a recording link for larger files.');const response=await fetch('/api/hub/interview-recordings?applicationId='+encodeURIComponent(applicationId),{method:'POST',credentials:'same-origin',headers:{'Content-Type':file.type,'X-File-Name':encodeURIComponent(file.name),'X-File-Size':String(file.size)},body:file});const body=await response.json() as {error?:{message?:string}};if(!response.ok)throw new Error(body.error?.message||'Recording upload failed.');review.reload();uploads.reload();changed?.();}catch(e){setError(e instanceof Error?e.message:'Upload failed.');}finally{setUploading(false);}}return <section className="hub-interview-recording"><Feedback error={error||mutation.error} success={mutation.success}/><RecordingEvidence recordingUrl={recordingUrl} uploads={uploads.data||[]} primaryRecordingInHandoff={primaryRecordingInHandoff}/><details><summary>{recordingUrl?'Attach another recording':'Attach a recording'}</summary><label>Upload audio or video<input type="file" accept="audio/mpeg,audio/wav,audio/mp4,video/mp4,audio/webm,video/webm" disabled={uploading} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.target.value='';}}/></label><small>{uploading?'Uploading…':'MP3, WAV, M4A, MP4 or WebM · up to 100 MB. For larger files, paste a recording link in the review form.'}</small><label>MeetGeek meeting ID<input value={meeting} onChange={e=>setMeeting(e.target.value.trim())} placeholder="Meeting ID from MeetGeek"/></label><button className="hub-button secondary" disabled={!meeting||mutation.busy} onClick={()=>void attach()}>Attach MeetGeek interview</button>{resource.data?.filter(m=>m.applicationId===applicationId||m.status==='needs_match').slice(0,10).map(m=><div key={m.meetingId} style={{borderTop:'1px solid #dce6e7',padding:'8px 0'}}><strong>{m.title}</strong><small> · {m.start?displayDate(Date.parse(m.start)):''}</small>{m.status==='needs_match'?<button className="hub-text-button" onClick={()=>setMeeting(m.meetingId)}>Choose this meeting</button>:<a href={'/api/hub/meetgeek/meetings/'+encodeURIComponent(m.meetingId)+'/recording'} target="_blank" rel="noreferrer">Open recording</a>}</div>)}</details></section>}
type UploadedRecording={id:string;filename:string;url:string};
/** The handoff already links its main recording; keep only distinct attachments here. */
export function RecordingEvidence({recordingUrl,uploads,primaryRecordingInHandoff=false}:{recordingUrl?:string;uploads:UploadedRecording[];primaryRecordingInHandoff?:boolean}){
 return <>{recordingUrl&&<>{(recordingUrl.startsWith("/api/hub/")||/\.(mp4|webm|mp3|m4a|wav)(\?|$)/i.test(recordingUrl))&&<video controls preload="none" src={recordingUrl} style={{width:'100%',maxHeight:360,background:'#102f35',borderRadius:8}}/>}{!primaryRecordingInHandoff&&<a href={recordingUrl} target="_blank" rel="noreferrer">Open recording</a>}</>}{uploads.filter(file=>!primaryRecordingInHandoff||file.url!==recordingUrl).map(file=><p key={file.id}><a href={file.url} target="_blank" rel="noreferrer">{file.filename}</a></p>)}</>;
}
type InterviewItem = {
  id: string; applicationId: string; name?: string; jobTitle?: string; jobId?: string;
  start?: string; interviewProgress: InterviewProgress; meetUrl?: string; recordingUrl?: string;
};
type WorkspaceProps = {
  jobId?: string; refresh?: number; changed?: () => void;
  jobs?: {id: string; title: string}[]; openApplicant?: (id: string) => void;
};

export function InterviewWorkspace({jobId, refresh=0, openApplicant, jobs}: WorkspaceProps) {
  const initial = {jobId, role:jobId || '', progress:'', page:1};
  const [selection,setSelection] = useState(initial);
  const current = selection.jobId === jobId ? selection : initial;
  const {role, progress, page} = current;
  const params = new URLSearchParams({page:String(page),pageSize:'50'});
  if (role) params.set('jobId',role);
  if (progress) params.set('progress',progress);
  const resource = useHubResource<{items:InterviewItem[]; total:number; page:number; pageSize:number}>(
    '/api/hub/interviews?' + params,refresh);
  return <section className="hub-card">
    <div className="hub-section-heading compact">
      <h2>Interviews</h2>
      {jobs && <label>Role<select aria-label="Role" value={role} onChange={event=>setSelection({...current,role:event.target.value,page:1})}>
        <option value="">All roles</option>
        {jobs.map(job=><option value={job.id} key={job.id}>{job.title}</option>)}
      </select></label>}
      <label>Interview status<select aria-label="Interview status" value={progress} onChange={event=>setSelection({...current,progress:event.target.value,page:1})}>
        <option value="">All interviews</option>
        {Object.entries(interviewProgressLabels).filter(([value])=>value!=='none').map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select></label>
    </div>
    <ResourceState loading={resource.loading} error={resource.error} retry={resource.reload}/>
    {resource.data?.items.length===0 && <p>No matching interviews.</p>}
    <div className="hub-interview-list">
      {resource.data?.items.map(item=><article key={item.id} style={{display:'flex',gap:16,alignItems:'center',flexWrap:'wrap',borderTop:'1px solid #dce6e7',padding:'12px 0'}}>
        <div style={{flex:1,minWidth:180}}>
          <a href={'/team?view=applications&application='+encodeURIComponent(item.applicationId)+(item.jobId?'&jobId='+encodeURIComponent(item.jobId):'')} onClick={openApplicant?event=>{
            if(event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
            event.preventDefault();openApplicant(item.applicationId);
          }:undefined}><strong>{item.name || 'View applicant'}</strong></a>
          <small style={{display:'block'}}>{item.jobTitle}</small>
        </div>
        {item.start && <span>{displayDate(Date.parse(item.start))}</span>}
        <span className="hub-badge">{interviewProgressLabels[item.interviewProgress]}</span>
        {item.meetUrl && item.interviewProgress==='booked' && <a href={item.meetUrl} target="_blank" rel="noreferrer">Join Meet</a>}
        {item.recordingUrl && <a href={item.recordingUrl} target="_blank" rel="noreferrer">Recording</a>}
      </article>)}
    </div>
    {resource.data && <nav className="hub-button-row" aria-label="Interview pages">
      <span className="hub-muted">{resource.data.total===0?'0 interviews':`${(page-1)*resource.data.pageSize+1}–${Math.min(page*resource.data.pageSize,resource.data.total)} of ${resource.data.total} interviews`}</span>
      <button className="hub-button secondary" disabled={resource.loading || page<=1} onClick={()=>setSelection({...current,page:page-1})}>Previous</button>
      <button className="hub-button secondary" disabled={resource.loading || page*resource.data.pageSize>=resource.data.total} onClick={()=>setSelection({...current,page:page+1})}>Next</button>
    </nav>}
  </section>;
}

export {MeetGeekSettings} from "./meetgeek-settings";

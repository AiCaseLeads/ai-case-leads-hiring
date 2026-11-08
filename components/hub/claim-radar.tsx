import type {AiMatchDetail} from '../../lib/ai/matchtypes';
import type {ApplicationDetail} from './types';

export function ClaimRadar({detail}:{detail:ApplicationDetail}){
 const match=detail.aiMatch as AiMatchDetail|undefined;
 const findings=match?.status==='ready'?match.criteria?.filter(c=>c.status==='needs_verification' && new Set(c.citations.map(s=>s.source)).size>=2)??[]:[];
 const differences=detail.relatedApplications?.flatMap(a=>a.differences)??[];
 const level=findings.length && differences.length?'High':findings.length || differences.length?'Medium':match?.status==='ready'?'Low':'Not assessed';
 return <details key={detail.id}><summary>Claim review · {level}{level==='Not assessed'?'':' priority'}</summary>
 <p>{level==='High'?'Check both the application history and the source excerpts.':level==='Medium'?'Ask about the differences below before drawing a conclusion.':level==='Low'?'No discrepancy flagged in the comparisons available.':'No completed source comparison is available.'}</p>
 {!!differences.length && <p>Compare the dated answers under “other applications with this email.”</p>}
 {findings.map(c=><div key={c.criterion}><strong>{c.criterion}</strong><p>{c.explanation}</p>{c.citations.map((s,i)=><blockquote key={i}>{s.source==='answers'?'Application':s.source==='resume'?'Résumé':'LinkedIn'}: {s.quote}</blockquote>)}</div>)}
 <small>Review priority only. Writing style and repeat applications do not count as evidence of dishonesty.</small></details>;
}

"use client";
import { ArrowRight } from "lucide-react";
import { useHubResource } from "./api";
import { NavigationLink, applicantHref } from "./navigation-link";
import { Badge, ResourceState } from "./shared";
import { stageLabel, type ApplicationSummary } from "./types";

interface QueueData {
  canApprove: boolean;
  reviewQueue: ApplicationSummary[];
  myQueue: ApplicationSummary[];
  unassigned: ApplicationSummary[];
  returned?: ApplicationSummary[];
  counts: {awaitingReview: number; myUnreviewed: number; unassigned: number; returned?: number};
}
interface HomeProps {
  refresh: number;
  reviewerEmail: string;
  open: (id: string, filter: string, section: "application" | "review") => void;
  openQueue: (filter: string) => void;
}
interface Queue {
  name: string; filter: string; section: "review" | "application";
  count: number; items: ApplicationSummary[]; empty: string;
}
export function WorkflowHome({refresh,open,openQueue,reviewerEmail}: HomeProps) {
  const resource = useHubResource<QueueData>("/api/hub/workflow/overview", refresh);
  const data = resource.data;
  if (!data || resource.loading) return <ResourceState loading={resource.loading} error={resource.error} retry={() => void resource.reload()}/>;
  const assigned = {name:"My new applicants",items:data.myQueue,count:data.counts.myUnreviewed,
    filter:new URLSearchParams({stage:"Application Review",assignee:reviewerEmail,sort:"screening_newest"}).toString(),
    section:"application",empty:"No new applications assigned to you."} satisfies Queue;
  const claim = {name:"Available to claim",items:data.unassigned,count:data.counts.unassigned,
    filter:"stage=Application+Review&assignee=unassigned&sort=screening_newest",
    section:"application",empty:"Every new application has an owner."} satisfies Queue;
  const decisions = {name:"Awaiting founder review",items:data.reviewQueue,count:data.counts.awaitingReview,
    filter:"stage=Awaiting+Founder+Review&sort=newest",section:"review",empty:"No handoffs are waiting for a decision."} satisfies Queue;
  const returned = {name:data.canApprove ? "Returned to recruiters" : "Returned to me",items:data.returned || [],count:data.counts.returned || 0,
    filter:new URLSearchParams({handoffReturned:"true",sort:"newest",...(data.canApprove?{}:{assignee:reviewerEmail})}).toString(),
    section:"review",empty:"No handoffs need more information."} satisfies Queue;
  const queues = data.canApprove ? [decisions, returned, assigned, claim] : [assigned, claim, returned, decisions];
  const primary = data.canApprove ? [decisions,returned] : [assigned,claim];
  return <section className="hub-workflow-home">
    <nav aria-label="Applicant queues" className="work-queue-links">
      {queues.map(queue=><NavigationLink key={queue.name} href={"/team?view=applications&"+queue.filter} navigate={()=>openQueue(queue.filter)}>
        <span>{queue.name}</span><strong>{queue.count.toLocaleString()}</strong><ArrowRight aria-hidden="true" size={15}/>
      </NavigationLink>)}
    </nav>
    <div className="hub-overview-columns">
      {primary.map(queue=><section className="hub-card" key={queue.name}>
        <div className="hub-section-heading compact"><h2>{queue.name}</h2>
          {queue.count>0&&<NavigationLink href={"/team?view=applications&"+queue.filter} navigate={()=>openQueue(queue.filter)} className="hub-text-button" aria-label={"View all "+queue.name.toLowerCase()}>View all</NavigationLink>}
        </div>
        {queue.items.length ? <ul className="hub-activity-list">{queue.items.slice(0,6).map(item=>{
          const href=applicantHref(item.id,queue.filter);
          return <li key={item.id}><NavigationLink href={href} navigate={()=>open(item.id,queue.filter,queue.section)} className="hub-object-link">{item.name}</NavigationLink>
            <p>{item.jobTitle}</p><div className="hub-button-row"><Badge>{stageLabel(item.stage)}</Badge>{item.notesReview?.hasUnread&&<Badge tone="warning">Unread notes</Badge>}</div></li>;
        })}</ul>:<p className="hub-muted">{queue.empty}</p>}
      </section>)}
    </div>
    {!data.canApprove&&returned.count>0&&<NavigationLink className="hub-text-button" href={"/team?view=applications&"+returned.filter} navigate={()=>openQueue(returned.filter)}>Answer requested handoff questions <ArrowRight size={15}/></NavigationLink>}
  </section>;
}

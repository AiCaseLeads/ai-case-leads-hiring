"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useHubResource } from "./api";
import { NavigationLink } from "./navigation-link";
import { EmptyState, ResourceState } from "./shared";

import type { ApplicantRole } from "../../lib/hub/applicant-roles";

function initialReviewQuery(role: ApplicantRole) {
  const query = new URLSearchParams({openPostings:"true", stage:"Application Review", active:"false", sort:"screening_newest"});
  if (role.jobGroupId) query.set("jobGroupId", role.jobGroupId);
  else if (role.jobId) query.set("jobId", role.jobId);
  return query.toString();
}

function locationSummary(role: ApplicantRole) {
  const locations = role.locations.filter(Boolean);
  const place = locations.length > 3
    ? locations.slice(0, 3).join(", ") + " +" + (locations.length - 3) + " more"
    : locations.join(", ");
  return [place, role.postingCount > 1 ? role.postingCount + " postings" : ""].filter(Boolean).join(" · ");
}

export function ApplicantRoleDirectory({refresh, onOpen}: {refresh: number; onOpen: (filter: string) => void}) {
  const resource = useHubResource<{roles: ApplicantRole[]}>("/api/hub/applicant-roles", refresh);
  const [search, setSearch] = useState("");
  const term = search.trim().toLocaleLowerCase();
  const roles = resource.data?.roles || [];
  const visible = roles.filter(role => [role.name, ...role.locations].some(value => value.toLocaleLowerCase().includes(term)));
  const all = "active=false";
  return <section className="applicant-role-directory" aria-labelledby="active-role-title">
    <header className="ard-heading">
      <div><h2 id="active-role-title">Active roles</h2><p>Choose a role to review its new applications.</p></div>
      <NavigationLink href={"/team?view=applications&"+all} navigate={()=>onOpen(all)} className="hub-text-button">All applicants</NavigationLink>
    </header>
    <ResourceState error={resource.error} loading={resource.loading} retry={()=>void resource.reload()}/>
    {resource.data && <>
      {roles.length > 0 && <label className="ard-search"><span className="sr-only">Search active roles</span>
        <input type="search" placeholder="Search roles or locations" value={search} onChange={event=>setSearch(event.target.value)}/>
      </label>}
      {visible.length ? <ul className="ard-list" aria-label="Active roles">{visible.map(role=>{
        const query = initialReviewQuery(role);
        const subtitle = locationSummary(role);
        return <li key={role.jobGroupId ? "group:"+role.jobGroupId : "job:"+role.jobId}>
          <NavigationLink href={"/team?view=applications&"+query} navigate={()=>onOpen(query)} className="ard-role">
            <span className="ard-identity"><strong>{role.name}</strong>{subtitle && <small>{subtitle}</small>}</span>
            <span className={"ard-count"+(role.reviewCount === 0 ? " ard-count-empty" : "")}>{role.reviewCount.toLocaleString()} to review</span>
            <ChevronRight size={16} aria-hidden="true"/>
          </NavigationLink>
        </li>;
      })}</ul> : <EmptyState title={term ? "No matching roles" : "No active roles"}>
        {term ? <button type="button" className="hub-text-button" onClick={()=>setSearch("")}>Clear search</button> :
          <p>Use All applicants to review applications from past postings.</p>}
      </EmptyState>}
    </>}
  </section>;
}

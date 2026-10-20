import {SharedApplicant} from "@/components/hub/shared-applicant";
import "@/components/hub/hub.css";
export const dynamic="force-dynamic";
export const metadata={title:"Shared applicant | AI Case Leads",robots:"noindex,nofollow,noarchive",referrer:"no-referrer"};
export default async function SharedApplicantPage({params}:{params:Promise<{token:string}>}){const{token}=await params;return <SharedApplicant token={token}/>;}

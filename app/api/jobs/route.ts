import { getJobs } from "@/lib/hiring/http";
import { hiringDependencies } from "@/lib/hiring/runtime";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return getJobs(request, hiringDependencies(request)); }

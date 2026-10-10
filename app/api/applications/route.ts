import { postApplication } from "@/lib/hiring/http";
import { hiringDependencies } from "@/lib/hiring/runtime";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return postApplication(request, hiringDependencies(request)); }

import { getJob } from "@/lib/hiring/http";
import { hiringDependencies } from "@/lib/hiring/runtime";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return getJob(request, slug, hiringDependencies(request));
}

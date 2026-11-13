import {postJobForm} from '@/lib/hiring/http';
import {hiringDependencies} from '@/lib/hiring/runtime';
export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{slug:string}>}){return postJobForm(request,(await context.params).slug,hiringDependencies(request));}

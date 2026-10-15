import { getVerification, postVerification } from '@/lib/hiring/http';
import { hiringDependencies } from '@/lib/hiring/runtime';
export async function GET() { return getVerification(); }
export async function POST(request: Request) { return postVerification(request,hiringDependencies(request)); }

import {getHubStore} from '@/lib/hub/runtime';
import {errorResponse} from '@/lib/hiring/http';
import {receiveMeetGeekWebhook} from '@/lib/meetgeek/service';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{return await receiveMeetGeekWebhook(request,await getHubStore(request));}catch(error){return errorResponse(error);}}

import { HubStore } from '@/lib/hub/store';
import { workspaceEnv } from '@/lib/workspace-config';
import { HiringError } from '@/lib/hiring/errors';
import { handleSendgridEventWebhook } from '@/lib/email/sendgrid-events';
export const dynamic = 'force-dynamic';
/** Signature authorization and body validation run before opening private storage. */
export async function POST(request: Request) {
  return handleSendgridEventWebhook(request, async () => {
    const bindings=workspaceEnv();
    if(!bindings.DB)throw new HiringError('database_unavailable',503,'The hiring database is unavailable.');
    return new HubStore(bindings.DB,{origin:bindings.PUBLIC_SITE_ORIGIN});
  }, process.env.SENDGRID_WEBHOOK_PUBLIC_KEY);
}

import { getHubStore } from "@/lib/hub/runtime";
import { handleSendgridEventWebhook } from "@/lib/email/sendgrid-events";

export const dynamic = "force-dynamic";
/** SendGrid authenticates through its signature, not a recruiter's browser session. */
export async function POST(request: Request) {
  return handleSendgridEventWebhook(request, () => getHubStore(request), process.env.SENDGRID_WEBHOOK_PUBLIC_KEY);
}

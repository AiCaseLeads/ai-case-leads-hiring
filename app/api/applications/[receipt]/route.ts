import { getReceipt } from "@/lib/hiring/http";
import { hiringDependencies } from "@/lib/hiring/runtime";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ receipt: string }> }) {
  const { receipt } = await context.params;
  return getReceipt(receipt, hiringDependencies());
}

import { SecureCandidatePage } from "@/components/hub/candidate";
import "@/components/hub/hub.css";
export const metadata = {
  title: "Interview booking | AI Case Leads",
  robots: "noindex,nofollow",
  referrer: "no-referrer",
};
export default async function InterviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SecureCandidatePage token={token} kind="interview" />;
}

import { ApplicationConfirmation } from "@/components/careers/experience";
export const metadata = {
  title: "Application status",
  robots: "noindex, nofollow",
  referrer: "no-referrer",
};
export default async function ConfirmationPage({
  params,
}: {
  params: Promise<{ receipt: string }>;
}) {
  const { receipt } = await params;
  return <ApplicationConfirmation receipt={receipt} />;
}

import { CareerDetail } from "@/components/careers/experience";
export default async function JobPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <CareerDetail slug={slug} />;
}

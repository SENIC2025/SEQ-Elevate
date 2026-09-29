import { permanentRedirect } from "next/navigation";

/**
 * Old address of a preview mock-up that no longer exists. Kept as a permanent
 * redirect so saved links land on the authoring page instead of a 404.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/content`);
}

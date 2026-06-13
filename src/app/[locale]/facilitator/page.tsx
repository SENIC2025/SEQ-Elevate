import { setRequestLocale } from "next-intl/server";
import { getProjectLearners } from "@/lib/server-queries";
import type { Locale } from "@/lib/cms/types";
import { FacilitatorWorkspace } from "@/components/role/FacilitatorWorkspace";
import { RealFacilitatorView } from "@/components/role/RealFacilitatorView";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const loc = (["en", "de", "el"].includes(locale) ? locale : "en") as Locale;
  // Staff (FACILITATOR/ADMIN) see real DB learners; guests/demo see the mock.
  const realLearners = await getProjectLearners(loc);
  return realLearners ? (
    <RealFacilitatorView learners={realLearners} />
  ) : (
    <FacilitatorWorkspace />
  );
}

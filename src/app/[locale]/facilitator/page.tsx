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
  // Staff (FACILITATOR/ADMIN) see real DB learners; everyone else gets a note
  // that the workspace is for staff.
  const realLearners = await getProjectLearners(loc);
  // The time the learners were read, for "Active in the last 24h": this
  // server component runs once per request (it reads the session), so the
  // page as sent and the page once it runs count from the same moment.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  return realLearners ? (
    <RealFacilitatorView learners={realLearners} now={now} />
  ) : (
    <FacilitatorWorkspace />
  );
}

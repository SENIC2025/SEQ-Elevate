import { setRequestLocale } from "next-intl/server";
import { getProjectLearners, scopeOrganisationName } from "@/lib/server-queries";
import { getViewer } from "@/lib/scope";
import { canSupportLearners, seesWholeProject } from "@/lib/permissions";
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
  // Staff see the learners of their scope (D74): an ADMIN the whole
  // project, a facilitator or partner admin their organisation's. Anyone
  // with no scope gets a note that the workspace is for staff, and staff
  // whose account isn't linked to an organisation are told so.
  const viewer = await getViewer();
  const [realLearners, organisation] = await Promise.all([
    getProjectLearners(viewer.scope, loc),
    scopeOrganisationName(viewer.scope),
  ]);
  if (!realLearners) {
    const noOrganisation =
      canSupportLearners(viewer.roles) &&
      !seesWholeProject(viewer.roles) &&
      !viewer.profile?.organisationId;
    return <FacilitatorWorkspace noOrganisation={noOrganisation} />;
  }
  // The time the learners were read, for "Active in the last 24h": this
  // server component runs once per request (it reads the session), so the
  // page as sent and the page once it runs count from the same moment.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  return <RealFacilitatorView learners={realLearners} now={now} organisation={organisation} />;
}

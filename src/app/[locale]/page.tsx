import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { LandingPage } from "@/components/role/LandingPage";
import { ProductionLanding } from "@/components/ProductionLanding";
import { WorkspaceHub } from "@/components/WorkspaceHub";
import { getCurrentUser, getProjectMemberships } from "@/lib/auth-helpers";
import { workspacesFor } from "@/lib/workspaces";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Signed in → "Your workspaces", built from real roles (D26). A DB hiccup
  // falls back to the public front door rather than an error page.
  let user: Awaited<ReturnType<typeof getCurrentUser>> = null;
  let roles: Awaited<ReturnType<typeof getProjectMemberships>> = [];
  try {
    user = await getCurrentUser();
    if (user) roles = await getProjectMemberships("seq-elevate");
  } catch {
    user = null;
  }
  if (user) {
    const workspaces = workspacesFor(roles.map((m) => m.role));
    // Most learners have exactly one workspace — skip a menu of one.
    // (Outside the try: redirect() works by throwing.)
    if (workspaces.length === 1) redirect(`/${locale}${workspaces[0].href}`);
    return (
      <WorkspaceHub workspaces={workspaces} name={user.name || user.email || ""} />
    );
  }

  // Signed out. The launch switch (GO-LIVE §2) flips the front door: real prod
  // shows the welcome + magic-link sign-in; demo deploys keep the role picker.
  const production = process.env.DEMO_LOGIN_DISABLED === "true";
  return production ? <ProductionLanding /> : <LandingPage />;
}

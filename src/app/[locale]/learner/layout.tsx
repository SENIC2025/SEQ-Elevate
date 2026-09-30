import { setRequestLocale } from "next-intl/server";
import { AppHeader } from "@/components/AppHeader";
import { getCurrentUser } from "@/lib/auth-helpers";
import { LearnerView } from "@/store/demo-state";

export default async function LearnerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Whom this is rendered for, so the page can tell a refresh landed.
  const user = await getCurrentUser();
  return (
    <div className="flex-1 flex flex-col">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        {/* Starts over when the store lets go of the learner's data. */}
        <LearnerView renderedFor={user?.id ?? null}>{children}</LearnerView>
      </main>
    </div>
  );
}

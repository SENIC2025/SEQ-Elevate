import { setRequestLocale } from "next-intl/server";
import { AppHeader } from "@/components/AppHeader";
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
  return (
    <div className="flex-1 flex flex-col">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        {/* Starts over when the store lets go of the learner's data. */}
        <LearnerView>{children}</LearnerView>
      </main>
    </div>
  );
}

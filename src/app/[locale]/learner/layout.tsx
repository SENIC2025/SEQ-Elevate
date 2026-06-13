import { setRequestLocale } from "next-intl/server";
import { AppHeader } from "@/components/AppHeader";

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
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">{children}</main>
      <footer className="border-t border-[var(--border)] py-4 text-center text-xs text-[var(--muted-foreground)]">
SEQ Elevate · platform shell demo · Created and Powered by SENIC · senic.world
      </footer>
    </div>
  );
}

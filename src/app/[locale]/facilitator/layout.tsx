import { setRequestLocale } from "next-intl/server";
import { AppHeader } from "@/components/AppHeader";
import { requireCompleteProfile } from "@/lib/auth-helpers";

export default async function FacilitatorLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Release 3 (spec 5.3): someone signed in does the profile step first.
  await requireCompleteProfile(locale);
  return (
    <div className="flex-1 flex flex-col">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">{children}</main>
    </div>
  );
}

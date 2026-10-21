import { setRequestLocale } from "next-intl/server";
import { AppHeader } from "@/components/AppHeader";
import { ProfileNotSaving } from "@/components/profile/ProfileNotSaving";
import { SafeguardingBox } from "@/components/safeguarding/SafeguardingBox";

export default async function AccountLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Not gated by the profile step (spec 5.3): someone who won't accept the
  // Terms can still download their data and delete their account here.
  return (
    <div className="flex-1 flex flex-col">
      <AppHeader />
      <ProfileNotSaving />
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">{children}</main>
      <SafeguardingBox />
    </div>
  );
}

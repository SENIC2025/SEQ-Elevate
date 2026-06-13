import { setRequestLocale } from "next-intl/server";
import { AppHeader } from "@/components/AppHeader";

export default async function ContentLayout({
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
      <main className="flex-1">{children}</main>
    </div>
  );
}

import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { BrandLogo } from "@/components/BrandLogo";
import { MailCheck } from "lucide-react";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth");

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--background)] px-4">
      <BrandLogo variant="lockup" width={200} className="mb-8" />

      <Card className="w-full max-w-sm text-center">
        <CardContent className="p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)]">
            <MailCheck className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-xl font-bold">{t("checkEmailTitle")}</h1>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            {t("checkEmailBody")}
          </p>
          <Link
            href="/signin"
            className="mt-6 inline-block text-sm text-[var(--accent)] hover:underline"
          >
            {t("tryDifferentEmail")}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

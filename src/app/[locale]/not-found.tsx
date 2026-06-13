import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Compass, Home } from "lucide-react";

export default async function NotFound() {
  const t = await getTranslations("system");
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)]">
        <Compass className="h-7 w-7" />
      </div>
      <h1 className="mt-5 text-2xl font-bold tracking-tight">
        {t("notFoundTitle")}
      </h1>
      <p className="mt-2 max-w-sm text-[var(--muted-foreground)]">
        {t("notFoundBody")}
      </p>
      <Link href="/" className="mt-6">
        <Button>
          <Home className="h-4 w-4" />
          {t("goHome")}
        </Button>
      </Link>
    </main>
  );
}

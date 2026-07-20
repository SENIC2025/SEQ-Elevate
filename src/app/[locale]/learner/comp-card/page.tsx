import { setRequestLocale } from "next-intl/server";
import { CompCard } from "@/components/comp-card/CompCard";
import { getCompCardTemplate } from "@/lib/cms";
import type { Locale } from "@/lib/cms/types";

// The Comp Card wording is editable in the CMS, so resolve it per request.
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const loc = (["en", "de", "el"].includes(locale) ? locale : "en") as Locale;
  const template = await getCompCardTemplate("seq-elevate", loc);
  return <CompCard template={template} />;
}

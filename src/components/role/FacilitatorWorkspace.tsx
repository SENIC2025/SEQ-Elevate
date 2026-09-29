import { useTranslations } from "next-intl";
import { Users } from "lucide-react";

/**
 * The facilitator workspace for someone who isn't a facilitator or admin.
 * Staff get RealFacilitatorView (see the facilitator page); everyone else
 * sees who the workspace is for — never any learner data.
 */
export function FacilitatorWorkspace() {
  const t = useTranslations("facilitator");

  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
        <Users className="h-6 w-6" />
      </div>
      <h1 className="text-xl font-bold">{t("title")}</h1>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        {t("staffOnly")}
      </p>
    </div>
  );
}

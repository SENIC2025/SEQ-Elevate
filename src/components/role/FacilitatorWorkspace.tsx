import { useTranslations } from "next-intl";
import { Users } from "lucide-react";
import { SignInPrompt } from "@/components/SignInPrompt";

/**
 * The facilitator workspace for someone who sees no learners: not a
 * facilitator or admin, or staff whose scope is none (the facilitator
 * page). Says who the workspace is for — never any learner data — and,
 * for staff whose account isn't linked to an organisation, why
 * (`noOrganisation`, spec 6.4).
 */
export function FacilitatorWorkspace({ noOrganisation = false }: { noOrganisation?: boolean }) {
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
      {noOrganisation ? (
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">{t("noOrganisation")}</p>
      ) : null}
      <SignInPrompt />
    </div>
  );
}

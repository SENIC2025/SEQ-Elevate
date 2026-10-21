"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useDemoState } from "@/store/demo-state";

/**
 * Release 3 (D79, spec 5.5): said on the learner and account pages when
 * the learner store stopped because the profile step isn't done — nothing
 * of the person's is saved meanwhile. With the profile gate on people
 * rarely see it (they are on /welcome); with R3_PROFILE_GATE=off it is what
 * everyone without a complete profile sees while they browse and play.
 *
 * A polite live region, there from the first render, between the header
 * and <main> (the recorded walk reads <main>).
 */
export function ProfileNotSaving() {
  const t = useTranslations("profile");
  const { profileIncomplete } = useDemoState();
  return (
    <div role="status" className="empty:hidden">
      {profileIncomplete ? (
        <p className="mx-auto max-w-6xl px-4 pt-4 text-sm">
          <span className="block rounded-lg border border-[var(--warning)]/50 bg-[var(--warning)]/10 px-4 py-3">
            {t.rich("notSaving", {
              welcome: (chunks) => (
                <Link href="/welcome" className="font-medium underline">
                  {chunks}
                </Link>
              ),
            })}
          </span>
        </p>
      ) : null}
    </div>
  );
}

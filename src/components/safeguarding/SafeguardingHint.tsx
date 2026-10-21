import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * One calm line beside what learners write (D93, spec 11.3): under the
 * Comp Card's free-text fields, and (variant "reflection") after a
 * reflection's intro, where it also says that facilitators don't read
 * reflections, so a disclosure there reaches nobody. Links /help.
 *
 * A paragraph with one link, in the page's language: the recorded walk
 * expects it in exactly this shape after a reflection's intro (R3-D1,
 * e2e/fixtures/r3-deltas.ts). Streams B and E place it. No hooks but
 * translations, so it renders in server and client components.
 */
export function SafeguardingHint({ variant = "default" }: { variant?: "default" | "reflection" }) {
  const t = useTranslations("safeguarding");
  return (
    <p className="mt-3 text-xs text-[var(--muted-foreground)]">
      {t.rich(variant === "reflection" ? "hintReflection" : "hint", {
        help: (chunks) => (
          <Link href="/help" className="underline hover:text-[var(--foreground)]">
            {chunks}
          </Link>
        ),
      })}
    </p>
  );
}

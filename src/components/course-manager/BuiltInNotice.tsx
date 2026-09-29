import { useTranslations } from "next-intl";
import { Info } from "lucide-react";

/**
 * Shown on a built-in course's reflection and interactive lessons, which
 * come with the platform (code and translations) — the server refuses edits
 * to them (structure.ts), so the page says so instead of offering an editor
 * that can't save (D33). Video and documents stay editable.
 */
export function BuiltInNotice() {
  const t = useTranslations("courseManager.page");
  return (
    <p
      role="note"
      className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--muted-foreground)]"
    >
      <Info
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--accent)]"
        aria-hidden
      />
      {t("builtInNotice")}
    </p>
  );
}

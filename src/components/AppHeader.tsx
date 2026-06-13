"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useDemoState } from "@/store/demo-state";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { AccessibilityToolbar } from "./a11y/AccessibilityToolbar";
import { Sparkles, LogOut } from "lucide-react";

export function AppHeader({ showRoleSwitch = true }: { showRoleSwitch?: boolean }) {
  const t = useTranslations("common");
  const tRoles = useTranslations("roles");
  const { state, dispatch } = useDemoState();

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--primary)] text-[var(--primary-foreground)]">
            <Sparkles className="h-4 w-4" />
          </span>
          <span>{t("appName")}</span>
        </Link>
        <div className="flex items-center gap-2">
          {showRoleSwitch && state.role ? (
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5 text-xs text-[var(--muted-foreground)]">
              <span>{tRoles(state.role)}</span>
            </span>
          ) : null}
          {showRoleSwitch && state.role ? (
            <button
              type="button"
              onClick={() => dispatch({ type: "setRole", role: null })}
              className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm hover:bg-[var(--surface-muted)]"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{t("switchRole")}</span>
            </button>
          ) : null}
          <LanguageSwitcher />
          <AccessibilityToolbar />
        </div>
      </div>
    </header>
  );
}

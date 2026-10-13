"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSession, signOut } from "next-auth/react";
import { Link, usePathname } from "@/i18n/navigation";
import { useDemoState } from "@/store/demo-state";
import {
  WORKSPACE_HREF,
  workspaceForPath,
  type WorkspaceId,
} from "@/lib/workspaces";
import { WORKSPACE_ICONS } from "./workspace-icons";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { AccessibilityToolbar } from "./a11y/AccessibilityToolbar";
import { BrandLogo } from "./BrandLogo";
import {
  LogOut,
  UserRound,
  LayoutGrid,
  ChevronDown,
  Check,
} from "lucide-react";

/**
 * The header's client half. `workspaces` comes from the server wrapper
 * (AppHeader) and reflects the viewer's REAL roles; with two or more, a
 * workspace switcher lets staff jump between "Create courses", "Manage
 * people", etc. from any page.
 */
export function AppHeaderClient({
  showRoleSwitch = true,
  workspaces = [],
}: {
  showRoleSwitch?: boolean;
  workspaces?: WorkspaceId[];
}) {
  const t = useTranslations("common");
  const tAuth = useTranslations("auth");
  const tRoles = useTranslations("roles");
  const { state, dispatch } = useDemoState();
  const { data: session, status } = useSession();
  const authed = status === "authenticated";
  // Staff get the workspace switcher too. Words join the icons as the screen
  // widens (md: product name, workspace; lg: sign out; xl: email), so the
  // header never scrolls sideways, from a 320px phone up (WCAG 1.4.10), in
  // any language. Signed in, the product name needs 360px; the logo stays,
  // and the sides and gaps tighten below that.
  // Hidden words stay as each control's accessible name.
  const crowded = authed && workspaces.length > 1;
  const nameClass = crowded
    ? "sr-only md:not-sr-only"
    : authed
      ? "sr-only min-[360px]:not-sr-only"
      : undefined;

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur">
      {/* Below 360px the sides and gaps tighten, so a staff header with the
          workspace menu still fits a 320px phone. */}
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-1.5 px-3 py-3 min-[360px]:gap-2 min-[360px]:px-4">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <BrandLogo variant="mark" width={21} className="shrink-0" />
          <span className={nameClass}>{t("appName")}</span>
        </Link>
        <div className="flex items-center gap-1.5 min-[360px]:gap-2">
          {authed ? (
            <>
              {crowded ? (
                <WorkspaceSwitcher workspaces={workspaces} />
              ) : null}
              <Link
                href="/account"
                aria-label={t("account")}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] max-w-[200px] hover:bg-[var(--surface)]"
              >
                <UserRound className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="hidden xl:inline truncate">
                  {session?.user?.email}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/" })}
                className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm hover:bg-[var(--surface-muted)]"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                <span className="sr-only lg:not-sr-only">{tAuth("signOut")}</span>
              </button>
            </>
          ) : showRoleSwitch && state.role ? (
            <>
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5 text-xs text-[var(--muted-foreground)]">
                {tRoles(state.role)}
              </span>
              <button
                type="button"
                onClick={() => dispatch({ type: "setRole", role: null })}
                className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm hover:bg-[var(--surface-muted)]"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">{t("switchRole")}</span>
              </button>
            </>
          ) : null}
          <LanguageSwitcher />
          <AccessibilityToolbar />
        </div>
      </div>
    </header>
  );
}

/**
 * A disclosure menu of the viewer's workspaces. Native <details> keeps it
 * keyboard- and screen-reader-friendly; we add the two things it lacks —
 * closing on an outside click and on Escape.
 */
function WorkspaceSwitcher({ workspaces }: { workspaces: WorkspaceId[] }) {
  const t = useTranslations("hub");
  const pathname = usePathname();
  const current = workspaceForPath(pathname);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      ref.current?.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const CurrentIcon = current ? WORKSPACE_ICONS[current] : LayoutGrid;
  const label = current ? t(`${current}.title`) : t("switcherLabel");

  return (
    <details
      ref={ref}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="relative"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm hover:bg-[var(--surface-muted)] [&::-webkit-details-marker]:hidden">
        <CurrentIcon className="h-4 w-4" aria-hidden />
        <span className="sr-only md:not-sr-only">{label}</span>
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </summary>
      <nav
        aria-label={t("switcherMenu")}
        className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg"
      >
        <ul>
          {workspaces.map((id) => {
            const Icon = WORKSPACE_ICONS[id];
            const active = id === current;
            return (
              <li key={id}>
                <Link
                  href={WORKSPACE_HREF[id]}
                  aria-current={active ? "true" : undefined}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-[var(--surface-muted)] ${active ? "font-semibold" : ""}`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  <span className="flex-1">{t(`${id}.title`)}</span>
                  {active ? <Check className="h-4 w-4" aria-hidden /> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </details>
  );
}

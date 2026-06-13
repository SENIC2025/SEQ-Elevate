"use client";

import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useDemoState, type Role } from "@/store/demo-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AccessibilityToolbar } from "@/components/a11y/AccessibilityToolbar";
import {
  Sparkles,
  GraduationCap,
  Users,
  ShieldCheck,
  PenSquare,
  ArrowRight,
  RotateCcw,
  LogIn,
} from "lucide-react";

const ROLES: {
  id: Role;
  Icon: typeof GraduationCap;
  to: string;
  recommended?: boolean;
}[] = [
  { id: "learner", Icon: GraduationCap, to: "/learner", recommended: true },
  { id: "facilitator", Icon: Users, to: "/facilitator" },
  { id: "admin", Icon: ShieldCheck, to: "/admin" },
  { id: "content", Icon: PenSquare, to: "/content" },
];

export function LandingPage() {
  const t = useTranslations("landing");
  const tCommon = useTranslations("common");
  const tRoles = useTranslations("roles");
  const tAuth = useTranslations("auth");
  const router = useRouter();
  const { dispatch } = useDemoState();

  const enter = (role: Role, to: string) => {
    dispatch({ type: "setRole", role });
    router.push(to);
  };

  return (
    <div className="flex-1 flex flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--primary)] text-[var(--primary-foreground)]">
              <Sparkles className="h-4 w-4" />
            </span>
            <span>{tCommon("appName")}</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/signin"
              className="flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              <LogIn className="h-4 w-4" />
              <span>{tAuth("signIn")}</span>
            </Link>
            <LanguageSwitcher />
            <AccessibilityToolbar />
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-1 text-xs font-medium text-[var(--accent)]">
              <Sparkles className="h-3 w-3" />
              Platform shell demo · SENIC × SEQ Elevate
            </span>
            <h1 className="mt-4 text-4xl sm:text-5xl font-bold tracking-tight">
              {t("title")}
            </h1>
            <p className="mt-4 text-lg text-[var(--muted-foreground)] leading-relaxed">
              {t("subtitle")}
            </p>
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">
              {t("demoNote")} {t("scaffoldNote")}
            </p>
          </div>

          <h2 className="mt-12 mb-4 text-xl font-semibold">{t("pickRole")}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ROLES.map(({ id, Icon, to, recommended }) => (
              <Card
                key={id}
                className="flex flex-col p-0 overflow-hidden transition-shadow hover:shadow-md focus-within:shadow-md"
              >
                <CardContent className="flex flex-col flex-1 p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
                      <Icon className="h-5 w-5" />
                    </div>
                    {recommended ? (
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--accent)] bg-[var(--accent)]/10 px-2 py-0.5 rounded-full border border-[var(--accent)]/20">
                        Start here
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-4 text-base font-semibold">{tRoles(id)}</h3>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)] flex-1">
                    {tRoles(`${id}Desc`)}
                  </p>
                  <Button
                    variant={recommended ? "primary" : "outline"}
                    size="sm"
                    className="mt-4 w-full"
                    onClick={() => enter(id, to)}
                  >
                    {tCommon("continue")} <ArrowRight className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-10 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm text-[var(--muted-foreground)] leading-relaxed">
            <p className="font-medium text-[var(--foreground)]">
              {tCommon("demoBannerLine1")}
            </p>
            <p className="mt-1">{tCommon("demoBannerLine2")}</p>
          </div>
        </div>
      </main>

      <footer className="border-t border-[var(--border)] py-6 text-center text-xs text-[var(--muted-foreground)] flex flex-col sm:flex-row items-center justify-center gap-3">
        <span>Created and Powered by SENIC · senic.world</span>
        <span className="hidden sm:inline">·</span>
        <button
          type="button"
          onClick={() => {
            if (
              typeof window !== "undefined" &&
              window.confirm("Reset the demo? This clears your progress.")
            ) {
              dispatch({ type: "reset" });
              try {
                window.localStorage.removeItem("seq-elevate-demo-state-v1");
              } catch {}
            }
          }}
          className="inline-flex items-center gap-1 hover:text-[var(--foreground)] underline-offset-2 hover:underline"
        >
          <RotateCcw className="h-3 w-3" />
          Reset demo
        </button>
      </footer>
    </div>
  );
}

import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { AppHeader } from "@/components/AppHeader";
import { WORKSPACE_ICONS } from "@/components/workspace-icons";
import type { Workspace } from "@/lib/workspaces";

/**
 * "Your workspaces" — where a signed-in user with more than one workspace
 * lands (see [locale]/page.tsx). The production equivalent of the demo's role
 * picker, except every card is backed by a real role the user holds (D26).
 *
 * Each card is one large click target: the title is a link whose ::after
 * covers the card (the "stretched link" pattern), so the accessible name is
 * just the workspace title and the focus ring shows on the whole card.
 */
export async function WorkspaceHub({
  workspaces,
  name,
}: {
  workspaces: Workspace[];
  name: string;
}) {
  const t = await getTranslations("hub");

  return (
    <div className="flex-1 flex flex-col">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            {t("title")}
          </h1>
          {name ? (
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              {t("greeting", { name })}
            </p>
          ) : null}
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--muted-foreground)]">
            {t("subtitle")}
          </p>

          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map(({ id, href }) => {
              const Icon = WORKSPACE_ICONS[id];
              return (
                <li
                  key={id}
                  className="relative flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 transition-shadow hover:shadow-md focus-within:shadow-md focus-within:ring-2 focus-within:ring-[var(--ring)]"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <h2 className="mt-4 text-base font-semibold">
                    <Link
                      href={href}
                      className="outline-none after:absolute after:inset-0 after:rounded-xl"
                    >
                      {t(`${id}.title`)}
                    </Link>
                  </h2>
                  <p className="mt-1 flex-1 text-sm text-[var(--muted-foreground)]">
                    {t(`${id}.desc`)}
                  </p>
                  <span
                    aria-hidden
                    className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-[var(--accent)]"
                  >
                    {t("open")} <ArrowRight className="h-4 w-4" />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </main>
    </div>
  );
}

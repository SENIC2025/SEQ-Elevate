"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getCatalogue,
  setCourseStatus,
  type CatalogueEntry,
  type CourseStatus,
} from "@/app/actions/course";
import type { Locale } from "@/lib/cms/types";
import {
  BookOpen,
  Eye,
  EyeOff,
  Archive,
  Loader2,
  AlertTriangle,
  Users,
  Clock,
} from "lucide-react";

const STATUS_LABEL: Record<CourseStatus, string> = {
  published: "Published",
  draft: "Draft",
  archived: "Archived",
};

/**
 * Course lifecycle panel for the content editor: see every course including
 * drafts, and publish / unpublish / archive without a developer.
 */
export function CourseCatalogueManager({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [entries, setEntries] = React.useState<CatalogueEntry[] | null>(null);
  const [denied, setDenied] = React.useState(false);
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    getCatalogue(locale).then((res) => {
      if (cancelled) return;
      if (res === null) setDenied(true);
      else setEntries(res);
    });
    return () => {
      cancelled = true;
    };
  }, [locale, reloadKey]);

  async function change(slug: string, status: CourseStatus) {
    setPending(slug);
    const res = await setCourseStatus(slug, status);
    if (res.ok) {
      setError(null);
      setReloadKey((k) => k + 1);
      // Other surfaces (learner dashboard, pickers) read the same data.
      router.refresh();
    } else {
      setError(
        res.error === "forbidden"
          ? "Editors and admins only."
          : res.error === "unknown-course"
            ? "That course isn't in the CMS."
            : "Something went wrong."
      );
    }
    setPending(null);
  }

  if (denied) return null;

  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm font-semibold mb-1 flex items-center gap-1.5">
          <BookOpen className="h-4 w-4 text-[var(--accent)]" />
          Course catalogue
        </p>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">
          Publishing puts a course on every learner&rsquo;s dashboard.
          Unpublishing hides it again — progress already made is kept, never
          deleted.
        </p>

        {error ? (
          <p
            className="mb-3 text-sm text-[var(--danger)] flex items-center gap-1.5"
            role="alert"
          >
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
        ) : null}

        {entries === null ? (
          <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No courses in the catalogue yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {entries.map((c) => (
              <li
                key={c.slug}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{c.title}</p>
                  <p className="text-[11px] text-[var(--muted-foreground)] flex items-center gap-2.5">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {c.durationMinutes} min
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {c.enrolled} enrolled
                    </span>
                  </p>
                </div>

                <Badge
                  variant={c.status === "published" ? "accent" : "muted"}
                  className="text-[10px]"
                >
                  {STATUS_LABEL[c.status]}
                </Badge>

                {pending === c.slug ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[var(--muted-foreground)]" />
                ) : c.status === "published" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => change(c.slug, "draft")}
                  >
                    <EyeOff className="h-4 w-4" />
                    Unpublish
                  </Button>
                ) : (
                  <>
                    <Button size="sm" onClick={() => change(c.slug, "published")}>
                      <Eye className="h-4 w-4" />
                      Publish
                    </Button>
                    {c.status !== "archived" ? (
                      <button
                        type="button"
                        onClick={() => change(c.slug, "archived")}
                        aria-label={`Archive ${c.title}`}
                        className="rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      >
                        <Archive className="h-4 w-4" />
                      </button>
                    ) : null}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

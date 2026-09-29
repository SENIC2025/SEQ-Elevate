"use client";

import * as React from "react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { createCourse } from "@/app/actions/course";
import type { Locale } from "@/lib/cms/types";
import { AlertTriangle, Info, Loader2, Plus } from "lucide-react";

const inputCls =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)]";
const labelCls = "block text-xs text-[var(--muted-foreground)]";

/**
 * Start a new course: a title (and optionally a tagline, skill area and
 * length), created as a draft in the page's language. On success it goes
 * straight to the new course's page, where the lessons are written — unless
 * the host passes `onCreated`.
 *
 * Used on "Create courses" and behind "New course" on the course grid.
 */
export function NewCourseForm({
  locale,
  onCreated,
}: {
  locale: Locale;
  onCreated?: (slug: string) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [tagline, setTagline] = React.useState("");
  const [cluster, setCluster] = React.useState("");
  const [duration, setDuration] = React.useState("20");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await createCourse({
        title,
        tagline,
        cluster:
          cluster.toLowerCase().replace(/[^a-z]+/g, "-") || "communication",
        clusterLabel: cluster || "Skill",
        durationMinutes: Number(duration) || 20,
        locale,
      });
      if (res.ok) {
        if (onCreated) onCreated(res.slug);
        else router.push(`/content/courses/${res.slug}?lang=${locale}`);
        // Stay "pending" while the course page loads.
        return;
      }
      setError(
        res.error === "forbidden"
          ? "Your account can't create courses. Ask your project administrator for the Editor role."
          : res.error === "slug-taken"
            ? "A course with that name already exists."
            : res.error === "title-required" || res.error === "bad-title"
              ? "Give the course a name with some letters or numbers in it."
              : "Something went wrong. Try again."
      );
    } catch {
      setError(
        "The course wasn't created — check your connection and try again."
      );
    }
    setPending(false);
  }

  return (
    // Laid out by its own width (container queries), so it fits both a full
    // page section and a card on the course grid.
    <form onSubmit={onSubmit} className="@container">
      <div className="grid gap-3 @md:grid-cols-2 @3xl:grid-cols-[2fr_2fr_1.5fr_6rem]">
        <label className={labelCls}>
          <span className="mb-1 block">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            aria-required
            placeholder="e.g. Asking for what you need"
            className={inputCls}
          />
        </label>
        <label className={labelCls}>
          <span className="mb-1 block">Tagline</span>
          <input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            maxLength={200}
            placeholder="One line for the course card"
            className={inputCls}
          />
        </label>
        <label className={labelCls}>
          <span className="mb-1 block">Skill area</span>
          <input
            value={cluster}
            onChange={(e) => setCluster(e.target.value)}
            maxLength={60}
            placeholder="e.g. Communication"
            className={inputCls}
          />
        </label>
        <label className={labelCls}>
          <span className="mb-1 block">Minutes</span>
          <input
            type="number"
            min={1}
            max={240}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className={inputCls}
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={!title.trim() || pending}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Plus className="h-4 w-4" aria-hidden />
          )}
          Create draft
        </Button>
        {error ? (
          <p
            role="alert"
            className="flex items-center gap-1.5 text-sm text-[var(--danger)]"
          >
            <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-xs text-[var(--muted-foreground)]">
        <Info
          className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--accent)]"
          aria-hidden
        />
        A new course starts as a draft. You&rsquo;ll go straight to its course
        page to write the lessons, add videos, documents and exercises, and
        publish it when it&rsquo;s ready.
      </p>
    </form>
  );
}

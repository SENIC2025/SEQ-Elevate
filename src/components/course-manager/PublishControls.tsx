"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setCourseStatus } from "@/app/actions/course";
import type {
  CourseStatus,
  ReadinessIssue,
} from "@/lib/cms/course-admin-types";
import {
  AlertTriangle,
  Archive,
  Eye,
  EyeOff,
  Info,
  Loader2,
  PenLine,
  Undo2,
} from "lucide-react";

const STATUS_ICON = { published: Eye, draft: PenLine, archived: Archive };

/**
 * The course's status and the one place to change it (the grid's cards only
 * link here). Unpublishing always asks first, saying how many learners are
 * enrolled — their progress is kept either way. Warnings before publishing
 * never block it.
 */
export function PublishControls({
  slug,
  status,
  enrolled,
  readiness,
  onStatusChange,
}: {
  slug: string;
  status: CourseStatus;
  enrolled: number;
  readiness: ReadinessIssue[];
  onStatusChange: (next: CourseStatus) => void;
}) {
  const t = useTranslations("courseManager");
  const tStage = useTranslations("course.stageLabel");
  const tDraft = useTranslations("exerciseEditor.page");
  const ids = React.useId();
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const warningRef = React.useRef<HTMLParagraphElement>(null);
  const unpublishRef = React.useRef<HTMLButtonElement>(null);
  const [pending, setPending] = React.useState<CourseStatus | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Read the consequence first; "Yes, unpublish" is one Tab away.
  React.useEffect(() => {
    if (confirming) warningRef.current?.focus();
  }, [confirming]);

  async function change(next: CourseStatus) {
    setPending(next);
    setError(null);
    try {
      const res = await setCourseStatus(slug, next);
      if (res.ok) {
        setConfirming(false);
        onStatusChange(res.status);
      } else {
        setError(
          res.error === "forbidden"
            ? t("page.errors.forbidden")
            : res.error === "unknown-course"
              ? t("page.errors.unknownCourse")
              : t("page.errors.generic")
        );
      }
    } catch {
      setError(t("page.errors.generic"));
    }
    setPending(null);
    // The button that was pressed has gone (or was disabled while this ran):
    // put focus back at the top of this section rather than on the page. The
    // new status is announced by the badge's live region.
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  function cancelUnpublish() {
    setConfirming(false);
    // The confirm row goes away: put focus back where it started.
    requestAnimationFrame(() => unpublishRef.current?.focus());
  }

  const Icon = STATUS_ICON[status];
  const busy = pending !== null;
  const spinner = (s: CourseStatus) =>
    pending === s ? (
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
    ) : null;

  const readinessText = (issue: ReadinessIssue) => {
    const language = issue.locale ? t(`languageName.${issue.locale}`) : "";
    switch (issue.code) {
      case "copy-missing":
        return t("page.readiness.copyMissing", { language });
      case "lesson-empty":
        return t("page.readiness.lessonEmpty", {
          stage: issue.stage ? tStage(issue.stage) : "",
        });
      case "lesson-untranslated":
        return t("page.readiness.lessonUntranslated", {
          count: issue.count ?? 1,
          language,
        });
      case "lesson-draft":
        return tDraft("readinessDraft", {
          stage: issue.stage ? tStage(issue.stage) : "",
        });
      case "no-interactive":
        return t("page.readiness.noInteractive");
    }
  };

  return (
    <section
      aria-labelledby={`${ids}-h`}
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2
          id={`${ids}-h`}
          ref={headingRef}
          tabIndex={-1}
          className="text-sm font-semibold"
        >
          {t("page.publishing")}
        </h2>
        {/* Always mounted: a change of status is read out, the first
            render isn't. */}
        <span role="status">
          <Badge variant={status === "published" ? "success" : "muted"}>
            <Icon className="h-3 w-3" aria-hidden />
            {t(`status.${status}`)}
          </Badge>
        </span>
      </div>

      {status !== "published" && readiness.length ? (
        <div className="mt-3">
          <p className="text-xs font-semibold">{t("page.readiness.title")}</p>
          <p className="text-xs text-[var(--muted-foreground)]">
            {t("page.readiness.intro")}
          </p>
          <ul className="mt-1.5 space-y-1">
            {readiness.map((issue, i) => {
              const WarnIcon = issue.level === "warning" ? AlertTriangle : Info;
              const text = readinessText(issue);
              return (
                <li key={i} className="flex items-start gap-1.5 text-xs">
                  <WarnIcon
                    className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${
                      issue.level === "warning"
                        ? "text-[var(--warning)]"
                        : "text-[var(--accent)]"
                    }`}
                    aria-hidden
                  />
                  {(issue.code === "lesson-empty" ||
                    issue.code === "lesson-draft") &&
                  issue.stage ? (
                    <a
                      href={`#lesson-${issue.stage}`}
                      className="underline underline-offset-2 hover:text-[var(--accent)]"
                    >
                      {text}
                    </a>
                  ) : (
                    <span>{text}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {status === "published" && !confirming ? (
          <Button
            ref={unpublishRef}
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            <EyeOff className="h-4 w-4" aria-hidden />
            {t("page.unpublish")}
          </Button>
        ) : null}
        {status !== "published" ? (
          <Button size="sm" disabled={busy} onClick={() => change("published")}>
            {spinner("published") ?? <Eye className="h-4 w-4" aria-hidden />}
            {t("page.publish")}
          </Button>
        ) : null}
        {status === "draft" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => change("archived")}
          >
            {spinner("archived") ?? <Archive className="h-4 w-4" aria-hidden />}
            {t("page.archive")}
          </Button>
        ) : null}
        {status === "archived" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => change("draft")}
          >
            {spinner("draft") ?? <Undo2 className="h-4 w-4" aria-hidden />}
            {t("page.restoreDraft")}
          </Button>
        ) : null}
      </div>

      {status === "published" && confirming ? (
        <div
          role="group"
          aria-labelledby={`${ids}-warning`}
          className="mt-3 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/5 p-3"
        >
          <p
            id={`${ids}-warning`}
            ref={warningRef}
            tabIndex={-1}
            className="text-sm"
          >
            {t("page.unpublishWarning", { count: enrolled })}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={() => change("draft")}
            >
              {spinner("draft") ?? <EyeOff className="h-4 w-4" aria-hidden />}
              {t("page.confirmUnpublish")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={cancelUnpublish}
            >
              {t("page.cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-3 flex items-start gap-1.5 text-sm text-[var(--danger)]"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </section>
  );
}

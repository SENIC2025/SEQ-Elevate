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
import { SECTION_LIMITS, type NewOnlyReason } from "@/lib/cms/sections/contract";
import { reasonText } from "./lesson-list/list-model";
import {
  AlertTriangle,
  Archive,
  Ban,
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
 *
 * Blockers do (D57): a created course whose lesson list learners couldn't
 * get yet (a lesson of its own, a hidden or deleted one, a new order, added
 * content) lists them first, under "Can't publish yet", each linking to its
 * lesson. Publish then stays focusable but aria-disabled, described by that
 * list, and pressing it takes focus there. A page that didn't know yet (the
 * server refused with "needs-release-2") says why the same way. A course
 * that is live although it has some (published past the guard) says what
 * learners don't get yet.
 */
export function PublishControls({
  slug,
  status,
  enrolled,
  readiness,
  onStatusChange,
  lessonName,
  onRefresh,
}: {
  slug: string;
  status: CourseStatus;
  enrolled: number;
  readiness: ReadinessIssue[];
  onStatusChange: (next: CourseStatus) => void;
  /**
   * A lesson's name in the content language, by id. Without it, the
   * standard name in the menu language (a built-in course).
   */
  lessonName?: (id: string) => string;
  /** Re-read the page (after a refusal that shows it was out of date). */
  onRefresh?: () => void;
}) {
  const t = useTranslations("courseManager");
  const tStage = useTranslations("course.stageLabel");
  const tDraft = useTranslations("exerciseEditor.page");
  const tList = useTranslations("lessonList");
  const tReason = useTranslations("lessonList.publish.reason");
  const ids = React.useId();
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const warningRef = React.useRef<HTMLParagraphElement>(null);
  const unpublishRef = React.useRef<HTMLButtonElement>(null);
  const blockersRef = React.useRef<HTMLDivElement>(null);
  const [pending, setPending] = React.useState<CourseStatus | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** The reasons of a refused publish (a page that didn't know them yet). */
  const [refusedReasons, setRefusedReasons] = React.useState<NewOnlyReason[]>([]);

  const nameOf = (id: string) => (lessonName ? lessonName(id) : tStage(id));
  const blockers = readiness.flatMap((issue) =>
    issue.level === "blocker" && issue.code === "needs-release-2" && issue.reason ? [issue.reason] : []
  );
  const issues = readiness.filter((issue) => issue.level !== "blocker");
  const blocked = blockers.length > 0 && status !== "published";

  // Read the consequence first; "Yes, unpublish" is one Tab away.
  React.useEffect(() => {
    if (confirming) warningRef.current?.focus();
  }, [confirming]);

  async function change(next: CourseStatus) {
    setPending(next);
    setError(null);
    setRefusedReasons([]);
    try {
      const res = await setCourseStatus(slug, next);
      if (res.ok) {
        setConfirming(false);
        onStatusChange(res.status);
      } else if (res.error === "needs-release-2") {
        // Changed since this page loaded: say why, and bring the page up to date.
        setError(tList("publish.needsRelease2"));
        setRefusedReasons("reasons" in res ? res.reasons : []);
        onRefresh?.();
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
          stage: issue.stage ? nameOf(issue.stage) : "",
        });
      case "lesson-untranslated":
        return t("page.readiness.lessonUntranslated", {
          count: issue.count ?? 1,
          language,
        });
      case "lesson-draft":
        return tDraft("readinessDraft", {
          stage: issue.stage ? nameOf(issue.stage) : "",
        });
      case "no-interactive":
        return t("page.readiness.noInteractive");
      case "part-draft":
        return tList("publish.partDraft", { name: issue.stage ? nameOf(issue.stage) : "" });
      case "sections-many":
        return tList("many", { count: SECTION_LIMITS.warnAbove });
      case "labels-later":
        return tList("labelsLater");
      case "needs-release-2":
        return issue.reason ? reasonText(issue.reason, nameOf, tReason).text : "";
    }
  };

  /** The blockers as a list, each linking to its lesson when it is on the page. */
  const reasonList = (reasons: NewOnlyReason[]) => (
    <ul className="mt-1.5 space-y-1">
      {reasons.map((reason, i) => {
        const { text, href } = reasonText(reason, nameOf, tReason);
        return (
          <li key={i} className="flex items-start gap-1.5 text-xs">
            <Ban className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--danger)]" aria-hidden />
            {href ? (
              <a href={href} className="underline underline-offset-2 hover:text-[var(--accent)]">
                {text}
              </a>
            ) : (
              <span>{text}</span>
            )}
          </li>
        );
      })}
    </ul>
  );

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

      {blockers.length ? (
        <div
          id={`${ids}-blockers`}
          ref={blockersRef}
          tabIndex={-1}
          className="mt-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-3"
        >
          {status === "published" ? (
            <p className="text-xs font-semibold">{tList("publish.liveBypass")}</p>
          ) : (
            <>
              <p className="text-xs font-semibold">{tList("publish.blockedTitle")}</p>
              <p className="text-xs text-[var(--muted-foreground)]">{tList("publish.blockedIntro")}</p>
            </>
          )}
          {reasonList(blockers)}
        </div>
      ) : null}

      {status !== "published" && issues.length ? (
        <div className="mt-3">
          <p className="text-xs font-semibold">{t("page.readiness.title")}</p>
          <p className="text-xs text-[var(--muted-foreground)]">
            {t("page.readiness.intro")}
          </p>
          <ul className="mt-1.5 space-y-1">
            {issues.map((issue, i) => {
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
                    issue.code === "lesson-draft" ||
                    issue.code === "part-draft") &&
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
          <Button
            size="sm"
            disabled={busy}
            // Focusable while blocked, so it can say why: the list.
            aria-disabled={blocked || undefined}
            aria-describedby={blocked ? `${ids}-blockers` : undefined}
            className={blocked ? "opacity-60" : undefined}
            onClick={() => {
              if (blocked) blockersRef.current?.focus();
              else void change("published");
            }}
          >
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
        <div
          role="alert"
          className="mt-3 flex items-start gap-1.5 text-sm text-[var(--danger)]"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          <div>
            <p>{error}</p>
            {/* Once the page knows the blockers it lists them above. */}
            {refusedReasons.length && !blockers.length ? reasonList(refusedReasons) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

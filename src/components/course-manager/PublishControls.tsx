"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setCourseLanguageReady, setCourseStatus } from "@/app/actions/course";
import type {
  CourseStatus,
  LanguageCoverage,
  ReadinessIssue,
} from "@/lib/cms/course-admin-types";
import { nameInSentence, sentenceStart } from "@/lib/cms/language-name";
import {
  SECTION_LIMITS,
  type NewOnlyReason,
  type PublishBlocker,
  type PublishRefused,
} from "@/lib/cms/sections/contract";
import type { Locale } from "@/lib/cms/types";
import { blockerText, reasonText } from "./lesson-list/list-model";
import { Named } from "./lesson-list/Named";
import {
  AlertTriangle,
  Archive,
  Ban,
  Check,
  Eye,
  EyeOff,
  Info,
  Loader2,
  PenLine,
  Undo2,
} from "lucide-react";

const STATUS_ICON = { published: Eye, draft: PenLine, archived: Archive };

/**
 * One thing that stops publishing: Release 2's (D66), Release 1's under a
 * kill switch (spec 3.4), or English missing before the first publish
 * (D90).
 */
type Blocker = { blocker: PublishBlocker } | { reason: NewOnlyReason } | { english: true };

/** The blockers among the readiness issues, in their order. */
export function blockersOf(readiness: readonly ReadinessIssue[]): Blocker[] {
  return readiness.flatMap((issue): Blocker[] => {
    if (issue.level !== "blocker") return [];
    if (issue.code === "cannot-publish" && issue.blocker) return [{ blocker: issue.blocker }];
    if (issue.code === "needs-release-2" && issue.reason) return [{ reason: issue.reason }];
    if (issue.code === "english-incomplete") return [{ english: true }];
    return [];
  });
}

/** A language's name inside a sentence of the menu language (lower case in Greek). */
function useLanguageInSentence() {
  const t = useTranslations("courseManager");
  const ui = useLocale();
  return (locale: Locale) => nameInSentence(t(`languageName.${locale}`), ui);
}

/**
 * The course's status and the one place to change it (the grid's cards only
 * link here). Unpublishing always asks first, saying how many learners are
 * enrolled — their progress is kept either way. Warnings before publishing
 * never block it.
 *
 * Blockers do (D66): a created course whose lesson list, or a lesson's
 * content, can't be read, or that has no lesson learners would see, lists
 * them first under "Can't publish yet", each linking to its lesson when
 * there is one. Publish then stays focusable but aria-disabled, described
 * by that list, and pressing it takes focus there. A page that didn't know
 * yet (the server refused with "cannot-publish") says why the same way.
 * Under a kill switch the blockers are Release 1's (spec 3.4), said the
 * same way: lesson names are marked with the content language, and "a new
 * order" says what the usual order is. Release 3 (D90): a created course
 * whose English is incomplete is listed as blocked until its first
 * publish (the server refuses it too).
 */
export function PublishControls({
  slug,
  status,
  enrolled,
  readiness,
  onStatusChange,
  lessonName,
  nameLang,
  usualOrder,
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
  /** The content language those names are in. */
  nameLang?: Locale;
  /** The standard lessons' names in their usual order, for "The lessons are in a new order". */
  usualOrder?: readonly string[];
  /** Re-read the page (after a refusal that shows it was out of date). */
  onRefresh?: () => void;
}) {
  const t = useTranslations("courseManager");
  const tStage = useTranslations("course.stageLabel");
  const tDraft = useTranslations("exerciseEditor.page");
  const tList = useTranslations("lessonList");
  const tReason = useTranslations("lessonList.publish.reason");
  const ui = useLocale();
  const ids = React.useId();
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const warningRef = React.useRef<HTMLParagraphElement>(null);
  const unpublishRef = React.useRef<HTMLButtonElement>(null);
  const blockersRef = React.useRef<HTMLDivElement>(null);
  const [pending, setPending] = React.useState<CourseStatus | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** The reasons of a refused publish (a page that didn't know them yet). */
  const [refusedReasons, setRefusedReasons] = React.useState<Blocker[]>([]);

  const languageIn = useLanguageInSentence();
  const nameOf = (id: string) => (lessonName ? lessonName(id) : tStage(id));
  const order = (usualOrder ?? []).join(", ");
  const blockers = blockersOf(readiness);
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
      } else if (res.error === "english-incomplete") {
        // Changed since this page loaded: the page brings the list up to date.
        setError(t("languageReady.englishRequired"));
        onRefresh?.();
      } else if (res.error === "cannot-publish" || res.error === "needs-release-2") {
        // Changed since this page loaded: say why, and bring the page up to date.
        setError(tList("publish.refused"));
        const refused = "reasons" in res ? (res as PublishRefused) : null;
        setRefusedReasons(
          !refused
            ? []
            : refused.error === "cannot-publish"
              ? refused.reasons.map((blocker) => ({ blocker }))
              : refused.reasons.map((reason) => ({ reason }))
        );
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

  /**
   * A warning naming one lesson: the name in the content language carries
   * `lang` inside the menu-language sentence (WCAG 3.1.2), as the blockers do.
   */
  const lessonLine = (issue: ReadinessIssue) => {
    const format = (name: string) =>
      issue.code === "lesson-empty"
        ? t("page.readiness.lessonEmpty", { stage: name })
        : issue.code === "lesson-draft"
          ? tDraft("readinessDraft", { stage: name })
          : tList("publish.partDraft", { name });
    return <Named format={format} name={issue.stage ? nameOf(issue.stage) : ""} lang={nameLang} />;
  };

  const readinessText = (issue: ReadinessIssue) => {
    const language = issue.locale ? languageIn(issue.locale) : "";
    const sentence = (text: string) => sentenceStart(text, ui);
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
      case "cannot-publish":
        return issue.blocker ? blockerText(issue.blocker, nameOf, tReason).text : "";
      case "needs-release-2":
        return issue.reason ? reasonText(issue.reason, nameOf, tReason, order).text : "";
      case "english-incomplete":
        return t("languageReady.englishMissing");
      case "language-live-incomplete":
        return sentence(t("languageReady.liveIncomplete", { language }));
      case "language-not-live":
        return sentence(t("languageReady.notLive", { language }));
    }
  };

  /** The blockers as a list, each linking to its lesson when it is on the page. */
  const reasonList = (reasons: Blocker[]) => (
    <ul className="mt-1.5 space-y-1">
      {reasons.map((b, i) => {
        if ("english" in b) {
          return (
            <li key={i} className="flex items-start gap-1.5 text-xs">
              <Ban className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--danger)]" aria-hidden />
              <span>{t("languageReady.englishRequired")}</span>
            </li>
          );
        }
        const { href, name, format } =
          "blocker" in b ? blockerText(b.blocker, nameOf, tReason) : reasonText(b.reason, nameOf, tReason, order);
        const text = <Named format={format} name={name} lang={nameLang} />;
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

      {blocked ? (
        <div
          id={`${ids}-blockers`}
          ref={blockersRef}
          tabIndex={-1}
          className="mt-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-3"
        >
          <p className="text-xs font-semibold">{tList("publish.blockedTitle")}</p>
          <p className="text-xs text-[var(--muted-foreground)]">{tList("publish.blockedIntro")}</p>
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
                      {lessonLine(issue)}
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
            {refusedReasons.length && !blocked ? reasonList(refusedReasons) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

const SWITCHABLE: readonly Locale[] = ["de", "el"];

/**
 * Which of a created course's languages learners get (D90, spec 9.4): one
 * switch per language, German and Greek, with its coverage beside it.
 * Until a language is on, learners using it get the whole course in
 * English. Switching one on while its coverage isn't complete asks first;
 * the panel says plainly what coverage doesn't check. Switching is a
 * partner admin's or an ADMIN's (canSignOff); everyone else sees the state
 * read-only. A live language whose text is no longer complete is said, never
 * switched off; so is English missing on a published course (before the
 * first publish it is a blocker of PublishControls).
 *
 * The state is a switch's position and its sentence, never colour alone.
 * While a change is saved the controls are aria-disabled, never disabled:
 * a disabled control loses focus (to the page), so the switch's new state
 * would go unannounced and the next Tab would start from the top.
 */
export function LanguagePanel({
  slug,
  ready,
  languages,
  readiness,
  canSignOff,
  onRefresh,
}: {
  slug: string;
  ready: Record<Locale, boolean>;
  languages: Record<Locale, LanguageCoverage>;
  readiness: readonly ReadinessIssue[];
  canSignOff: boolean;
  /** Re-read the page (its readiness follows the switch). */
  onRefresh?: () => void;
}) {
  const t = useTranslations("courseManager");
  const ui = useLocale();
  const languageIn = useLanguageInSentence();
  const ids = React.useId();
  const confirmRef = React.useRef<HTMLParagraphElement>(null);
  const switchRefs = React.useRef<Partial<Record<Locale, HTMLButtonElement | null>>>({});
  // The confirmation goes away: focus goes back to its switch.
  const backToSwitch = (locale: Locale) => requestAnimationFrame(() => switchRefs.current[locale]?.focus());
  // What the server answered last, until the page's next outline arrives.
  const [live, setLive] = React.useState(ready);
  const [seen, setSeen] = React.useState(ready);
  if (ready !== seen) {
    setSeen(ready);
    setLive(ready);
  }
  const [confirming, setConfirming] = React.useState<Locale | null>(null);
  const [pending, setPending] = React.useState<Locale | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const busy = pending !== null;

  React.useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const sentence = (key: string, locale: Locale) =>
    sentenceStart(t(key, { language: languageIn(locale) }), ui);
  const englishMissing = readiness.some((i) => i.code === "english-incomplete" && i.level === "warning");

  async function change(locale: Locale, next: boolean) {
    setPending(locale);
    setError(null);
    try {
      const res = await setCourseLanguageReady(slug, locale as "de" | "el", next);
      if (res.ok) {
        if (confirming) backToSwitch(locale);
        setConfirming(null);
        setLive((l) => ({ ...l, de: res.readyLocales.includes("de"), el: res.readyLocales.includes("el") }));
        onRefresh?.();
      } else {
        setError(res.error === "forbidden" ? t("languageReady.readOnly") : t("page.errors.generic"));
      }
    } catch {
      setError(t("page.errors.generic"));
    }
    setPending(null);
  }

  function toggle(locale: Locale) {
    const next = !live[locale];
    if (next && languages[locale].state !== "complete") {
      setConfirming(locale);
      return;
    }
    void change(locale, next);
  }

  return (
    <section
      aria-labelledby={`${ids}-h`}
      className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <h2 id={`${ids}-h`} className="text-sm font-semibold">
        {t("languageReady.title")}
      </h2>
      {englishMissing ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--warning)]" aria-hidden />
          {t("languageReady.englishMissing")}
        </p>
      ) : null}
      <ul className="mt-2 space-y-3">
        {SWITCHABLE.map((locale) => {
          const on = live[locale];
          const coverage = languages[locale];
          const label = sentence("languageReady.label", locale);
          const stateId = `${ids}-${locale}-state`;
          const coverageId = `${ids}-${locale}-coverage`;
          const coverageText = t("grid.lang.label", {
            language: t(`languageName.${locale}`),
            state:
              coverage.state === "partial"
                ? t("grid.lang.partial", { covered: coverage.covered, total: coverage.total })
                : t(`grid.lang.${coverage.state}`),
          });
          return (
            <li key={locale} className="text-sm">
              {canSignOff ? (
                <button
                  type="button"
                  ref={(el) => {
                    switchRefs.current[locale] = el;
                  }}
                  role="switch"
                  aria-checked={on}
                  aria-describedby={`${stateId} ${coverageId}`}
                  aria-disabled={busy || undefined}
                  onClick={() => {
                    if (!busy) toggle(locale);
                  }}
                  className="flex min-h-9 items-center gap-2 rounded-md text-left font-medium aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
                >
                  {/* The position and the tick say it, not the colour. */}
                  <span
                    aria-hidden
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full border transition-colors ${
                      on
                        ? "border-[var(--success)] bg-[var(--success)]"
                        : "border-[var(--border)] bg-[var(--surface-muted)]"
                    }`}
                  >
                    <span
                      className={`absolute flex h-4 w-4 items-center justify-center rounded-full bg-[var(--surface)] shadow transition-[left] ${
                        on ? "left-[1.125rem]" : "left-0.5"
                      }`}
                    >
                      {on ? <Check className="h-3 w-3 text-[var(--success)]" /> : null}
                    </span>
                  </span>
                  {pending === locale ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  {label}
                </button>
              ) : (
                <p className="font-medium">{label}</p>
              )}
              <p id={stateId} className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                {sentence(on ? "languageReady.on" : "languageReady.off", locale)}
              </p>
              <p id={coverageId} className="text-xs text-[var(--muted-foreground)]">
                {coverageText}
              </p>
              {on && coverage.state !== "complete" ? (
                <p className="mt-1 flex items-start gap-1.5 text-xs">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--warning)]" aria-hidden />
                  {sentence("languageReady.liveIncomplete", locale)}
                </p>
              ) : null}
              {confirming === locale ? (
                <div
                  role="group"
                  aria-labelledby={`${ids}-${locale}-confirm`}
                  className="mt-2 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/5 p-3"
                >
                  <p
                    id={`${ids}-${locale}-confirm`}
                    ref={confirmRef}
                    tabIndex={-1}
                    className="text-sm font-semibold outline-none"
                  >
                    {sentence("languageReady.confirmTitle", locale)}
                  </p>
                  <p className="mt-1 text-xs">{sentence("languageReady.confirmBody", locale)}</p>
                  <p className="mt-1 text-xs">{t("languageReady.notChecked")}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      aria-disabled={busy || undefined}
                      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                      onClick={() => {
                        if (!busy) void change(locale, true);
                      }}
                    >
                      {sentence("languageReady.confirm", locale)}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-disabled={busy || undefined}
                      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                      onClick={() => {
                        if (busy) return;
                        setConfirming(null);
                        backToSwitch(locale);
                      }}
                    >
                      {t("page.cancel")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {canSignOff ? null : (
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">{t("languageReady.readOnly")}</p>
      )}
      <p className="mt-3 text-xs text-[var(--muted-foreground)]">{t("languageReady.notChecked")}</p>
      {error ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-sm text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </section>
  );
}

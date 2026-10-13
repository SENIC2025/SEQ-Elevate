"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  fieldKey,
  type StoredSimulation,
  type StoredScenario,
  type StoredAssessment,
  type StoredScenarioChoice,
  type StructureStageKey,
} from "@/lib/cms/structure";
import { STRUCTURE_LIMITS } from "@/lib/cms/structure-sanitize";
import type {
  ExerciseKind,
  ExerciseState,
  ExerciseValue,
  PartIssue,
  PartLimitBreach,
} from "@/lib/cms/sections/contract";
import {
  emptyExercise,
  partIssueField,
  sanitizeExercise,
  validateExercise,
} from "@/lib/cms/sections/part-kinds";
import { limitField, limitText } from "./structure-limit-text";
import { lessonTarget, type ExerciseTarget } from "./exercise/exercise-target";
import { FieldIssuesContext, IssueList, LocField, newId, type FieldIssues } from "./exercise/fields";
import { ReflectionPromptsEditor } from "./exercise/ReflectionPromptsEditor";
import { RatingEditor } from "./exercise/RatingEditor";
import { removeErrorMessage, writeErrorMessage, type WriteRefusal } from "./exercise/write-errors";
import type { CourseStatus } from "@/lib/cms/course-status";
import type { Locale, OutcomeQuality } from "@/lib/cms/types";
import {
  Puzzle,
  Save,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Trash2,
  Star,
  RotateCcw,
  RefreshCw,
  FilePenLine,
  ListChecks,
  Undo2,
} from "lucide-react";

export { IssueList, LocField };

const QUALITIES: OutcomeQuality[] = ["best", "okay", "poor"];

/**
 * A new exercise as the editor starts it when nothing is stored: Release 0's
 * (fresh ids each time), or the flexible editor's own kinds' empty value.
 */
function emptyStructure(kind: ExerciseKind): ExerciseValue {
  if (kind === "reflection" || kind === "rating") return emptyExercise(kind);
  if (kind === "simulation") {
    return {
      kind: "simulation",
      title: {},
      prompt: {},
      instruction: {},
      options: [
        { id: newId("o"), isBest: true, text: {}, feedback: {} },
        { id: newId("o"), isBest: false, text: {}, feedback: {} },
      ],
    };
  }
  if (kind === "scenario") {
    return {
      kind: "scenario",
      title: {},
      setup: {},
      question: {},
      followupQuestion: {},
      choices: [
        { id: newId("c"), quality: "best", text: {}, outcome: {}, followups: [] },
        { id: newId("c"), quality: "poor", text: {}, outcome: {} },
      ],
    };
  }
  return {
    kind: "assessment",
    title: {},
    intro: {},
    questions: [
      {
        id: newId("q"),
        correctOptionId: "",
        question: {},
        options: [
          { id: newId("a"), text: {} },
          { id: newId("a"), text: {} },
        ],
      },
    ],
  };
}

/**
 * Tell the page when unsaved edits appear and when they're gone — saved,
 * reloaded, or discarded because the editor closed.
 */
function useReportDirty(dirty: boolean, onDirtyChange?: (d: boolean) => void) {
  const report = React.useRef(onDirtyChange);
  React.useEffect(() => {
    report.current = onDirtyChange;
  });
  React.useEffect(() => {
    if (!dirty) return;
    report.current?.(true);
    return () => report.current?.(false);
  }, [dirty]);
}

interface LoadedStructure {
  key: string;
  /** What's on screen: the draft if there is one, else the saved stage. */
  edit: ExerciseValue;
  /** What `edit` started from (or was last saved as): unsaved = edit !== saved. */
  saved: ExerciseValue;
  /**
   * What the server holds as far as this editor knows. Sent with every
   * write, so the server can refuse it if someone else has saved the stage
   * or its draft since (both hold every language — D33).
   */
  base: ExerciseState;
}

type Status =
  | "idle"
  | "saving"
  | "saved"
  | "draftSaved"
  | "draftDiscarded"
  | "removed"
  | "error";

/** A save refused for size: what was sent, and where it was over. */
interface OverLimit {
  sent: ExerciseValue;
  at: PartLimitBreach;
}

/**
 * Author one exercise of a CMS-created course, on the course page: a
 * lesson's main content (practice question, scenario, quick check —
 * Release 0's "interactive stage") or a question in its extra content
 * (those three, reflection questions, a 1–5 self-assessment). The page
 * gives the lesson and the language being written; the editor holds every
 * language at once, so a language switch keeps unsaved work.
 *
 * Two ways to save: "Save draft" keeps unfinished work for editors only,
 * whatever is still missing; "Save stage" saves it for learners once it is
 * complete (on a published course a lesson's main content is live at
 * once). What is still missing is listed as the author types, naming each
 * field.
 *
 * Where it reads and writes is its `target` (exercise-target.ts): by default
 * the lesson's main content through Release 0's actions, so a standard
 * lesson behaves exactly as before. It reads fresh whenever it opens,
 * rather than taking what the page loaded: a colleague may have saved
 * another language since.
 */
export function StructureAuthor({
  courseSlug: slug,
  kind,
  stageKey,
  target: givenTarget,
  locale,
  courseStatus,
  regionLabel,
  embedded = false,
  onSaved,
  onDraftChange,
  onCleared,
  onDirtyChange,
}: (
  | {
      /** The main content's kind (a standard key's own, or mainKindOf a lesson of the course's own). */
      kind: StructureStageKey;
      /** The lesson's id when it isn't `kind` itself: a lesson of the course's own ("s-…"). */
      stageKey?: string;
      target?: undefined;
    }
  | {
      kind?: undefined;
      stageKey?: undefined;
      /** Where to read and write: a question in the lesson's extra content. */
      target: ExerciseTarget;
    }
) & {
  courseSlug: string;
  /** The language being written. The editor holds every language at once. */
  locale: Locale;
  /** Says whether "Save stage" goes live at once (published) or not. */
  courseStatus?: CourseStatus;
  /** Heading and region name, in the menu language (exerciseEditor.region, lessonBlocks.position). */
  regionLabel?: string;
  /** Inside a lesson on the course page: lighter frame. */
  embedded?: boolean;
  onSaved?: (value: ExerciseValue) => void;
  /** The stored draft changed: saved (the draft as stored) or gone (null). */
  onDraftChange?: (draft: ExerciseValue | null) => void;
  onCleared?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useTranslations("exerciseEditor");
  const tBlocks = useTranslations("lessonBlocks");
  const tLanguage = useTranslations("courseManager.languageName");
  const headingId = React.useId();
  // Element ids for the text boxes and for the reasons a save was refused.
  const fieldsId = React.useId();
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const notReadyRef = React.useRef<HTMLParagraphElement>(null);
  const overLimitRef = React.useRef<HTMLParagraphElement>(null);
  const target = givenTarget ?? lessonTarget(slug, stageKey ?? kind!, kind!);
  const targetKey = target.key;
  const exerciseKind = target.kind;
  const part = target.scope === "part";
  // The latest target for the load below, which runs only when the key
  // changes (the page makes a new target object on every render).
  const targetRef = React.useRef(target);
  React.useEffect(() => {
    targetRef.current = target;
  });
  // The exercise plus the target it belongs to, as one unit. Deriving
  // `ready` from the key means Save waits until it has loaded.
  const [loaded, setLoaded] = React.useState<LoadedStructure | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [status, setStatus] = React.useState<Status>("idle");
  // Why the last "Save stage" was refused, as the server said it.
  const [notReady, setNotReady] = React.useState<PartIssue[]>([]);
  // The last save refused for size (either kind of save).
  const [overLimit, setOverLimit] = React.useState<OverLimit | null>(null);
  const [error, setError] = React.useState("");
  // Someone else saved this after it was loaded here, found by a refused
  // save or a refused "Remove stage".
  const [conflict, setConflict] = React.useState<"save" | "remove" | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  const setEdit = (next: ExerciseValue) => {
    setLoaded((l) => (l ? { ...l, edit: next } : l));
    // These describe the exercise before this edit.
    setStatus((s) =>
      s === "removed" || s === "saved" || s === "draftSaved" || s === "draftDiscarded"
        ? "idle"
        : s
    );
    // The reasons were for what was sent; the live list takes over.
    setNotReady((n) => (n.length ? [] : n));
  };

  React.useEffect(() => {
    let cancelled = false;
    const from = targetRef.current;
    from.load().then(
      (state) => {
        if (cancelled) return;
        if (!state) {
          setLoadFailed(true);
          return;
        }
        const edit = state.draft ?? state.structure ?? emptyStructure(from.kind);
        setLoaded({ key: from.key, edit, saved: edit, base: state });
        setLoadFailed(false);
        setConflict(null);
        setNotReady([]);
        setOverLimit(null);
        setError("");
        // Keep "Removed" / "Draft discarded" after the reload that follows.
        setStatus((s) => (s === "removed" || s === "draftDiscarded" ? s : "idle"));
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [targetKey, reloadKey]);

  // Until the load resolves, `loaded.key` doesn't match (or `loaded` is
  // null), so `ready` is false — no synchronous reset needed.
  const ready = loaded?.key === targetKey;
  const edit = ready ? loaded!.edit : null;
  const authored = ready ? loaded!.base.structure !== null : false;
  const hasDraft = ready ? loaded!.base.draft !== null : false;
  const dirty = ready && loaded!.edit !== loaded!.saved;
  useReportDirty(dirty, onDirtyChange);

  // What learners would still miss, as the author types (the same check the
  // server runs before "Save stage").
  const missing = React.useMemo(
    () => (edit ? validateExercise(edit) : []),
    [edit]
  );

  React.useEffect(() => {
    if (status !== "saved" && status !== "draftSaved") return;
    const id = setTimeout(() => setStatus("idle"), 4000);
    return () => clearTimeout(id);
  }, [status]);

  // A refused "Save stage": take the reader to the reasons.
  React.useEffect(() => {
    if (notReady.length) notReadyRef.current?.focus();
  }, [notReady]);

  // Where the exercise is over a size limit, after a save was refused for
  // it: what the server said, until the author edits; then the same check,
  // here, on what is on screen — so it goes away once they have shortened
  // the text (and points to the next one, if another is over). Checked
  // against what is stored, like the server: what was already over a limit
  // before the limits existed may stay.
  const breach = React.useMemo(() => {
    if (!overLimit || !edit || !ready) return null;
    if (edit === overLimit.sent) return overLimit.at;
    const now = sanitizeExercise(edit, exerciseKind, [loaded!.base.structure, loaded!.base.draft]);
    return !now.ok && now.error === "too-large" ? now.at : null;
  }, [overLimit, edit, ready, exerciseKind, loaded]);

  // A save refused for size: take the reader to where.
  React.useEffect(() => {
    if (overLimit) overLimitRef.current?.focus();
  }, [overLimit]);

  const issueText = (issue: PartIssue) =>
    t(`issues.${issue.code}`, issue.params ?? {});

  const refusedId = React.useCallback(
    (i: number) => `${fieldsId}-refused-${i}`,
    [fieldsId]
  );
  const overLimitId = `${fieldsId}-over-limit`;
  const breachField = breach ? limitField(breach) : null;
  // The box over its limit is marked invalid only in its own language: the
  // same box in the language on screen holds another, shorter text.
  const breachHere =
    breach?.limit === "text" && breach.locale === locale ? breachField : null;
  const fieldIssues = React.useMemo<FieldIssues>(() => {
    const refused = new Map<string, string>();
    notReady.forEach((issue, i) => {
      const field = partIssueField(issue);
      if (field && !refused.has(field)) refused.set(field, refusedId(i));
    });
    if (breachHere) refused.set(breachHere, overLimitId);
    return { idFor: (field) => `${fieldsId}-field-${field}`, refused };
  }, [notReady, fieldsId, refusedId, breachHere, overLimitId]);

  function writeError(refusal: WriteRefusal) {
    if (refusal.error === "changed-elsewhere") {
      // Nothing was written; the edits stay on screen.
      setConflict("save");
      return;
    }
    const message = writeErrorMessage(refusal);
    setError(t(message.key, message.values));
  }

  function startWrite() {
    setStatus("saving");
    setError("");
    setConflict(null);
    setNotReady([]);
    setOverLimit(null);
  }

  async function onSave() {
    if (!edit || !ready) return;
    const savedKey = targetKey;
    const sent = edit;
    startWrite();
    try {
      const res = await target.save(sent, loaded!.base);
      if (res.ok) {
        // Keep what's on screen rather than reloading: a reload resets the
        // status (the "Saved" confirmation would flash for ~25ms) and
        // overwrites anything typed while it was in flight — which stays
        // unsaved, since it's newer than what was sent. The server's copy
        // (cleaned, blank languages dropped) is the base for the next write.
        setLoaded((l) =>
          l?.key === savedKey
            ? { ...l, saved: sent, base: { structure: res.value, draft: null } }
            : l
        );
        setStatus("saved");
        // The page re-reads itself (what learners see, warnings).
        onSaved?.(res.value);
        return;
      }
      setStatus("error");
      if (res.error === "invalid") setNotReady((res as { issues: PartIssue[] }).issues);
      else if (res.error === "too-large") {
        setOverLimit({ sent, at: (res as { at: PartLimitBreach }).at });
      } else writeError(res);
    } catch {
      setStatus("error");
      writeError({ error: "generic" });
    }
  }

  async function onSaveDraft() {
    if (!edit || !ready) return;
    const savedKey = targetKey;
    const sent = edit;
    startWrite();
    try {
      const res = await target.saveDraft(sent, loaded!.base);
      if (res.ok) {
        setLoaded((l) =>
          l?.key === savedKey
            ? { ...l, saved: sent, base: { ...l.base, draft: res.draft } }
            : l
        );
        setStatus("draftSaved");
        onDraftChange?.(res.draft);
        return;
      }
      setStatus("error");
      if (res.error === "too-large") {
        setOverLimit({ sent, at: (res as { at: PartLimitBreach }).at });
      } else writeError(res);
    } catch {
      setStatus("error");
      writeError({ error: "generic" });
    }
  }

  async function onDiscardDraft() {
    if (!ready) return;
    if (!window.confirm(authored ? t("confirm.discardLive") : t("confirm.discardNew"))) {
      return;
    }
    // The button goes away with the draft: keep focus here, not on the page.
    headingRef.current?.focus();
    startWrite();
    try {
      const res = await target.discardDraft(loaded!.base);
      if (res.ok) {
        setStatus("draftDiscarded");
        setReloadKey((k) => k + 1);
        onDraftChange?.(null);
        return;
      }
      setStatus("error");
      writeError(res);
    } catch {
      setStatus("error");
      writeError({ error: "generic" });
    }
  }

  function onReload() {
    if (dirty && !window.confirm(t("confirm.reload"))) return;
    setReloadKey((k) => k + 1);
  }

  async function onClear() {
    if (!ready || !target.clear) return;
    if (!window.confirm(t("confirm.remove"))) return;
    // "Remove stage" goes away once it's done (and so do the lesson's video
    // and documents above): keep focus here, not on the page.
    headingRef.current?.focus();
    startWrite();
    try {
      // With the version this page shows, so a draft a colleague saved since
      // isn't deleted unseen: the server refuses, and the conflict banner
      // offers to reload it.
      const res = await target.clear(loaded!.base);
      if (!res.ok) {
        setStatus("error");
        if (res.error === "changed-elsewhere") setConflict("remove");
        else {
          const message = removeErrorMessage(res);
          setError(t(message.key, message.values));
        }
        return;
      }
    } catch {
      setStatus("error");
      setError(t("errors.removeFailed"));
      return;
    }
    setStatus("removed");
    setReloadKey((k) => k + 1);
    onCleared?.();
  }

  const busy = status === "saving";

  return (
    <Card className={embedded ? "shadow-none" : undefined}>
      <CardContent className="p-4" role="region" aria-labelledby={headingId}>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h3
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="text-sm font-semibold flex items-center gap-1.5"
          >
            <Puzzle className="h-4 w-4 text-[var(--accent)]" aria-hidden />
            {regionLabel ?? t("region.fallback")}
          </h3>
          {part ? null : (
            <Badge variant={authored ? "accent" : "muted"} className="text-[10px]">
              {authored ? t("badge.added") : t("badge.notAdded")}
            </Badge>
          )}
          {hasDraft ? <DraftBadge label={t("badge.draft")} /> : null}
        </div>

        {hasDraft ? (
          <div className="mb-3 rounded-lg border border-dashed border-[var(--warning)] bg-[var(--warning)]/10 p-3">
            <p className="text-sm font-semibold flex items-start gap-1.5">
              <FilePenLine
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--warning)]"
                aria-hidden
              />
              {t("draft.title")}
            </p>
            <p className="mt-1 text-sm">
              {authored ? t("draft.bodyLive") : t("draft.bodyNew")}
            </p>
          </div>
        ) : null}

        {conflict ? (
          <div
            className="mb-3 rounded-lg border border-[var(--warning)] bg-[var(--warning)]/10 p-3"
            role="alert"
          >
            <p className="text-sm flex items-start gap-1.5">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--warning)]"
                aria-hidden
              />
              <span>
                {conflict === "remove" ? t("conflictRemove") : t("conflict")}
              </span>
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={onReload}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              {t("actions.reload")}
            </Button>
          </div>
        ) : null}

        {breach ? (
          // Mounted fresh on each refusal, so it's announced.
          <div
            key="over-limit"
            className="mb-3 rounded-lg border border-[var(--danger)] bg-[var(--danger)]/10 p-3"
            role="alert"
          >
            <p
              ref={overLimitRef}
              tabIndex={-1}
              className="text-sm font-medium text-[var(--danger)] flex items-start gap-1.5"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
              {t("limits.title")}
            </p>
            <IssueList
              items={[
                {
                  text: limitText(breach, (key, values) => t(key, values), (l) => tLanguage(l)),
                  field: breachField,
                },
              ]}
              idFor={fieldIssues.idFor}
              itemId={() => overLimitId}
            />
            {breach.limit === "text" && breach.locale !== locale ? (
              <p className="mt-1 ml-6 text-xs text-[var(--muted-foreground)]">
                {t("limits.otherLanguage", { language: tLanguage(breach.locale) })}
              </p>
            ) : null}
          </div>
        ) : null}

        {notReady.length ? (
          // Mounted fresh on each refusal, so it's announced.
          <div
            key="not-ready"
            className="mb-3 rounded-lg border border-[var(--danger)] bg-[var(--danger)]/10 p-3"
            role="alert"
          >
            <p
              ref={notReadyRef}
              tabIndex={-1}
              className="text-sm font-medium text-[var(--danger)] flex items-start gap-1.5"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
              {t("missing.notReady")}
            </p>
            <IssueList
              items={notReady.map((issue) => ({
                text: issueText(issue),
                field: partIssueField(issue),
              }))}
              idFor={fieldIssues.idFor}
              itemId={refusedId}
            />
            <p className="mt-1 ml-6 text-xs text-[var(--muted-foreground)]">
              {t("missing.oneLanguage")}
            </p>
          </div>
        ) : edit && missing.length ? (
          <div
            key="missing"
            className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3"
          >
            <p className="text-sm font-medium flex items-start gap-1.5">
              <ListChecks
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--accent)]"
                aria-hidden
              />
              {t("missing.title")}
            </p>
            <IssueList
              items={missing.map((issue) => ({
                text: issueText(issue),
                field: partIssueField(issue),
              }))}
              idFor={fieldIssues.idFor}
            />
            <p className="mt-1 ml-6 text-xs text-[var(--muted-foreground)]">
              {t("missing.oneLanguage")}
            </p>
          </div>
        ) : null}

        {edit ? (
          <ExerciseFields value={edit} locale={locale} issues={fieldIssues} onChange={setEdit} />
        ) : loadFailed ? (
          <p className="text-sm text-[var(--danger)]" role="alert">
            {t("errors.load")}
          </p>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">{t("loading")}</p>
        )}

        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={onSave} disabled={busy || !ready}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Save className="h-4 w-4" aria-hidden />
              )}
              {/* Added content saves just itself: never "Save lesson" (de, el). */}
              {part ? tBlocks("saveContent") : t("actions.saveStage")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onSaveDraft}
              disabled={busy || !ready}
            >
              <FilePenLine className="h-4 w-4" aria-hidden />
              {t("actions.saveDraft")}
            </Button>
            {hasDraft ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={onDiscardDraft}
              >
                <Undo2 className="h-4 w-4" aria-hidden />
                {t("actions.discardDraft")}
              </Button>
            ) : null}
            {authored && target.clear ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={onClear}
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
                {t("actions.removeStage")}
              </Button>
            ) : null}
            {/* Always mounted, so what it says next is announced. */}
            <span
              role="status"
              aria-live="polite"
              className="text-xs text-[var(--success)] inline-flex items-start gap-1"
            >
              {status === "saved" ||
              status === "draftSaved" ||
              status === "draftDiscarded" ||
              status === "removed" ? (
                <>
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" aria-hidden />
                  {t(`status.${status}`)}
                </>
              ) : null}
            </span>
          </div>
          {error ? (
            <p
              role="alert"
              className="mt-2 text-sm text-[var(--danger)] flex items-start gap-1"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            {part
              ? tBlocks("partHint")
              : courseStatus === "published"
                ? t("hint.live")
                : t("hint.notLive")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

const NO_REFUSALS: ReadonlyMap<string, string> = new Map();

/**
 * The boxes of one exercise, by its kind. Their element ids are this
 * editor's own (`issues`, or made here), so several exercises in one lesson
 * never share one.
 */
export function ExerciseFields({
  value,
  locale,
  issues,
  onChange,
}: {
  value: ExerciseValue;
  locale: Locale;
  /** The editor's reasons and its ids for the boxes (StructureAuthor). */
  issues?: FieldIssues;
  onChange: (next: ExerciseValue) => void;
}) {
  const ownId = React.useId();
  const own = React.useMemo<FieldIssues>(
    () => ({ idFor: (field) => `${ownId}-field-${field}`, refused: NO_REFUSALS }),
    [ownId]
  );
  let fields: React.ReactNode;
  switch (value.kind) {
    case "simulation":
      fields = <SimulationEditor value={value} locale={locale} onChange={onChange} />;
      break;
    case "scenario":
      fields = <ScenarioEditor value={value} locale={locale} onChange={onChange} />;
      break;
    case "assessment":
      fields = <AssessmentEditor value={value} locale={locale} onChange={onChange} />;
      break;
    case "reflection":
      fields = <ReflectionPromptsEditor value={value} locale={locale} onChange={onChange} />;
      break;
    case "rating":
      fields = <RatingEditor value={value} locale={locale} onChange={onChange} />;
      break;
  }
  return (
    <FieldIssuesContext.Provider value={issues ?? own}>{fields}</FieldIssuesContext.Provider>
  );
}

/** "Draft" in words and a dashed outline — not colour alone. */
export function DraftBadge({ label }: { label: string }) {
  return (
    <Badge
      variant="muted"
      className="border-dashed border-[var(--warning)] text-[10px] text-[var(--foreground)]"
    >
      <FilePenLine className="h-3 w-3" aria-hidden />
      {label}
    </Badge>
  );
}

/* ------------------------------- simulation ------------------------------- */

function SimulationEditor({
  value,
  locale,
  onChange,
}: {
  value: StoredSimulation;
  locale: Locale;
  onChange: (s: StoredSimulation) => void;
}) {
  const t = useTranslations("exerciseEditor");
  const captions = React.useId();
  const set = (patch: Partial<StoredSimulation>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <LocField
        label={t("fields.stageTitle")}
        map={value.title ?? {}}
        locale={locale}
        onChange={(m) => set({ title: m })}
        placeholder={t("placeholders.simulationTitle")}
        maxLength={STRUCTURE_LIMITS.maxTitleChars}
        field={fieldKey("stageTitle")}
      />
      <LocField
        label={t("fields.prompt")}
        map={value.prompt}
        locale={locale}
        onChange={(m) => set({ prompt: m })}
        textarea
        field={fieldKey("simPrompt")}
      />
      <LocField
        label={t("fields.instruction")}
        map={value.instruction}
        locale={locale}
        onChange={(m) => set({ instruction: m })}
        placeholder={t("placeholders.instruction")}
        field={fieldKey("simInstruction")}
      />

      <p className="text-xs font-medium text-[var(--foreground)] pt-1">
        {t("simulation.optionsHint")}
      </p>
      <ul className="space-y-2">
        {value.options.map((o, i) => {
          const caption = `${captions}-option-${i}`;
          return (
            <li
              key={o.id}
              className="rounded-lg border border-[var(--border)] p-3"
            >
              <div role="group" aria-labelledby={caption} className="space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      set({
                        options: value.options.map((x) => ({
                          ...x,
                          isBest: x.id === o.id,
                        })),
                      })
                    }
                    aria-pressed={o.isBest}
                    aria-label={t("simulation.markBest", { n: i + 1 })}
                    className={`rounded-md p-1 ${
                      o.isBest
                        ? "text-[var(--accent)]"
                        : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    <Star
                      className="h-4 w-4"
                      fill={o.isBest ? "currentColor" : "none"}
                    />
                  </button>
                  <span className="text-[11px] text-[var(--muted-foreground)]">
                    <span id={caption}>{t("simulation.option", { n: i + 1 })}</span>
                    {o.isBest ? ` · ${t("simulation.best")}` : ""}
                  </span>
                  {value.options.length > 2 ? (
                    <button
                      type="button"
                      onClick={() =>
                        set({ options: value.options.filter((x) => x.id !== o.id) })
                      }
                      aria-label={t("simulation.removeOption", { n: i + 1 })}
                      className="ml-auto rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
                <LocField
                  label={t("fields.optionText")}
                  field={fieldKey("simOptionText", { option: i + 1 })}
                  context={caption}
                  map={o.text}
                  locale={locale}
                  onChange={(m) =>
                    set({
                      options: value.options.map((x) =>
                        x.id === o.id ? { ...x, text: m } : x
                      ),
                    })
                  }
                />
                <LocField
                  label={t("fields.feedback")}
                  field={fieldKey("simOptionFeedback", { option: i + 1 })}
                  context={caption}
                  map={o.feedback}
                  locale={locale}
                  onChange={(m) =>
                    set({
                      options: value.options.map((x) =>
                        x.id === o.id ? { ...x, feedback: m } : x
                      ),
                    })
                  }
                />
              </div>
            </li>
          );
        })}
      </ul>
      {value.options.length < STRUCTURE_LIMITS.maxOptions ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            set({
              options: [
                ...value.options,
                { id: newId("o"), isBest: false, text: {}, feedback: {} },
              ],
            })
          }
        >
          <Plus className="h-4 w-4" />
          {t("simulation.addOption")}
        </Button>
      ) : null}
    </div>
  );
}

/* -------------------------------- scenario -------------------------------- */

function QualitySelect({
  value,
  onChange,
}: {
  value: OutcomeQuality;
  onChange: (q: OutcomeQuality) => void;
}) {
  const t = useTranslations("exerciseEditor.scenario");
  return (
    <label className="text-[11px] text-[var(--muted-foreground)] inline-flex items-center gap-1">
      {t("quality")}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as OutcomeQuality)}
        aria-label={t("qualityLabel")}
        className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1 text-xs"
      >
        {QUALITIES.map((q) => (
          <option key={q} value={q}>
            {t(`qualities.${q}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ScenarioEditor({
  value,
  locale,
  onChange,
}: {
  value: StoredScenario;
  locale: Locale;
  onChange: (s: StoredScenario) => void;
}) {
  const t = useTranslations("exerciseEditor");
  const captions = React.useId();
  const set = (patch: Partial<StoredScenario>) => onChange({ ...value, ...patch });
  const setChoice = (id: string, patch: Partial<StoredScenarioChoice>) =>
    set({
      choices: value.choices.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });

  return (
    <div className="space-y-3">
      <LocField
        label={t("fields.stageTitle")}
        map={value.title ?? {}}
        locale={locale}
        onChange={(m) => set({ title: m })}
        placeholder={t("placeholders.scenarioTitle")}
        maxLength={STRUCTURE_LIMITS.maxTitleChars}
        field={fieldKey("stageTitle")}
      />
      <LocField
        label={t("fields.setup")}
        map={value.setup}
        locale={locale}
        onChange={(m) => set({ setup: m })}
        textarea
        field={fieldKey("scenarioSetup")}
      />
      <LocField
        label={t("fields.firstQuestion")}
        map={value.question}
        locale={locale}
        onChange={(m) => set({ question: m })}
        field={fieldKey("scenarioQuestion")}
      />
      <LocField
        label={t("fields.followupQuestion")}
        map={value.followupQuestion}
        locale={locale}
        onChange={(m) => set({ followupQuestion: m })}
        field={fieldKey("scenarioFollowupQuestion")}
      />

      <p className="text-xs font-medium text-[var(--foreground)] pt-1">
        {t("scenario.choicesHint")}
      </p>
      <ul className="space-y-2">
        {value.choices.map((c, i) => {
          const caption = `${captions}-choice-${i}`;
          const choice = i + 1;
          return (
            <li
              key={c.id}
              className="rounded-lg border border-[var(--border)] p-3"
            >
              <div role="group" aria-labelledby={caption} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span id={caption} className="text-[11px] text-[var(--muted-foreground)]">
                    {t("scenario.choice", { n: choice })}
                  </span>
                  <QualitySelect
                    value={c.quality}
                    onChange={(q) => setChoice(c.id, { quality: q })}
                  />
                  {value.choices.length > 2 ? (
                    <button
                      type="button"
                      onClick={() =>
                        set({ choices: value.choices.filter((x) => x.id !== c.id) })
                      }
                      aria-label={t("scenario.removeChoice", { n: i + 1 })}
                      className="ml-auto rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
                <LocField
                  label={t("fields.choiceText")}
                  field={fieldKey("scenarioChoiceText", { choice })}
                  context={caption}
                  map={c.text}
                  locale={locale}
                  onChange={(m) => setChoice(c.id, { text: m })}
                />
                <LocField
                  label={t("fields.outcome")}
                  field={fieldKey("scenarioChoiceOutcome", { choice })}
                  context={caption}
                  map={c.outcome}
                  locale={locale}
                  onChange={(m) => setChoice(c.id, { outcome: m })}
                  textarea
                />

                {/* Follow-ups */}
                <div className="ml-3 border-l border-[var(--border)] pl-3 space-y-2">
                  {(c.followups ?? []).map((f, j) => {
                    const at = { choice, followup: j + 1 };
                    const followupCaption = `${caption}-followup-${j}`;
                    return (
                      <div
                        key={f.id}
                        role="group"
                        aria-labelledby={followupCaption}
                        className="space-y-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            id={followupCaption}
                            className="text-[11px] text-[var(--muted-foreground)]"
                          >
                            {t("scenario.followup", at)}
                          </span>
                          <QualitySelect
                            value={f.quality}
                            onChange={(q) =>
                              setChoice(c.id, {
                                followups: (c.followups ?? []).map((x) =>
                                  x.id === f.id ? { ...x, quality: q } : x
                                ),
                              })
                            }
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setChoice(c.id, {
                                followups: (c.followups ?? []).filter(
                                  (x) => x.id !== f.id
                                ),
                              })
                            }
                            aria-label={t("scenario.removeFollowup", at)}
                            className="ml-auto rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                        <LocField
                          label={t("fields.followupText")}
                          field={fieldKey("scenarioFollowupText", at)}
                          context={followupCaption}
                          map={f.text}
                          locale={locale}
                          onChange={(m) =>
                            setChoice(c.id, {
                              followups: (c.followups ?? []).map((x) =>
                                x.id === f.id ? { ...x, text: m } : x
                              ),
                            })
                          }
                        />
                        <LocField
                          label={t("fields.followupOutcome")}
                          field={fieldKey("scenarioFollowupOutcome", at)}
                          context={followupCaption}
                          map={f.outcome}
                          locale={locale}
                          onChange={(m) =>
                            setChoice(c.id, {
                              followups: (c.followups ?? []).map((x) =>
                                x.id === f.id ? { ...x, outcome: m } : x
                              ),
                            })
                          }
                          textarea
                        />
                      </div>
                    );
                  })}
                  {(c.followups ?? []).length < STRUCTURE_LIMITS.maxFollowups ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setChoice(c.id, {
                          followups: [
                            ...(c.followups ?? []),
                            { id: newId("f"), quality: "okay", text: {}, outcome: {} },
                          ],
                        })
                      }
                    >
                      <Plus className="h-4 w-4" />
                      {t("scenario.addFollowup")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {value.choices.length < STRUCTURE_LIMITS.maxChoices ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            set({
              choices: [
                ...value.choices,
                { id: newId("c"), quality: "okay", text: {}, outcome: {}, followups: [] },
              ],
            })
          }
        >
          <Plus className="h-4 w-4" />
          {t("scenario.addChoice")}
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------- assessment ------------------------------- */

function AssessmentEditor({
  value,
  locale,
  onChange,
}: {
  value: StoredAssessment;
  locale: Locale;
  onChange: (s: StoredAssessment) => void;
}) {
  const t = useTranslations("exerciseEditor");
  const set = (patch: Partial<StoredAssessment>) => onChange({ ...value, ...patch });
  // Radio group names from useId, not the question ids: a new question's id
  // is random, and would differ between the server and the browser.
  const group = React.useId();
  const captions = React.useId();

  return (
    <div className="space-y-3">
      <LocField
        label={t("fields.stageTitle")}
        map={value.title ?? {}}
        locale={locale}
        onChange={(m) => set({ title: m })}
        placeholder={t("placeholders.assessmentTitle")}
        maxLength={STRUCTURE_LIMITS.maxTitleChars}
        field={fieldKey("stageTitle")}
      />
      <LocField
        label={t("fields.intro")}
        map={value.intro}
        locale={locale}
        onChange={(m) => set({ intro: m })}
        field={fieldKey("assessmentIntro")}
      />

      <ul className="space-y-2">
        {value.questions.map((q, i) => {
          const caption = `${captions}-question-${i}`;
          const question = i + 1;
          return (
            <li
              key={q.id}
              className="rounded-lg border border-[var(--border)] p-3"
            >
              <div role="group" aria-labelledby={caption} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span id={caption} className="text-[11px] text-[var(--muted-foreground)]">
                    {t("assessment.question", { n: question })}
                  </span>
                  {value.questions.length > 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        set({
                          questions: value.questions.filter((x) => x.id !== q.id),
                        })
                      }
                      aria-label={t("assessment.removeQuestion", { n: i + 1 })}
                      className="ml-auto rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
                <LocField
                  label={t("fields.question")}
                  field={fieldKey("assessmentQuestionText", { question })}
                  context={caption}
                  map={q.question}
                  locale={locale}
                  onChange={(m) =>
                    set({
                      questions: value.questions.map((x) =>
                        x.id === q.id ? { ...x, question: m } : x
                      ),
                    })
                  }
                />
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  {t("assessment.answersHint")}
                </p>
                {q.options.map((a, j) => (
                  <div key={a.id} className="flex items-start gap-2">
                    <input
                      type="radio"
                      name={`${group}-correct-${i}`}
                      checked={q.correctOptionId === a.id}
                      onChange={() =>
                        set({
                          questions: value.questions.map((x) =>
                            x.id === q.id ? { ...x, correctOptionId: a.id } : x
                          ),
                        })
                      }
                      aria-label={t("assessment.isCorrect", { n: j + 1 })}
                      className="mt-2.5"
                    />
                    <div className="flex-1 min-w-0">
                      <LocField
                        label={t("fields.answer", { n: j + 1 })}
                        field={fieldKey("assessmentAnswerText", { question, answer: j + 1 })}
                        context={caption}
                        map={a.text}
                        locale={locale}
                        onChange={(m) =>
                          set({
                            questions: value.questions.map((x) =>
                              x.id === q.id
                                ? {
                                    ...x,
                                    options: x.options.map((y) =>
                                      y.id === a.id ? { ...y, text: m } : y
                                    ),
                                  }
                                : x
                            ),
                          })
                        }
                      />
                    </div>
                    {q.options.length > 2 ? (
                      <button
                        type="button"
                        onClick={() =>
                          set({
                            questions: value.questions.map((x) =>
                              x.id === q.id
                                ? {
                                    ...x,
                                    options: x.options.filter((y) => y.id !== a.id),
                                  }
                                : x
                            ),
                          })
                        }
                        aria-label={t("assessment.removeAnswer", { n: j + 1 })}
                        className="mt-1 rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                ))}
                {q.options.length < STRUCTURE_LIMITS.maxAnswers ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      set({
                        questions: value.questions.map((x) =>
                          x.id === q.id
                            ? { ...x, options: [...x.options, { id: newId("a"), text: {} }] }
                            : x
                        ),
                      })
                    }
                  >
                    <Plus className="h-4 w-4" />
                    {t("assessment.addAnswer")}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {value.questions.length < STRUCTURE_LIMITS.maxQuestions ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            set({
              questions: [
                ...value.questions,
                {
                  id: newId("q"),
                  correctOptionId: "",
                  question: {},
                  options: [
                    { id: newId("a"), text: {} },
                    { id: newId("a"), text: {} },
                  ],
                },
              ],
            })
          }
        >
          <Plus className="h-4 w-4" />
          {t("assessment.addQuestion")}
        </Button>
      ) : null}
    </div>
  );
}

"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getStructure,
  saveStructure,
  saveStructureDraft,
  discardStructureDraft,
  clearStructure,
  type StructureState,
} from "@/app/actions/structure";
import {
  validateStructure,
  fieldKey,
  issueField,
  type StoredStructure,
  type StoredSimulation,
  type StoredScenario,
  type StoredAssessment,
  type StoredScenarioChoice,
  type LocalizedText,
  type StructureIssue,
  type StructureStageKey,
} from "@/lib/cms/structure";
import { STRUCTURE_LIMITS } from "@/lib/cms/structure-sanitize";
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

const QUALITIES: OutcomeQuality[] = ["best", "okay", "poor"];

const inputCls =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm aria-invalid:border-[var(--danger)]";

let idSeq = 0;
const newId = (p: string) => `${p}${(idSeq++).toString(36)}${Date.now().toString(36).slice(-3)}`;

function setLoc(map: LocalizedText, locale: Locale, value: string): LocalizedText {
  return { ...map, [locale]: value };
}

function emptyStructure(kind: StructureStageKey): StoredStructure {
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
  edit: StoredStructure;
  /** What `edit` started from (or was last saved as): unsaved = edit !== saved. */
  saved: StoredStructure;
  /**
   * What the server holds as far as this editor knows. Sent with every
   * write, so the server can refuse it if someone else has saved the stage
   * or its draft since (both hold every language — D33).
   */
  base: StructureState;
}

type Status =
  | "idle"
  | "saving"
  | "saved"
  | "draftSaved"
  | "draftDiscarded"
  | "removed"
  | "error";

/**
 * What the text boxes below need to know about the reasons listed above:
 * `idFor` gives each box (by its fieldKey) a stable element id, so a reason
 * can take the author to its box; `refused` maps each box a refused
 * "Save stage" named to the id of that reason, so the box is announced as
 * invalid, with the reason as its description.
 */
interface FieldIssues {
  idFor: (field: string) => string;
  refused: ReadonlyMap<string, string>;
}

const FieldIssuesContext = React.createContext<FieldIssues>({
  idFor: (field) => field,
  refused: new Map(),
});

type WriteError =
  | "forbidden"
  | "bad-input"
  | "kind-mismatch"
  | "not-cms-course"
  | "too-large";

/**
 * Author one interactive stage (simulation / scenario / assessment) of a
 * CMS-created course, on the course page. The page gives the lesson and the
 * language being written; the editor holds every language at once, so a
 * language switch keeps unsaved work.
 *
 * Two ways to save: "Save draft" keeps unfinished work for editors only,
 * whatever is still missing; "Save stage" saves it for learners once it is
 * complete (on a published course it is live at once). What is still
 * missing is listed as the author types, naming each field.
 *
 * It reads the stage fresh whenever it opens, rather than taking what the
 * page loaded: a colleague may have saved another language since.
 */
export function StructureAuthor({
  courseSlug: slug,
  kind,
  locale,
  courseStatus,
  regionLabel,
  embedded = false,
  onSaved,
  onDraftChange,
  onCleared,
  onDirtyChange,
}: {
  courseSlug: string;
  kind: StructureStageKey;
  /** The language being written. The editor holds every language at once. */
  locale: Locale;
  /** Says whether "Save stage" goes live at once (published) or not. */
  courseStatus?: CourseStatus;
  /** Heading and region name, e.g. "Interactive stage — Simulation". */
  regionLabel?: string;
  /** Inside a lesson on the course page: lighter frame. */
  embedded?: boolean;
  onSaved?: (structure: StoredStructure) => void;
  /** The stored draft changed: saved (the draft as stored) or gone (null). */
  onDraftChange?: (draft: StoredStructure | null) => void;
  onCleared?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useTranslations("exerciseEditor");
  const headingId = React.useId();
  // Element ids for the text boxes and for the reasons a save was refused.
  const fieldsId = React.useId();
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const notReadyRef = React.useRef<HTMLParagraphElement>(null);
  // The stage plus the (course, stage) it belongs to, as one unit. Deriving
  // `ready` from the key means Save waits until the stage has loaded.
  const [loaded, setLoaded] = React.useState<LoadedStructure | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [status, setStatus] = React.useState<Status>("idle");
  // Why the last "Save stage" was refused, as the server said it.
  const [notReady, setNotReady] = React.useState<StructureIssue[]>([]);
  const [error, setError] = React.useState("");
  // Someone else saved this stage after it was loaded here, found by a
  // refused save or a refused "Remove stage".
  const [conflict, setConflict] = React.useState<"save" | "remove" | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  const setEdit = (next: StoredStructure) => {
    setLoaded((l) => (l ? { ...l, edit: next } : l));
    // These describe the stage before this edit.
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
    getStructure(slug, kind).then(
      (state) => {
        if (cancelled) return;
        if (!state) {
          setLoadFailed(true);
          return;
        }
        const edit = state.draft ?? state.structure ?? emptyStructure(kind);
        setLoaded({ key: `${slug}:${kind}`, edit, saved: edit, base: state });
        setLoadFailed(false);
        setConflict(null);
        setNotReady([]);
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
  }, [slug, kind, reloadKey]);

  // Until the load resolves, `loaded.key` doesn't match (or `loaded` is
  // null), so `ready` is false — no synchronous reset needed.
  const ready = loaded?.key === `${slug}:${kind}`;
  const edit = ready ? loaded!.edit : null;
  const authored = ready ? loaded!.base.structure !== null : false;
  const hasDraft = ready ? loaded!.base.draft !== null : false;
  const dirty = ready && loaded!.edit !== loaded!.saved;
  useReportDirty(dirty, onDirtyChange);

  // What learners would still miss, as the author types (the same check the
  // server runs before "Save stage").
  const missing = React.useMemo(
    () => (edit ? validateStructure(edit) : []),
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

  const issueText = (issue: StructureIssue) =>
    t(`issues.${issue.code}`, issue.params ?? {});

  const refusedId = React.useCallback(
    (i: number) => `${fieldsId}-refused-${i}`,
    [fieldsId]
  );
  const fieldIssues = React.useMemo<FieldIssues>(() => {
    const refused = new Map<string, string>();
    notReady.forEach((issue, i) => {
      const field = issueField(issue);
      if (field && !refused.has(field)) refused.set(field, refusedId(i));
    });
    return { idFor: (field) => `${fieldsId}-field-${field}`, refused };
  }, [notReady, fieldsId, refusedId]);

  function writeError(code: WriteError | "changed-elsewhere" | "generic") {
    if (code === "changed-elsewhere") {
      // Nothing was written; the edits stay on screen.
      setConflict("save");
      return;
    }
    setError(
      code === "forbidden"
        ? t("errors.forbidden")
        : code === "not-cms-course"
          ? t("errors.notCms")
          : code === "kind-mismatch" || code === "bad-input"
            ? t("errors.mismatch")
            : code === "too-large"
              ? t("errors.tooLarge")
              : t("errors.generic")
    );
  }

  function startWrite() {
    setStatus("saving");
    setError("");
    setConflict(null);
    setNotReady([]);
  }

  async function onSave() {
    if (!edit || !ready) return;
    const savedKey = `${slug}:${kind}`;
    const sent = edit;
    startWrite();
    try {
      const res = await saveStructure(slug, kind, sent, loaded!.base);
      if (res.ok) {
        // Keep what's on screen rather than reloading: a reload resets the
        // status (the "Saved" confirmation would flash for ~25ms) and
        // overwrites anything typed while it was in flight — which stays
        // unsaved, since it's newer than what was sent. The server's copy
        // (cleaned, blank languages dropped) is the base for the next write.
        setLoaded((l) =>
          l?.key === savedKey
            ? { ...l, saved: sent, base: { structure: res.structure, draft: null } }
            : l
        );
        setStatus("saved");
        // The page re-reads itself (what learners see, warnings).
        onSaved?.(res.structure);
        return;
      }
      setStatus("error");
      if (res.error === "invalid") setNotReady(res.issues);
      else writeError(res.error);
    } catch {
      setStatus("error");
      writeError("generic");
    }
  }

  async function onSaveDraft() {
    if (!edit || !ready) return;
    const savedKey = `${slug}:${kind}`;
    const sent = edit;
    startWrite();
    try {
      const res = await saveStructureDraft(slug, kind, sent, loaded!.base);
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
      writeError(res.error);
    } catch {
      setStatus("error");
      writeError("generic");
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
      const res = await discardStructureDraft(slug, kind, loaded!.base);
      if (res.ok) {
        setStatus("draftDiscarded");
        setReloadKey((k) => k + 1);
        onDraftChange?.(null);
        return;
      }
      setStatus("error");
      writeError(res.error);
    } catch {
      setStatus("error");
      writeError("generic");
    }
  }

  function onReload() {
    if (dirty && !window.confirm(t("confirm.reload"))) return;
    setReloadKey((k) => k + 1);
  }

  async function onClear() {
    if (!ready) return;
    if (!window.confirm(t("confirm.remove"))) return;
    // "Remove stage" goes away once it's done (and so do the lesson's video
    // and documents above): keep focus here, not on the page.
    headingRef.current?.focus();
    startWrite();
    try {
      // With the version this page shows, so a draft a colleague saved since
      // isn't deleted unseen: the server refuses, and the conflict banner
      // offers to reload it.
      const res = await clearStructure(slug, kind, loaded!.base);
      if (!res.ok) {
        setStatus("error");
        if (res.error === "changed-elsewhere") setConflict("remove");
        else setError(t("errors.removeFailed"));
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
            {regionLabel ?? "Interactive stage"}
          </h3>
          <Badge variant={authored ? "accent" : "muted"} className="text-[10px]">
            {authored ? t("badge.added") : t("badge.notAdded")}
          </Badge>
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
              issues={notReady}
              text={issueText}
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
            <IssueList issues={missing} text={issueText} idFor={fieldIssues.idFor} />
            <p className="mt-1 ml-6 text-xs text-[var(--muted-foreground)]">
              {t("missing.oneLanguage")}
            </p>
          </div>
        ) : null}

        {edit ? (
          <FieldIssuesContext.Provider value={fieldIssues}>
            {edit.kind === "simulation" ? (
              <SimulationEditor value={edit} locale={locale} onChange={setEdit} />
            ) : edit.kind === "scenario" ? (
              <ScenarioEditor value={edit} locale={locale} onChange={setEdit} />
            ) : (
              <AssessmentEditor value={edit} locale={locale} onChange={setEdit} />
            )}
          </FieldIssuesContext.Provider>
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
              {t("actions.saveStage")}
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
            {authored ? (
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
            {courseStatus === "published" ? t("hint.live") : t("hint.notLive")}
          </p>
        </div>
      </CardContent>
    </Card>
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

/**
 * The reasons, each naming its box. A reason about one box is a button that
 * takes the author there, so it can be reached by keyboard or voice from
 * the list rather than by counting identical boxes.
 */
function IssueList({
  issues,
  text,
  idFor,
  itemId,
}: {
  issues: StructureIssue[];
  text: (issue: StructureIssue) => string;
  idFor: (field: string) => string;
  /** Ids for the items, when boxes refer to them as their description. */
  itemId?: (i: number) => string;
}) {
  return (
    <ul className="mt-1 ml-6 list-disc text-sm text-[var(--foreground)] break-words">
      {issues.map((issue, i) => {
        const field = issueField(issue);
        return (
          <li key={i} id={itemId?.(i)}>
            {field ? (
              <button
                type="button"
                onClick={() => document.getElementById(idFor(field))?.focus()}
                className="py-0.5 text-left underline underline-offset-2 hover:text-[var(--accent)]"
              >
                {text(issue)}
              </button>
            ) : (
              text(issue)
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* --------------------------------- shared --------------------------------- */

function LocField({
  label,
  map,
  locale,
  onChange,
  textarea,
  placeholder,
  maxLength = STRUCTURE_LIMITS.maxTextChars,
  field,
  context,
}: {
  label: string;
  map: LocalizedText;
  locale: Locale;
  onChange: (next: LocalizedText) => void;
  textarea?: boolean;
  placeholder?: string;
  /** The server's limit (STRUCTURE_LIMITS): the box stops there. */
  maxLength?: number;
  /** The fieldKey of the reason that would name this box, if any. */
  field?: string;
  /**
   * The id of the caption this box belongs to ("Choice 2"), so its name
   * says which one it is: "Choice 2 Choice text", not one of several
   * identical "Choice text" boxes.
   */
  context?: string;
}) {
  const { idFor, refused } = React.useContext(FieldIssuesContext);
  const labelId = React.useId();
  const val = map[locale] ?? "";
  // The reason a refused save gave for this box, read out as its description.
  const reasonId = field ? refused.get(field) : undefined;
  const a11y = {
    id: field ? idFor(field) : undefined,
    "aria-labelledby": context ? `${context} ${labelId}` : undefined,
    "aria-invalid": reasonId ? true : undefined,
    "aria-describedby": reasonId,
  };
  return (
    <label className="block text-xs text-[var(--muted-foreground)]">
      <span id={labelId} className="block mb-1">
        {label}
      </span>
      {textarea ? (
        <textarea
          {...a11y}
          value={val}
          onChange={(e) => onChange(setLoc(map, locale, e.target.value))}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={2}
          className={inputCls}
        />
      ) : (
        <input
          {...a11y}
          value={val}
          onChange={(e) => onChange(setLoc(map, locale, e.target.value))}
          placeholder={placeholder}
          maxLength={maxLength}
          className={inputCls}
        />
      )}
    </label>
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
      />
      <LocField
        label={t("fields.intro")}
        map={value.intro}
        locale={locale}
        onChange={(m) => set({ intro: m })}
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

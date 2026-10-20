"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, ChevronDown, FilePenLine, PenLine, Plus } from "lucide-react";
import {
  addSection,
  deleteSection,
  moveSection,
  renameSection,
  setSectionHidden,
} from "@/app/actions/sections";
import type {
  CourseKind,
  CourseOutline,
  LessonOutline,
} from "@/lib/cms/course-admin-types";
import type { CourseStatus } from "@/lib/cms/course-status";
import { offersAdd } from "@/lib/cms/course-derive";
import {
  SECTION_LIMITS,
  type AddSectionChoice,
  type LabelSource,
  type NarrativeKey,
  type OutlineResult,
  type Refused,
  type SectionId,
  type SectionsMeta,
} from "@/lib/cms/sections/contract";
import type { Locale } from "@/lib/cms/types";
import { AddLessonPicker } from "./AddLessonPicker";
import { LiveChangeConfirm } from "./LiveChangeConfirm";
import { addControl, choiceState, learnersOf, rowControls, type Control, type ListContext } from "./live-controls";
import {
  closedDate,
  fallbackName,
  focusAfterDelete,
  focusAfterMove,
  nameIn,
  refusalGone,
  refusalRefreshes,
  refusalWords,
  type ContentNames,
} from "./list-model";
import { SectionRow, type RowElement, type RowMode, type RowStatus } from "./SectionRow";

/** Ask the panel to open a lesson's rename box (the lesson card's Rename). */
export interface RenameRequest {
  id: string;
  /** Bumped per request, so the same lesson can be asked for twice. */
  n: number;
}

/** How many learners a change touches, as the page or (when it asked first) the server counted. */
type Counts = { learners: number; finished: number };
/** A change to a lesson's place or visibility waiting for the editor's confirmation (spec 7.3). */
type PendingChange = { op: "move"; dir: -1 | 1 } | { op: "hide"; hidden: boolean };
type Where = { row: string; mode: RowMode; change?: PendingChange; counts?: Counts } | null;
type Picker = { from: number | null; confirm?: { counts?: Counts } } | null;
/** Where a refusal is said: a lesson's row, the picker, or the list as a whole ("list"). */
type ErrorAt = { at: string; text: string } | null;

/**
 * The lesson list of a course created here (spec 11.1), beside the lessons
 * on wide screens and a disclosure "Lessons (8)" above them on narrow ones.
 * It keeps Release 0's lesson navigation — the "Lessons" landmark, a
 * "n. Name" link to each lesson and today's "Add guided practice / an
 * applied scenario / a quick check" for the exercises the course doesn't
 * have — and adds each lesson's actions and "Add lesson".
 *
 * Every change goes to the server with the list's base; its answer is the
 * whole course outline, which replaces the page's (D39), also when a
 * colleague changed the list first (then the page says so). Focus stays
 * predictable (the pressed button, the next lesson after a delete, the new
 * lesson's heading after an add) and each change is announced once in the
 * page's polite live region. There is no drag and drop (WCAG 2.5.7).
 *
 * On a course with learners (D66, spec 7.3) adding, moving, hiding and
 * showing a lesson ask first: LiveChangeConfirm opens in place of the
 * row's buttons (or the picker's) with how many learners are taking the
 * course, and only its own button sends the change, confirmed. When the
 * server knew of learners the page didn't, it asks with its own counts. A
 * delete that learners keep from happening says so in its confirmation,
 * with Hide instead; from the 1 December cut-off the changes a published
 * course with learners refuses say why (D67).
 */
export function LessonListPanel({
  slug,
  kind,
  status,
  sections,
  lessons,
  enrolled,
  lang,
  names,
  lessonLabel,
  onAddStage,
  onOutline,
  onRenamed,
  onAdded,
  onDeleted,
  refresh,
  announce,
  renameRequest,
}: {
  slug: string;
  kind: CourseKind;
  status: CourseStatus;
  sections: SectionsMeta;
  lessons: LessonOutline[];
  enrolled: number;
  lang: Locale;
  names: ContentNames;
  /** "n. Name" for a lesson id. */
  lessonLabel: (key: string) => string;
  /** Today's "Add …" slots: open that lesson to write it. */
  onAddStage: (key: string) => void;
  /** A structural result (or a colleague's list, on a refusal): take it in. */
  onOutline: (outline: CourseOutline) => void;
  onRenamed: (
    key: string,
    label: string,
    version: string | null,
    name: { text: string; source: LabelSource }
  ) => void;
  /** A lesson was added: open it and put focus on its heading. */
  onAdded: (id: string) => void;
  /** A lesson was deleted here: its card's editors start again from what is stored. */
  onDeleted?: (id: string) => void;
  refresh: () => void;
  announce: (text: string) => void;
  renameRequest?: RenameRequest | null;
}) {
  const t = useTranslations("lessonList");
  const tLive = useTranslations("liveChanges");
  const tNav = useTranslations("courseManager.page");
  const tDraft = useTranslations("exerciseEditor.page");
  const locale = useLocale();
  const uid = React.useId();
  const ctx: ListContext = {
    kind,
    status,
    sections,
    enrolled,
    learnerKeys: lessons.filter((l) => l.section && l.live).map((l) => l.key),
    withData: Object.fromEntries(
      lessons.flatMap((l) => (l.learnersWithData === undefined ? [] : [[l.key, l.learnersWithData]]))
    ),
  };
  const list = sections.resolved.sections;
  const learners = learnersOf(ctx);
  const pageCounts: Counts = { learners, finished: sections.finished ?? 0 };
  const date = closedDate(sections.closedFrom, locale);

  const [expanded, setExpanded] = React.useState(false);
  const [where, setWhere] = React.useState<Where>(null);
  const [picker, setPicker] = React.useState<Picker>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<ErrorAt>(null);
  const [focus, setFocus] = React.useState<{ id: string; n: number } | null>(null);

  const elId = React.useCallback((row: string, part: RowElement) => `${uid}-${row}-${part}`, [uid]);
  const openerId = `${uid}-add`;
  const pickerAddId = `${uid}-picker-add`;
  const listId = `${uid}-list`;
  const focusEl = (id: string) => setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));

  React.useEffect(() => {
    if (focus) document.getElementById(focus.id)?.focus();
  }, [focus]);

  // The lesson card's "Rename": open this panel at that lesson's name.
  // Taken once per request, while rendering (no effect round trip); the
  // rename box puts focus on its input when it mounts.
  const [seenRequest, setSeenRequest] = React.useState(renameRequest ?? null);
  if (renameRequest && renameRequest !== seenRequest) {
    setSeenRequest(renameRequest);
    setExpanded(true);
    setPicker(null);
    setError(null);
    setWhere({ row: renameRequest.id, mode: "rename" });
  }

  const byId = new Map(lessons.map((l) => [l.key, l]));
  const nameOf = (id: string) => byId.get(id)?.section?.name[lang]?.text ?? lessonLabel(id);
  const restoreName = (key: NarrativeKey) => names.standard[lang][key];

  /**
   * Ids of the shared texts that say why a control is refused, or, for a
   * change that asks first, how many learners it touches.
   */
  const describe = (c: Control): string | undefined => {
    if (c.kind === "locked") return `${uid}-why-${c.why}`;
    if (c.kind === "learners") return `${uid}-why-learners`;
    if (c.kind === "enabled" && c.confirm) return `${uid}-learners`;
    return undefined;
  };

  /** A refusal in words: the lesson list's, or the rules' for a course people are taking. */
  function refusalText(res: Refused): string {
    const words = refusalWords(res.error);
    if (words.ns === "liveChanges") {
      return tLive(words.key, {
        count: res.error === "has-learners" ? res.count : learners,
        date: res.error === "restructure-closed" ? closedDate(res.from, locale) : date,
      });
    }
    const max = res.error === "label-too-long" ? SECTION_LIMITS.labelChars : sections.max;
    return t(words.key, { count: learners, max });
  }

  /**
   * A refusal in words, where it happened; a page that is behind re-reads
   * the course. When the lesson it was about is gone from the fresh list (a
   * colleague deleted it), its row goes too: the refusal is then said above
   * "Add lesson", and focus moves to the next lesson (or "Add lesson").
   */
  function refused(res: Refused, at: string, text = refusalText(res)) {
    const fresh = res.error === "changed-elsewhere" && res.outline ? res.outline : null;
    if (fresh) onOutline(fresh);
    else if (refusalRefreshes(res.error)) refresh();
    const after = fresh ? (fresh.sections?.resolved.sections ?? []).map((s): string => s.id) : null;
    if (refusalGone(at, res.error, after)) {
      setWhere(null);
      setError({ at: "list", text });
      const next = focusAfterDelete(
        list.map((s) => s.id),
        at
      );
      focusEl(next && (after === null || after.includes(next)) ? elId(next, "link") : openerId);
      return;
    }
    setError({ at, text });
  }

  /**
   * Run one structural change; true when it was stored. `ask` is called
   * instead of saying a refusal when the server wants a confirmation the
   * page didn't know was needed (needs-confirmation), with its counts.
   */
  async function run(
    at: string,
    call: () => Promise<OutlineResult>,
    done: (outline: CourseOutline, id: string | undefined) => void,
    refusedText?: (res: Refused) => string | undefined,
    ask?: (counts: Counts) => void
  ): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await call();
      if (res.ok) {
        onOutline(res.outline);
        done(res.outline, res.id);
        return true;
      }
      if (res.error === "needs-confirmation" && ask) {
        refresh();
        ask({ learners: res.learners, finished: res.finished });
        return false;
      }
      refused(res, at, refusedText?.(res));
    } catch {
      setError({ at, text: t("errors.generic") });
    } finally {
      setBusy(false);
    }
    return false;
  }

  const sectionName = (outline: CourseOutline, id: string) =>
    outline.lessons.find((l) => l.key === id)?.section?.name[lang]?.text ?? nameOf(id);

  /** Open the row's confirmation for a change (spec 7.3): its heading takes focus. */
  function askFirst(id: string, change: PendingChange, counts?: Counts) {
    setError(null);
    setPicker(null);
    setWhere({ row: id, mode: "confirm", change, counts });
  }

  function move(id: SectionId, dir: -1 | 1, confirm?: true) {
    const index = list.findIndex((s) => s.id === id);
    const controls = rowControls(ctx, id);
    const control = dir === -1 ? controls.moveUp : controls.moveDown;
    if (!confirm && control.kind === "enabled" && control.confirm) return askFirst(id, { op: "move", dir });
    void run(
      id,
      () => moveSection(slug, id, dir, sections.version, confirm),
      (outline) => {
        setWhere({ row: id, mode: "actions" });
        const after = outline.sections?.resolved.sections ?? [];
        const position = after.findIndex((s) => s.id === id) + 1;
        announce(t("moved", { name: sectionName(outline, id), position, total: after.length }));
        focusEl(elId(id, focusAfterMove(index, dir, list.length)));
      },
      undefined,
      (counts) => askFirst(id, { op: "move", dir }, counts)
    );
  }

  function hide(id: SectionId, hidden: boolean, confirm?: true) {
    const control = rowControls(ctx, id).hide;
    if (!confirm && control.kind === "enabled" && control.confirm) return askFirst(id, { op: "hide", hidden });
    void run(
      id,
      () => setSectionHidden(slug, id, hidden, sections.version, confirm),
      (outline) => {
        setWhere({ row: id, mode: "actions" });
        const name = sectionName(outline, id);
        announce(hidden ? t("hiddenDone", { name }) : t("shownDone", { name }));
        focusEl(elId(id, "hide"));
      },
      undefined,
      (counts) => askFirst(id, { op: "hide", hidden }, counts)
    );
  }

  /** The row's confirmation, cancelled (or Escape): back to its buttons, focus on its Actions button. */
  function cancelConfirm(id: string) {
    setError(null);
    setWhere({ row: id, mode: "actions" });
    focusEl(elId(id, "actions"));
  }

  function remove(lesson: LessonOutline) {
    const id = lesson.key as SectionId;
    const name = nameOf(id);
    const next = focusAfterDelete(
      list.map((s) => s.id),
      id
    );
    void run(
      id,
      () => deleteSection(slug, id, sections.version, lesson.contentVersion),
      () => {
        setWhere(null);
        onDeleted?.(id);
        announce(t("delete.deleted", { name }));
        focusEl(next ? elId(next, "link") : openerId);
      },
      // The lesson's content changed too (its base covers it): say so, not only the list.
      (res) => (res.error === "changed-elsewhere" ? t("delete.changed") : undefined)
    );
  }

  function add(choice: AddSectionChoice, at: number | null, confirm?: true) {
    const control = choiceState(ctx, choice, at);
    const askAdd = (counts?: Counts) => setPicker((p) => (p ? { ...p, confirm: { counts } } : p));
    if (!confirm && control.kind === "enabled" && control.confirm) return askAdd();
    void run(
      "picker",
      () => addSection(slug, choice, at, sections.version, confirm),
      (outline, id) => {
        setPicker(null);
        setWhere(null);
        if (!id) return;
        announce(t("added", { name: sectionName(outline, id) }));
        onAdded(id);
      },
      undefined,
      askAdd
    );
  }

  async function saveName(lesson: LessonOutline, label: string) {
    const section = lesson.section!;
    const id = lesson.key as SectionId;
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await renameSection(slug, id, lang, label, section.labelVersion[lang]);
      if (res.ok) {
        const name = label
          ? { text: label, source: "own" as const }
          : nameIn({ id, template: section.template, label: {} }, lang, names, {
              title: titleOf(lesson, lang),
              n: section.number ?? list.findIndex((s) => s.id === id) + 1,
            });
        onRenamed(id, label, res.version, name);
        announce(t("rename.saved"));
        setWhere({ row: id, mode: "actions" });
        focusEl(elId(id, "rename"));
        refresh();
      } else if (res.error === "invalid") {
        setError({ at: id, text: t("errors.generic") });
      } else {
        refused(res, id);
      }
    } catch {
      setError({ at: id, text: t("errors.generic") });
    } finally {
      setBusy(false);
    }
  }

  function toggleRow(id: string) {
    setError(null);
    setPicker(null);
    setWhere((w) => (w?.row === id ? null : { row: id, mode: "actions" }));
  }

  function openPicker(from: number | null) {
    setError(null);
    setPicker({ from });
  }

  function closePicker() {
    const from = picker?.from ?? null;
    setPicker(null);
    setError(null);
    // Back to the button that opened it (the list may have changed meanwhile).
    const row = from === null ? undefined : list[from];
    focusEl(row ? elId(row.id, "addAfter") : openerId);
  }

  const rowStatus = (lesson: LessonOutline): RowStatus | null => {
    // Hidden: its "Hidden" says it (learners don't get it as it stands).
    if (lesson.section?.hidden) return null;
    return lesson.live ? "live" : "empty";
  };

  /** The row's LiveChangeConfirm for the change waiting on it. */
  const confirmFor = (id: SectionId) => {
    const pending = where?.row === id && where.mode === "confirm" ? where : null;
    if (!pending?.change) return null;
    const change = pending.change;
    const counts = pending.counts ?? pageCounts;
    return (
      <LiveChangeConfirm
        change={
          change.op === "move"
            ? { kind: "move", name: nameOf(id) }
            : { kind: change.hidden ? "hide" : "show", name: nameOf(id) }
        }
        nameLang={lang}
        learners={counts.learners}
        finished={counts.finished}
        busy={busy}
        error={error?.at === id ? error.text : null}
        onConfirm={() => (change.op === "move" ? move(id, change.dir, true) : hide(id, change.hidden, true))}
        onCancel={() => cancelConfirm(id)}
      />
    );
  };

  const addOpener = addControl(ctx);
  const pickerFor = (from: number | null) => (
    <AddLessonPicker
      ctx={ctx}
      from={from}
      busy={busy}
      lessonLabel={lessonLabel}
      restoreName={restoreName}
      nameLang={lang}
      descriptions={describe}
      error={error?.at === "picker" ? error.text : null}
      addId={pickerAddId}
      confirming={picker?.confirm ? (picker.confirm.counts ?? pageCounts) : null}
      onAdd={(choice, at) => add(choice, at)}
      onConfirm={(choice, at) => add(choice, at, true)}
      onCancelConfirm={() => {
        setError(null);
        setPicker((p) => (p ? { from: p.from } : p));
        focusEl(pickerAddId);
      }}
      onClose={closePicker}
    />
  );
  const sectionCount = list.length;
  const unreadable = sections.resolved.unreadable === true || sections.reasons.some((r) => r.code === "unreadable");

  return (
    <nav
      aria-label={tNav("lessonsNav")}
      className="mb-6 lg:sticky lg:top-20 lg:mb-0 lg:max-h-[calc(100vh_-_6rem)] lg:self-start lg:overflow-y-auto lg:pr-1"
    >
      {/* Narrow screens: a disclosure above the lessons. */}
      <h2 className="lg:hidden">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((e) => !e)}
          className="flex min-h-11 w-full items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold"
        >
          {t("count", { count: sectionCount })}
          <ChevronDown
            className={`h-4 w-4 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
      </h2>
      <h2 className="mb-2 hidden text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] lg:block">
        {t("heading")}
      </h2>

      <div id={listId} className={`${expanded ? "mt-2" : "hidden"} lg:mt-0 lg:block`}>
        {/* Why a control is refused, shared by every control it applies to;
            and, for a change that asks first, how many learners it touches. */}
        <p id={`${uid}-why-unreadable`} hidden>
          {t("errors.unreadable")}
        </p>
        <p id={`${uid}-why-max`} hidden>
          {t("max", { max: sections.max })}
        </p>
        <p id={`${uid}-why-closed`} hidden>
          {tLive("closed", { date })}
        </p>
        <p id={`${uid}-why-last-lesson`} hidden>
          {tLive("lastLesson")}
        </p>
        <p id={`${uid}-why-learners`} hidden>
          {tLive("hasLearners.delete", { count: learners })}
        </p>
        <p id={`${uid}-learners`} hidden>
          {tLive("learners", pageCounts)}
        </p>
        {unreadable ? (
          <p className="mb-2 rounded-md bg-[var(--surface-muted)] p-2 text-xs">{t("errors.unreadable")}</p>
        ) : null}

        <ol className="space-y-1 text-sm">
          {lessons.map((lesson) => {
            if (!lesson.section) {
              return <AddSlot key={lesson.key} lesson={lesson} label={lessonLabel(lesson.key)} onAdd={onAddStage} tAdd={tNav} draft={tDraft("navDraft")} />;
            }
            const section = lesson.section;
            const id = section.id;
            const index = list.findIndex((s) => s.id === id);
            const open = where?.row === id;
            const n = section.number ?? index + 1;
            const controls = rowControls(ctx, id);
            return (
              <SectionRow
                key={id}
                lesson={lesson}
                label={lessonLabel(id)}
                name={nameOf(id)}
                status={rowStatus(lesson)}
                idOf={(part) => elId(id, part)}
                controls={controls}
                open={open}
                mode={open ? where.mode : "actions"}
                busy={busy}
                error={error?.at === id ? error.text : null}
                describe={describe}
                rename={{
                  lang,
                  initial: section.label[lang] ?? "",
                  placeholder: fallbackName(section, lang, names, { title: titleOf(lesson, lang), n }),
                }}
                emptyNote={section.custom && !section.hidden && !lesson.live ? tLive("emptyNote") : null}
                deleteBlocked={
                  controls.delete.kind === "learners" ? tLive("hasLearners.delete", { count: learners }) : null
                }
                confirm={confirmFor(id)}
                onToggle={() => toggleRow(id)}
                onMove={(dir) => move(id, dir)}
                onHide={() => hide(id, !section.hidden)}
                onStartRename={() => {
                  setError(null);
                  setWhere({ row: id, mode: "rename" });
                }}
                onAddAfter={() => openPicker(index)}
                onStartDelete={() => {
                  setError(null);
                  setWhere({ row: id, mode: "delete" });
                }}
                onRenameSave={(label) => void saveName(lesson, label)}
                onRenameCancel={() => {
                  setError(null);
                  setWhere({ row: id, mode: "actions" });
                  focusEl(elId(id, "rename"));
                }}
                onDeleteConfirm={() => remove(lesson)}
                onDeleteHide={
                  !section.hidden && controls.hide.kind === "enabled" ? () => hide(id, true) : null
                }
                onDeleteKeep={() => {
                  setError(null);
                  setWhere({ row: id, mode: "actions" });
                  focusEl(elId(id, "delete"));
                }}
                announce={announce}
                after={picker && picker.from === index ? pickerFor(index) : null}
              />
            );
          })}
        </ol>

        <div className="mt-3">
          {error?.at === "list" ? (
            <p role="alert" className="mb-2 flex items-start gap-1.5 text-xs text-[var(--danger)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
              {error.text}
            </p>
          ) : null}
          {picker && picker.from === null ? (
            pickerFor(null)
          ) : (
            <button
              id={openerId}
              type="button"
              aria-disabled={addOpener.kind !== "enabled" || undefined}
              aria-describedby={describe(addOpener)}
              onClick={() => {
                if (addOpener.kind === "enabled") openPicker(null);
              }}
              className="inline-flex min-h-9 w-full items-center gap-1.5 rounded-md border border-dashed border-[var(--accent)]/50 px-3 text-sm font-medium text-[var(--accent)] hover:bg-[var(--surface-muted)] aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t("picker.open")}
            </button>
          )}
          {addOpener.kind === "locked" && addOpener.why === "max" ? (
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">{t("max", { max: sections.max })}</p>
          ) : null}
        </div>
      </div>
    </nav>
  );
}

/** The lesson's title in `lang`, for its name to fall back to (a written text's title). */
function titleOf(lesson: LessonOutline, lang: Locale): string | null {
  const narrative = lesson.byLang[lang]?.narrative;
  return narrative?.hasOverride && narrative.title.trim() ? narrative.title : null;
}

/**
 * Today's "Add guided practice / an applied scenario / a quick check" for
 * an exercise the course doesn't have, or the lesson's name with "Draft"
 * when it so far exists only as a draft (Release 0's LessonNav, unchanged).
 */
function AddSlot({
  lesson,
  label,
  onAdd,
  tAdd,
  draft,
}: {
  lesson: LessonOutline;
  label: string;
  onAdd: (key: string) => void;
  tAdd: (key: string) => string;
  draft: string;
}) {
  const key = lesson.key as "simulation" | "scenario" | "assessment";
  return (
    <li>
      <button
        type="button"
        onClick={() => onAdd(lesson.key)}
        className="inline-flex min-h-9 w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[var(--accent)] hover:bg-[var(--surface-muted)]"
      >
        {offersAdd(lesson) ? (
          <>
            <Plus className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
            {tAdd(`addStage.${key}`)}
          </>
        ) : (
          <>
            <PenLine className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
            <span className="font-medium">{label}</span>
            <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full border border-dashed border-[var(--warning)] px-1.5 text-[10px] font-medium text-[var(--foreground)]">
              <FilePenLine className="h-3 w-3" aria-hidden />
              {draft}
            </span>
          </>
        )}
      </button>
    </li>
  );
}

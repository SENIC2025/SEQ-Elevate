"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { Info, Plus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { addPart, movePart, removePart, savePartText } from "@/app/actions/parts";
import { LessonNarrativeEditor, type NarrativeTarget } from "@/components/role/LessonNarrativeEditor";
import { StructureAuthor } from "@/components/role/StructureAuthor";
import { partTarget } from "@/components/role/exercise/exercise-target";
import { writeErrorMessage, type WriteRefusal } from "@/components/role/exercise/write-errors";
import type { CourseKind, CourseOutline, LessonOutline } from "@/lib/cms/course-admin-types";
import type { CourseStatus } from "@/lib/cms/course-status";
import {
  MAIN_PART_ID,
  SECTION_LIMITS,
  type NewOnlyReason,
  type OutlineResult,
  type PartId,
  type PartType,
  type PartView,
  type PartsView,
  type SectionId,
} from "@/lib/cms/sections/contract";
import type { LiveFacts } from "@/lib/cms/sections/live-rules";
import type { Locale } from "@/lib/cms/types";
import { DirtyScope } from "../dirty-registry";
import { LiveChangeConfirm } from "../lesson-list/LiveChangeConfirm";
import { closedDate } from "../lesson-list/list-model";
import { PartCard } from "./PartCard";
import { PartTypePicker } from "./PartTypePicker";
import {
  extraCount,
  focusAfterCancel,
  focusAfterPartMove,
  focusAfterRemove,
  partControl,
  partStatus,
  partTypeOf,
  settleRereads,
  settleSaves,
  textPair,
  textStart,
  type PartFocus,
  type SavedText,
} from "./part-list";

/** The first box an author types in, once a new content's editor has loaded. */
const FIELD = 'input:not([type="hidden"]), textarea, select, [contenteditable="true"]';

/** A lesson not in the list yet: only its main content (see `listed`). */
const MAIN_ONLY: PartsView = { items: [{ id: MAIN_PART_ID, type: "main" }], order: "" };

/** The course's learners and the 1 December cut-off, as the page got them (SectionsMeta). */
export interface LiveCourse {
  learners: number;
  finished: number;
  closed: boolean;
  closedFrom: string | null;
}

type Counts = { learners: number; finished: number };
/** A content change waiting for the editor's confirmation (spec 7.3). */
type Pending =
  | { op: "add"; after: PartId; type: PartType; counts?: Counts }
  | { op: "move"; id: PartId; dir: -1 | 1; counts?: Counts }
  | { op: "remove"; id: PartId; counts?: Counts };

/**
 * A lesson's content on the course page, in learner order (spec 11.2): the
 * main content in exactly today's editor (`main`), and the extra content
 * around it — text, practice question, branching scenario, quick check,
 * reflection questions, self-assessment — each in its own editor, with
 * "Add content" after each one (one choice of types open at a time).
 *
 * Adding, moving and removing content changes the lesson: each returns the
 * whole course outline, which the page takes in (onOutline); a colleague's
 * change found that way shows at once. Saving a content's own text or
 * questions doesn't, and re-reads the page instead.
 *
 * Focus is kept predictable (WCAG 2.4.3): on the button pressed after a
 * move, on the next content after a removal, in the new content's first
 * box after an add (on "Add content" while it is being added, and if it is
 * refused); and the page's one polite live region says what happened.
 *
 * A removal sends the version of the content the page shows. Right after
 * the content's own save the page is still re-reading it, so a Remove
 * pressed then waits for that re-read, rather than being refused as if
 * someone else had changed it.
 *
 * On a course with learners (D66, spec 7.3) adding, moving and removing
 * content ask first: LiveChangeConfirm opens where the change was asked
 * for, and only its button sends it, confirmed. A question learners may
 * have answered can't be removed while they are there (it can still be
 * edited), and from 1 December a course with learners, published or not,
 * takes no content change (D67); those controls stay focusable and say
 * why.
 */
export function PartList({
  listed = true,
  lesson,
  label,
  slug,
  kind,
  status,
  lang,
  reasons,
  live,
  main,
  onOutline,
  announce,
}: {
  /**
   * False for a lesson not in the course's lesson list yet: only its main
   * content, in the same wrappers, with nothing to add, move or remove.
   */
  listed?: boolean;
  lesson: LessonOutline;
  /** The lesson's heading ("2. Skill concept"), for unsaved-changes prompts. */
  label: string;
  slug: string;
  kind: CourseKind;
  status: CourseStatus;
  lang: Locale;
  reasons: readonly NewOnlyReason[];
  /** The course's learners and the cut-off (none: nobody is taking it). */
  live?: LiveCourse;
  /** The main content's editor, as today. */
  main: React.ReactNode;
  onOutline: (outline: CourseOutline) => void;
  /** The page's one polite live region (spec 11.3). */
  announce: (text: string) => void;
}) {
  const t = useTranslations("lessonBlocks");
  const tEditor = useTranslations("exerciseEditor");
  const tLive = useTranslations("liveChanges");
  const locale = useLocale();
  const tLanguage = useTranslations("courseManager.languageName");
  const router = useRouter();
  // True while the page re-reads the course after a content's own save.
  const [refreshing, startTransition] = React.useTransition();
  const ids = React.useId();
  const sectionId = lesson.key as SectionId;
  const parts = listed ? lesson.parts : MAIN_ONLY;

  const [picker, setPicker] = React.useState<PartId | null>(null);
  const [pending, setPendingChange] = React.useState<Pending | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ at: string; message: string } | null>(null);
  const [focus, setFocus] = React.useState<PartFocus | null>(null);
  // Texts whose "Load the saved version" waits for a refreshed page.
  const [rereads, setRereads] = React.useState<Record<string, string | null>>({});
  const [revs, setRevs] = React.useState<Record<string, number>>({});
  // Texts saved here that the page may not show yet (see textStart).
  const [saved, setSaved] = React.useState<Record<string, SavedText>>({});
  // A confirmed removal waiting for the page to catch up with a save.
  const queuedRemove = React.useRef<{ id: PartId; confirm?: true } | null>(null);
  const [seenParts, setSeenParts] = React.useState(parts);
  if (parts !== seenParts) {
    setSeenParts(parts);
    if (parts && Object.keys(saved).length) setSaved(settleSaves(saved, parts.items));
    if (parts && Object.keys(rereads).length) {
      const settled = settleRereads(rereads, revs, parts.items);
      setRereads(settled.pending);
      setRevs(settled.revs);
    }
  }

  const labelId = (id: PartId) => `${ids}-label-${id}`;
  const upId = (id: PartId) => `${ids}-up-${id}`;
  const downId = (id: PartId) => `${ids}-down-${id}`;
  const removeId = (id: PartId) => `${ids}-remove-${id}`;
  const addId = (id: PartId) => `${ids}-add-${id}`;
  const bodyId = (id: PartId) => `${ids}-body-${id}`;
  const pickerId = (id: PartId) => `${ids}-picker-${id}`;
  const lockedNoteId = `${ids}-locked`;
  const learnersNoteId = `${ids}-learners`;
  const maxNoteId = `${ids}-max`;

  React.useEffect(() => {
    if (!focus) return;
    const byId = (id: string) => document.getElementById(id);
    if (focus.target === "up" || focus.target === "down") {
      const pressed = byId(focus.target === "up" ? upId(focus.id) : downId(focus.id));
      const other = byId(focus.target === "up" ? downId(focus.id) : upId(focus.id));
      const usable = (el: HTMLElement | null) => el && !(el as HTMLButtonElement).disabled;
      (usable(pressed) ? pressed : other)?.focus();
      return;
    }
    if (focus.target === "add") {
      byId(addId(focus.id))?.focus();
      return;
    }
    if (focus.target === "remove") {
      byId(removeId(focus.id))?.focus();
      return;
    }
    const name = byId(labelId(focus.id));
    name?.focus();
    if (focus.target !== "field") return;
    // A new content's editor may still be loading: move on to its first
    // box once it is there, unless the author has gone elsewhere meanwhile.
    let tries = 0;
    const timer = window.setInterval(() => {
      const box = byId(bodyId(focus.id))?.querySelector<HTMLElement>(FIELD);
      const stayed = document.activeElement === name || document.activeElement === document.body;
      if (box || !stayed || ++tries > 40) window.clearInterval(timer);
      if (box && stayed) box.focus();
    }, 75);
    return () => window.clearInterval(timer);
    // The ids are stable (useId); focus is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const refresh = React.useCallback(
    () => startTransition(() => router.refresh()),
    [router]
  );

  const say = announce;

  const facts: LiveFacts = {
    status,
    learners: live?.learners ?? 0,
    closed: live?.closed === true,
  };
  const pageCounts: Counts = { learners: facts.learners, finished: live?.finished ?? 0 };
  const date = closedDate(live?.closedFrom, locale);

  /** Words for a refused change, in the menu language. */
  const refusalText = (r: WriteRefusal & { from?: string }) => {
    if (r.error === "too-many-parts") {
      return t("tooMany", { max: SECTION_LIMITS.maxPartsPerSection });
    }
    if (r.error === "changed-elsewhere") return t("changedElsewhere");
    // The rules for a course people are taking (spec 7.2).
    if (r.error === "restructure-closed") return tLive("closed", { date: closedDate(r.from, locale) || date });
    if (r.error === "has-learners") return tLive("hasLearners.part");
    const message = writeErrorMessage(r);
    return tEditor(message.key, message.values);
  };

  /**
   * One change to the lesson's content list; the outline it returns is
   * taken in. `ask` is called instead of saying a refusal when the server
   * wants a confirmation the page didn't know was needed, with its counts.
   */
  async function change(
    at: string,
    call: () => Promise<OutlineResult>,
    done: (id: string | undefined) => void,
    failed?: () => void,
    ask?: (counts: Counts) => void
  ) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await call();
      if (res.ok) {
        setPendingChange(null);
        onOutline(res.outline);
        done(res.id);
        return;
      }
      if (res.error === "needs-confirmation" && ask) {
        refresh();
        ask({ learners: res.learners, finished: res.finished });
        return;
      }
      if (res.error === "changed-elsewhere" && res.outline) onOutline(res.outline);
      // The page was behind on the course's learners or the date: catch up.
      if (res.error === "restructure-closed" || res.error === "has-learners") refresh();
      setError({
        at,
        message: refusalText({
          error: res.error,
          ...("count" in res ? { count: res.count } : {}),
          ...("from" in res ? { from: res.from } : {}),
        }),
      });
      failed?.();
    } catch {
      setError({ at, message: tEditor("errors.generic") });
      failed?.();
    } finally {
      setBusy(false);
    }
  }

  /** Removes `id` as the page now shows it (its current version); `confirm` once asked. */
  function removeNow(id: PartId, confirm?: true) {
    const list = parts?.items ?? [];
    const item = list.find((i) => i.id === id);
    if (!parts || !item || item.type === "main") return;
    void change(
      `card:${item.id}`,
      () => removePart(slug, sectionId, item.id, parts.order, item.itemVersion, confirm),
      () => {
        const next = focusAfterRemove(list, item.id);
        setFocus((f) => ({ ...next, n: (f?.n ?? 0) + 1 }));
        say(t("removed"));
      },
      undefined,
      (counts) => setPendingChange({ op: "remove", id: item.id, counts })
    );
  }

  // A removal confirmed while the page was re-reading goes once it has.
  React.useEffect(() => {
    const queued = queuedRemove.current;
    if (refreshing || !queued) return;
    queuedRemove.current = null;
    removeNow(queued.id, queued.confirm);
    // removeNow reads this render's list, which is what the re-read brought.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshing]);

  if (!parts) {
    // Lesson.parts can't be read: the main content is still edited as
    // today; nothing else can change until an admin repairs it (G8).
    return (
      <div className="space-y-4">
        <p className="flex items-start gap-1.5 rounded-md bg-[var(--surface-muted)] px-3 py-2 text-sm">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          {t("unreadable")}
        </p>
        {main}
      </div>
    );
  }

  const items = parts.items;
  const extras = extraCount(items);
  const control = (op: "add" | "move" | "remove", item?: PartView) => partControl({ reasons, op, item, facts });
  // Why a control is refused: the note it is described by.
  const noteFor = (c: ReturnType<typeof control>): string | null =>
    c.kind === "enabled" ? null : c.why === "learners" ? learnersNoteId : lockedNoteId;
  const addControl = control("add");
  const moveControl = control("move");
  const addLocked = addControl.kind !== "enabled";
  const full = items.length >= SECTION_LIMITS.maxPartsPerSection;
  const typeName = (item: PartView) => t(`types.${partTypeOf(item, lesson.mainKind)}`);
  const language = tLanguage(lang);
  const lessonName = lesson.section?.name[lang]?.text ?? label;

  function add(after: PartId, type: PartType, confirm?: true) {
    setPicker(null);
    // The choice pressed goes with the picker: back to "Add content" while
    // the content is added, and there if it is refused (the reason is below it).
    const toAdd = () => setFocus((f) => ({ id: after, target: "add", n: (f?.n ?? 0) + 1 }));
    if (!confirm && addControl.kind === "enabled" && addControl.confirm) {
      setError(null);
      setPendingChange({ op: "add", after, type });
      return;
    }
    toAdd();
    void change(
      `add:${after}`,
      () => addPart(slug, sectionId, type, after, parts!.order, confirm),
      (id) => {
        if (!id) return;
        setFocus((f) => ({ id: id as PartId, target: "field", n: (f?.n ?? 0) + 1 }));
        say(t("added", { type: t(`types.${type}`) }));
      },
      toAdd,
      (counts) => setPendingChange({ op: "add", after, type, counts })
    );
  }

  function move(item: PartView, dir: -1 | 1, confirm?: true) {
    const to = items.findIndex((i) => i.id === item.id) + dir;
    if (!confirm && moveControl.kind === "enabled" && moveControl.confirm) {
      setError(null);
      setPendingChange({ op: "move", id: item.id, dir });
      return;
    }
    void change(
      `card:${item.id}`,
      () => movePart(slug, sectionId, item.id, dir, parts!.order, confirm),
      () => {
        setFocus((f) => ({
          id: item.id,
          target: focusAfterPartMove(items, item.id, dir),
          n: (f?.n ?? 0) + 1,
        }));
        say(t("moved", { n: to + 1, total: items.length }));
      },
      undefined,
      (counts) => setPendingChange({ op: "move", id: item.id, dir, counts })
    );
  }

  /** Remove: confirmed by the browser's dialog, or with learners by LiveChangeConfirm (`confirm`). */
  function remove(item: PartView, confirm?: true) {
    if (item.type === "main") return;
    const c = control("remove", item);
    if (c.kind !== "enabled") return;
    if (!confirm) {
      if (c.confirm) {
        setError(null);
        setPendingChange({ op: "remove", id: item.id });
        return;
      }
      if (!window.confirm(t("removeConfirm"))) return;
    }
    if (refreshing) queuedRemove.current = { id: item.id, confirm };
    else removeNow(item.id, confirm);
  }

  /** LiveChangeConfirm cancelled (or Escape): nothing changes, focus goes back to the button that asked. */
  function cancelPending() {
    const p = pending;
    setPendingChange(null);
    setError(null);
    if (!p) return;
    const back = focusAfterCancel(p);
    setFocus((f) => ({ ...back, n: (f?.n ?? 0) + 1 }));
  }

  /** The confirmation for the change waiting at `item` (`where`: its add area, or its card). */
  function confirmAt(item: PartView, where: "add" | "card") {
    const p = pending;
    if (!p || (where === "add") !== (p.op === "add")) return null;
    if ((p.op === "add" ? p.after : p.id) !== item.id) return null;
    const counts = p.counts ?? pageCounts;
    const at = p.op === "add" ? `add:${p.after}` : `card:${p.id}`;
    return (
      <LiveChangeConfirm
        change={
          p.op === "add"
            ? { kind: "addPart", name: lessonName }
            : p.op === "move"
              ? { kind: "movePart", name: lessonName }
              : {
                  kind: "removePart",
                  name: lessonName,
                  text: item.type === "text",
                  empties: lesson.live && lesson.soleContent === item.id,
                }
        }
        nameLang={lang}
        learners={counts.learners}
        finished={counts.finished}
        busy={busy}
        error={error?.at === at ? error.message : null}
        onConfirm={() =>
          p.op === "add" ? add(p.after, p.type, true) : p.op === "move" ? move(item, p.dir, true) : remove(item, true)
        }
        onCancel={cancelPending}
      />
    );
  }

  function closePicker() {
    const at = picker;
    setPicker(null);
    if (at) setFocus((f) => ({ id: at, target: "add", n: (f?.n ?? 0) + 1 }));
  }

  function editorFor(item: PartView, position: string) {
    const dirtyLabel = `${label} · ${position}`;
    if (item.type === "main") return main;
    if (item.type === "text") {
      const target: NarrativeTarget = {
        save: (blocks, base) => savePartText(slug, sectionId, item.id, lang, blocks, base),
        refusal: refusalText,
      };
      const pairId = textPair(item.id, lang);
      return (
        <DirtyScope
          key={lang}
          id={`lesson:${lesson.key}:part:${item.id}:text`}
          label={dirtyLabel}
          langBound
        >
          {(report) => (
            <LessonNarrativeEditor
              courseSlug={slug}
              stageKey={lesson.key}
              locale={lang}
              initial={textStart(item, lang, saved[pairId])}
              initialRev={revs[pairId] ?? 0}
              courseKind={kind}
              target={target}
              fields="blocks"
              heading={position}
              embedded
              onSaved={(value) => {
                const from = item.versions[lang] ?? null;
                setSaved((s) => ({ ...s, [pairId]: { from, value } }));
                refresh();
              }}
              onDirtyChange={report}
              onReread={(stale) => {
                setRereads((p) => ({ ...p, [pairId]: stale }));
                refresh();
              }}
            />
          )}
        </DirtyScope>
      );
    }
    return (
      <DirtyScope id={`lesson:${lesson.key}:part:${item.id}`} label={dirtyLabel}>
        {(report) => (
          <StructureAuthor
            courseSlug={slug}
            target={partTarget(slug, sectionId, item.id, item.type)}
            locale={lang}
            courseStatus={status}
            regionLabel={position}
            embedded
            onSaved={refresh}
            onDraftChange={refresh}
            onDirtyChange={report}
          />
        )}
      </DirtyScope>
    );
  }

  const removeControls = items.map((item) => control("remove", item));
  const lockedAny =
    listed &&
    [addControl, moveControl, ...removeControls].some((c) => c.kind === "locked" && c.why !== "learners");
  const learnersLocked = listed && removeControls.some((c) => c.kind === "locked" && c.why === "learners");
  // Locked because something in the course can't be read (G8), or by the cut-off (D67).
  const unreadableCourse = reasons.some((r) => r.code === "unreadable");

  return (
    <div className="space-y-4">
      {lockedAny ? (
        <p id={lockedNoteId} className="text-sm text-[var(--muted-foreground)]">
          {unreadableCourse ? t("courseUnreadable") : tLive("closed", { date })}
        </p>
      ) : null}
      {learnersLocked ? (
        <p id={learnersNoteId} className="text-sm text-[var(--muted-foreground)]">
          {tLive("hasLearners.part")}
        </p>
      ) : null}
      {full ? (
        <p id={maxNoteId} className="text-sm text-[var(--muted-foreground)]">
          {t("tooMany", { max: SECTION_LIMITS.maxPartsPerSection })}
        </p>
      ) : null}

      <ol className="space-y-4">
        {items.map((item, i) => {
          const type = typeName(item);
          const position = t("position", { type, n: i + 1, total: items.length });
          const open = picker === item.id;
          const addError = error?.at === `add:${item.id}` ? error.message : null;
          const addBlocked = addLocked || full;
          return (
            <li key={item.id}>
              <PartCard
                ids={{
                  label: labelId(item.id),
                  up: upId(item.id),
                  down: downId(item.id),
                  remove: removeId(item.id),
                  body: bodyId(item.id),
                }}
                groupLabel={t("groupLabel", { n: i + 1, total: items.length, type })}
                names={{
                  up: t("moveUpNamed", { n: i + 1, type }),
                  down: t("moveDownNamed", { n: i + 1, type }),
                  remove: t("removeNamed", { n: i + 1, type }),
                }}
                status={partStatus(item, lang)}
                language={language}
                header={extras > 0}
                index={i}
                total={items.length}
                removable={item.id !== MAIN_PART_ID}
                locked={{ move: noteFor(moveControl), remove: noteFor(removeControls[i]) }}
                error={
                  error?.at === `card:${item.id}` && !(pending && pending.op !== "add" && pending.id === item.id)
                    ? error.message
                    : undefined
                }
                onMove={(dir) => move(item, dir)}
                onRemove={() => remove(item)}
              >
                {editorFor(item, position)}
              </PartCard>
              {confirmAt(item, "card")}

              {listed ? (
              <div className="mt-3 space-y-2">
                <Button
                  id={addId(item.id)}
                  size="sm"
                  variant="outline"
                  className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  aria-label={t("addContentAfter", { n: i + 1, type })}
                  aria-expanded={open}
                  aria-controls={open ? pickerId(item.id) : undefined}
                  {...(addBlocked
                    ? {
                        "aria-disabled": true as const,
                        "aria-describedby": addLocked ? (noteFor(addControl) ?? lockedNoteId) : maxNoteId,
                      }
                    : {})}
                  onClick={() => {
                    if (addBlocked) return;
                    setError(null);
                    setPicker(open ? null : item.id);
                  }}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  {t("addContent")}
                </Button>
                {open ? (
                  <PartTypePicker
                    id={pickerId(item.id)}
                    onPick={(type) => add(item.id, type)}
                    onClose={closePicker}
                  />
                ) : null}
                {confirmAt(item, "add")}
                {addError && !(pending?.op === "add" && pending.after === item.id) ? (
                  <p role="alert" className="text-sm text-[var(--danger)]">
                    {addError}
                  </p>
                ) : null}
              </div>
              ) : null}
            </li>
          );
        })}
      </ol>

    </div>
  );
}

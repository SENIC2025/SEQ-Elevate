/**
 * The course page's lesson state (CourseWorkspace), as a pure reducer so its
 * rules can be tested without a browser.
 *
 * Two kinds of news reach the page from the server:
 *
 * - a refreshed page (router.refresh() after a save): the server-rendered
 *   outline prop. While the lesson list is the same one (same
 *   `sections.version`), it only patches the lessons the page has (D39): a
 *   refresh that raced a save must never put old content back into an
 *   editor. When the list itself changed (a colleague added, moved or
 *   deleted a lesson), it replaces the lessons like a structural result;
 * - a structural action's result (Release 1: add, move, hide or delete a
 *   lesson; add, move or remove content): the whole outline, built after
 *   the action committed. It replaces the lessons ("outlineReplaced").
 *
 * The lesson list's base (`sections.version`), the publishing blockers
 * (`readiness`), the language coverage and the learner count live here with
 * the lessons, so the rows on screen and the base a move or delete sends
 * always come from the same snapshot.
 */

import {
  CONTENT_LOCALES,
  type CourseOutline,
  type LanguageCoverage,
  type LessonOutline,
  type NarrativeInitial,
  type ReadinessIssue,
} from "@/lib/cms/course-admin-types";
import type { SectionsMeta } from "@/lib/cms/sections/contract";
import type { StoredStructure } from "@/lib/cms/structure";
import type { LessonDocumentRef, Locale, VideoContent } from "@/lib/cms/types";

export interface WorkspaceState {
  /**
   * The lessons as the editors know them: from the outline, then changed by
   * the editors' own save callbacks and by structural results.
   */
  lessons: LessonOutline[];
  /** The lesson list's bases and reasons (created courses; else null). */
  sections: SectionsMeta | null;
  /** What the publishing controls list, from the same snapshot. */
  readiness: ReadinessIssue[];
  languages: Record<Locale, LanguageCoverage>;
  /** Learners enrolled (D53). */
  enrolled: number;
  /** Per "lesson:language": bumped when its text was re-read (see "reread"). */
  revs: Record<string, number>;
  /**
   * "lesson:language" pairs waiting for a re-read, each with the version of
   * the text it's moving away from (null = none was stored).
   */
  pending: Record<string, string | null>;
  /** The lessons whose editors are open. */
  open: ReadonlySet<string>;
  /**
   * The server-rendered outline last taken in. Only a refreshed page moves
   * it: a structural result never does, so the old prop that is still being
   * rendered can't be taken in again over the newer result.
   */
  seen: CourseOutline;
}

export type WorkspaceAction =
  /** The server-rendered outline (CourseWorkspace sends it on every render). */
  | { type: "outline"; outline: CourseOutline }
  /** A structural action returned the whole outline after it committed. */
  | { type: "outlineReplaced"; outline: CourseOutline }
  | { type: "opened"; key: string }
  | { type: "closed"; key: string }
  | { type: "narrativeSaved"; key: string; lang: Locale; value: NarrativeInitial }
  | { type: "reread"; key: string; lang: Locale; stale: string | null }
  | { type: "structureSaved"; key: string; structure: StoredStructure }
  | { type: "draftChanged"; key: string; draft: StoredStructure | null }
  | { type: "structureCleared"; key: string }
  | { type: "videoSaved"; key: string; video: VideoContent | null }
  | { type: "documentsChanged"; key: string; documents: LessonDocumentRef[] };

/** The revs / pending key of one lesson's text in one language. */
export const pair = (key: string, lang: Locale) => `${key}:${lang}`;

/** The lesson of a pair (ids never contain ":"). */
const lessonOfPair = (id: string) => id.slice(0, id.lastIndexOf(":"));

export function initWorkspace(outline: CourseOutline, initialLesson?: string): WorkspaceState {
  return {
    lessons: outline.lessons,
    sections: outline.sections,
    readiness: outline.readiness,
    languages: outline.languages,
    enrolled: outline.enrolled,
    revs: {},
    pending: {},
    open: new Set(initialLesson ? [initialLesson] : []),
    seen: outline,
  };
}

function patchLesson(
  state: WorkspaceState,
  key: string,
  patch: (l: LessonOutline) => LessonOutline
): WorkspaceState {
  return {
    ...state,
    lessons: state.lessons.map((l) => (l.key === key ? patch(l) : l)),
  };
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "outline":
      return takeServerOutline(state, action.outline);
    case "outlineReplaced":
      return replaceOutline(state, action.outline);
    case "opened":
      return { ...state, open: new Set(state.open).add(action.key) };
    case "closed": {
      const open = new Set(state.open);
      open.delete(action.key);
      return { ...state, open };
    }
    case "narrativeSaved":
      return patchLesson(state, action.key, (l) => ({
        ...l,
        byLang: {
          ...l.byLang,
          [action.lang]: { ...l.byLang[action.lang], narrative: action.value },
        },
      }));
    case "reread":
      // The text was removed, or a colleague saved a newer one: take the
      // next outline whose text differs from the editor's (`stale`).
      return {
        ...state,
        pending: {
          ...state.pending,
          [pair(action.key, action.lang)]: action.stale,
        },
      };
    case "structureSaved":
      // A new interactive lesson now exists for learners — and can take a
      // video and documents like any other. The save cleared any draft. A
      // lesson of a created course's list already is one (see `listed`).
      return patchLesson(state, action.key, (l) => ({
        ...l,
        structure: action.structure,
        draft: null,
        ...(listed(l)
          ? {}
          : { present: true, addable: false, editable: { ...l.editable, media: true } }),
      }));
    case "draftChanged":
      // Learners see no change: only the lesson's "Draft" mark.
      return patchLesson(state, action.key, (l) => ({
        ...l,
        draft: action.draft,
      }));
    case "structureCleared":
      // Outside a created course's list the lesson goes back to "Add …". A
      // lesson of the list stays in it with its video and documents: only
      // its exercise is gone (see `listed`).
      return patchLesson(state, action.key, (l) => ({
        ...l,
        structure: null,
        draft: null,
        ...(listed(l)
          ? {}
          : { present: false, addable: true, editable: { ...l.editable, media: false } }),
      }));
    case "videoSaved":
      return patchLesson(state, action.key, (l) => ({
        ...l,
        video: action.video,
      }));
    case "documentsChanged":
      return patchLesson(state, action.key, (l) => ({
        ...l,
        documents: action.documents,
      }));
  }
}

/**
 * A lesson of a created course's lesson list. The server lists it as a
 * lesson (present, not addable, with media) whatever its content, so saving
 * or removing its exercise doesn't change that. Release 0's rows and the
 * "Add …" slots outside the list have no section.
 */
const listed = (l: LessonOutline) => l.section !== null;

/** The course facts that belong to the same snapshot as the lessons. */
function courseFacts(outline: CourseOutline) {
  return {
    sections: outline.sections,
    readiness: outline.readiness,
    languages: outline.languages,
    enrolled: outline.enrolled,
  };
}

/**
 * A refreshed page. Taken once per outline. When its lesson list differs
 * from the page's (a colleague's add, move or delete, or a lesson that came
 * or went), its rows replace the page's, so the list and its base stay one
 * snapshot; otherwise the lessons are patched in place.
 */
function takeServerOutline(state: WorkspaceState, outline: CourseOutline): WorkspaceState {
  if (outline === state.seen) return state;
  const listChanged =
    (outline.sections?.version ?? null) !== (state.sections?.version ?? null);
  return {
    ...(listChanged ? replaceOutline(state, outline) : takeRefreshedOutline(state, outline)),
    seen: outline,
  };
}

/**
 * A fresh outline after router.refresh(), with the same lesson list: take
 * what learners see now (for the read views), and fresh start points for
 * texts nobody wrote in that language yet (a fallback may have changed). A
 * text an editor saved is kept — unless it is waiting for a re-read, which
 * is what the refresh was for. It never adds, removes or reorders lessons
 * (D39). The server's own view of each lesson in the list (its section,
 * content and bases, and that it is a lesson with media) is taken too, so
 * each base matches what is shown. A row without a section keeps the page's
 * present, addable and editable, as in Release 0: a refresh that raced a
 * save or a removal must not flip it back.
 */
function takeRefreshedOutline(state: WorkspaceState, outline: CourseOutline): WorkspaceState {
  const fresh = new Map(outline.lessons.map((l) => [l.key, l]));
  const revs = { ...state.revs };
  const pending: WorkspaceState["pending"] = {};

  const lessons = state.lessons.map((lesson) => {
    const f = fresh.get(lesson.key);
    if (!f) return lesson;
    return {
      ...lesson,
      byLang: mergeTexts(state, lesson, f, revs, pending),
      updatedAt: f.updatedAt,
      section: f.section,
      parts: f.parts,
      contentVersion: f.contentVersion,
      live: f.live,
      ...(listed(f) ? { present: f.present, addable: f.addable, editable: f.editable } : {}),
    };
  });

  return { ...state, ...courseFacts(outline), lessons, revs, pending };
}

/**
 * The server's lesson list replaces the page's: rows, order, structure,
 * media and bases all come from it. Texts follow the refresh rule above, so
 * a saved text and a waiting re-read are treated the same way. Re-reads,
 * revisions and open editors of lessons that are gone are dropped. `seen`
 * is left alone (see WorkspaceState.seen).
 */
function replaceOutline(state: WorkspaceState, outline: CourseOutline): WorkspaceState {
  const mine = new Map(state.lessons.map((l) => [l.key, l]));
  const keys = new Set(outline.lessons.map((l) => l.key));
  const revs: WorkspaceState["revs"] = {};
  for (const [id, rev] of Object.entries(state.revs)) {
    if (keys.has(lessonOfPair(id))) revs[id] = rev;
  }
  const pending: WorkspaceState["pending"] = {};

  const lessons = outline.lessons.map((f) => {
    const lesson = mine.get(f.key);
    return lesson ? { ...f, byLang: mergeTexts(state, lesson, f, revs, pending) } : f;
  });

  return {
    ...state,
    ...courseFacts(outline),
    lessons,
    revs,
    pending,
    open: new Set([...state.open].filter((key) => keys.has(key))),
  };
}

/**
 * One lesson's texts per language, from the page's version (`lesson`) and
 * the server's (`f`). Bumps `revs` for a re-read that got its answer and
 * puts the re-reads still waiting into `pending`.
 */
function mergeTexts(
  state: WorkspaceState,
  lesson: LessonOutline,
  f: LessonOutline,
  revs: WorkspaceState["revs"],
  pending: WorkspaceState["pending"]
): LessonOutline["byLang"] {
  const byLang = { ...f.byLang };
  for (const lang of CONTENT_LOCALES) {
    const id = pair(lesson.key, lang);
    const mine = lesson.byLang[lang].narrative;
    const theirs = f.byLang[lang].narrative;
    let narrative = mine;
    if (id in state.pending) {
      // Wait for an outline without the text this page had (a refresh
      // started before the revert or the colleague's save may still
      // arrive first).
      const stale = state.pending[id];
      if (theirs && theirs.version !== stale) {
        narrative = theirs;
        revs[id] = (revs[id] ?? 0) + 1;
      } else {
        pending[id] = stale;
      }
    } else if (mine && !mine.hasOverride && theirs) {
      narrative = theirs;
    }
    byLang[lang] = { ...f.byLang[lang], narrative };
  }
  return byLang;
}

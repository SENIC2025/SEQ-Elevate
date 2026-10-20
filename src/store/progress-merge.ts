/**
 * Merging a signed-in learner's saved progress with what they did before it
 * arrived.
 *
 * The learner store starts empty and loads the saved data from the server.
 * On a cold server that takes seconds, and the learner may already be
 * walking a course — even to the end, badge included — when it arrives.
 * Swapping the saved copy in would throw those steps away, and the
 * write-through skips everything done while loading, so the two are merged
 * instead: nothing either side recorded is lost, and where both answered
 * the same question the saved answer comes first unless noted.
 *
 * Pure (no React, no server): DemoStateProvider in demo-state.tsx applies it.
 */

import {
  emptyAssessment,
  hasAssessmentProgress,
  mergeAssessment,
  readAssessment,
  type AssessmentProgress,
} from "@/lib/assessment-progress";
import type { PartKey } from "@/lib/cms/sections/contract";
import type { StoredAnswer } from "@/lib/learner-progress/contract";
import { readIds, readResponses } from "@/lib/learner-progress/parse";
import type { CompCardData, CourseProgress, DemoState } from "./demo-state";

/** An answer counts once it has more than whitespace in it. */
const answered = (text: string) => text.trim() !== "";

/** Course `slug` with nothing done in it. */
const blankCourse = (slug: string | null): CourseProgress => ({
  courseSlug: slug,
  courseTitle: null,
  stagesCompleted: [],
  simulation: null,
  scenario: { root: null, followup: null, rootLabel: null, followupLabel: null },
  reflection: { p1: "", p2: "", p3: "" },
  assessment: emptyAssessment(),
  sectionsCompleted: [],
  responses: {},
  completedAt: null,
});

/** `s`'s ids, then those of `l` it doesn't have. */
const union = (s: readonly string[], l: readonly string[]) => [...s, ...l.filter((id) => !s.includes(id))];

/** Values compared as JSON with object keys in order. */
function same(a: unknown, b: unknown): boolean {
  const canonical = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    if (typeof v === "object" && v !== null) {
      const o = v as Record<string, unknown>;
      return `{${Object.keys(o)
        .sort()
        .filter((k) => o[k] !== undefined)
        .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
        .join(",")}}`;
    }
    return JSON.stringify(v) ?? "null";
  };
  return canonical(a) === canonical(b);
}

/** An answer kept per item, as the store holds it. */
type ItemAnswer = StoredAnswer & { retaken?: true };
type ItemAnswers = CourseProgress["responses"];

/** Is there anything in an answer kept per item? */
function hasItemAnswer(a: ItemAnswer | undefined): boolean {
  switch (a?.type) {
    case "practice":
    case "scenario":
      return true;
    case "quiz":
      // A quiz tried again is saved empty over the old check, like the
      // standard one's.
      return Object.keys(a.answers).length > 0 || a.checked || a.retaken === true;
    case "reflection":
      return Object.values(a.text).some(answered);
    case "rating":
      return Object.keys(a.values).length > 0;
    default:
      return false;
  }
}

/**
 * Has the learner done anything in this course yet? A lesson of the
 * course's own or an answer kept per item (a rating, a reflection of the
 * course's own) counts too, so it enrols them; opening a course doesn't.
 */
export function hasCourseProgress(course: CourseProgress): boolean {
  const { reflection: r } = course;
  return (
    course.stagesCompleted.length > 0 ||
    course.sectionsCompleted.length > 0 ||
    Object.values(course.responses).some(hasItemAnswer) ||
    course.simulation !== null ||
    !!course.scenario.root ||
    answered(r.p1) ||
    answered(r.p2) ||
    answered(r.p3) ||
    hasAssessmentProgress(course.assessment) ||
    // A quick check tried again: its empty answers are saved over the old
    // check, which would otherwise come back on the next visit.
    course.assessment.retaken === true ||
    course.completedAt !== null
  );
}

/**
 * One course's progress from both sides. Only for the same course: for a
 * different courseSlug there is nothing to merge and `local` comes back.
 *
 * - stages, and the course's own lessons: the saved ones in their order,
 *   then any new local ones;
 * - simulation, quick-check answers (by question id): the local choice,
 *   else the saved one; a check from either side holds unless a local
 *   answer differs from the saved one, which opens the quiz again, and a
 *   quiz tried again locally keeps only what was chosen since (see
 *   assessment-progress.ts);
 * - scenario: the local path if one was started (root and follow-up belong
 *   together), else the saved path;
 * - reflection: each local answer that isn't empty, else the saved one;
 * - answers kept per item (responses), key by key: a quiz as the quick
 *   check above, a reflection or rating question by question (a written
 *   local answer, else the saved one), a practice or scenario the local
 *   one whole, else the saved one; an item whose type changed takes the
 *   local answer;
 * - completedAt: the saved date — the first completion stays the date —
 *   else the local one;
 * - courseTitle: the local (displayed) title, else the saved one.
 */
export function mergeCourseProgress(
  local: CourseProgress,
  saved: CourseProgress
): CourseProgress {
  if (local.courseSlug !== saved.courseSlug) return local;
  const text = (l: string, s: string) => (answered(l) ? l : s);
  return {
    courseSlug: local.courseSlug,
    courseTitle: local.courseTitle ?? saved.courseTitle,
    stagesCompleted: union(saved.stagesCompleted, local.stagesCompleted),
    sectionsCompleted: union(saved.sectionsCompleted ?? [], local.sectionsCompleted),
    simulation: local.simulation ?? saved.simulation,
    scenario: local.scenario.root ? local.scenario : saved.scenario,
    reflection: {
      p1: text(local.reflection.p1, saved.reflection.p1),
      p2: text(local.reflection.p2, saved.reflection.p2),
      p3: text(local.reflection.p3, saved.reflection.p3),
    },
    assessment: mergeAssessment(local.assessment, saved.assessment),
    responses: mergeResponses(local.responses, saved.responses ?? {}),
    completedAt: saved.completedAt ?? local.completedAt,
  };
}

/** One item's answer from both sides (see mergeCourseProgress). */
function mergeItem(l: ItemAnswer | undefined, s: ItemAnswer | undefined): ItemAnswer | undefined {
  if (!l || !s || l.type !== s.type) return l ?? s;
  if (l.type === "quiz" && s.type === "quiz") {
    const quiz = mergeAssessment(
      { answers: l.answers, checked: l.checked, ...(l.retaken ? { retaken: true as const } : {}) },
      { answers: s.answers, checked: s.checked }
    );
    return { type: "quiz", ...quiz };
  }
  if (l.type === "reflection" && s.type === "reflection") {
    const text: Record<string, string> = { ...s.text };
    for (const [id, t] of Object.entries(l.text)) {
      if (answered(t) || !(id in text)) text[id] = t;
    }
    return { type: "reflection", text };
  }
  if (l.type === "rating" && s.type === "rating") {
    return { type: "rating", values: { ...s.values, ...l.values } };
  }
  return l;
}

/** The answers kept per item from both sides, key by key. */
function mergeResponses(local: ItemAnswers, saved: ItemAnswers): ItemAnswers {
  const out: ItemAnswers = {};
  for (const key of new Set([...Object.keys(saved), ...Object.keys(local)]) as Set<PartKey>) {
    const merged = mergeItem(local[key], saved[key]);
    if (merged) out[key] = merged;
  }
  return out;
}

/**
 * The account's progress (`saved`) with a guest's course (`guest`) only
 * where it has none — what the server keeps when the guest's course moves
 * in fill mode (merge-server.ts): lessons are a union; a practice, scenario
 * or quick check is the account's if it has one; a reflection or rating
 * gets the guest's answer only to a question the account hasn't answered.
 */
function accountFirst(saved: CourseProgress, guest: CourseProgress): CourseProgress {
  const text = (s: string, g: string) => (answered(s) ? s : g);
  const responses: ItemAnswers = { ...guest.responses };
  for (const [key, s] of Object.entries(saved.responses ?? {}) as [PartKey, ItemAnswer][]) {
    const g = guest.responses[key];
    if (s.type === "reflection" && g?.type === "reflection") {
      const filled = { ...s.text };
      for (const [id, t] of Object.entries(g.text)) if (!answered(filled[id] ?? "")) filled[id] = t;
      responses[key] = { type: "reflection", text: filled };
    } else if (s.type === "rating" && g?.type === "rating") {
      responses[key] = { type: "rating", values: { ...g.values, ...s.values } };
    } else {
      responses[key] = s;
    }
  }
  const assessment = readAssessment(saved.assessment);
  return {
    courseSlug: saved.courseSlug,
    courseTitle: saved.courseTitle ?? guest.courseTitle,
    stagesCompleted: union(saved.stagesCompleted, guest.stagesCompleted),
    sectionsCompleted: union(saved.sectionsCompleted ?? [], guest.sectionsCompleted),
    simulation: saved.simulation ?? guest.simulation,
    scenario: saved.scenario.root ? saved.scenario : guest.scenario,
    reflection: {
      p1: text(saved.reflection.p1, guest.reflection.p1),
      p2: text(saved.reflection.p2, guest.reflection.p2),
      p3: text(saved.reflection.p3, guest.reflection.p3),
    },
    assessment:
      Object.keys(assessment.answers).length > 0 || assessment.checked ? assessment : guest.assessment,
    responses,
    completedAt: saved.completedAt ?? guest.completedAt,
  };
}

/**
 * `current` without the guest's course (`guest`) it still holds: only what
 * the learner did on the page besides it — a field still as the guest left
 * it reads as nothing done.
 */
function doneBesides(current: CourseProgress, guest: CourseProgress): CourseProgress {
  const responses: ItemAnswers = {};
  for (const [key, c] of Object.entries(current.responses) as [PartKey, ItemAnswer][]) {
    const g = guest.responses[key];
    if (c.type === "reflection" && g?.type === "reflection") {
      const text = Object.fromEntries(Object.entries(c.text).filter(([id, t]) => g.text[id] !== t));
      if (Object.keys(text).length) responses[key] = { type: "reflection", text };
    } else if (c.type === "rating" && g?.type === "rating") {
      const values = Object.fromEntries(Object.entries(c.values).filter(([id, v]) => g.values[id] !== v));
      if (Object.keys(values).length) responses[key] = { type: "rating", values };
    } else if (!same(c, g)) {
      responses[key] = c;
    }
  }
  const kept = (field: keyof CourseProgress["reflection"]) =>
    current.reflection[field] === guest.reflection[field] ? "" : current.reflection[field];
  const quiz = (a: AssessmentProgress) => ({ ...a, retaken: a.retaken === true });
  return {
    ...current,
    simulation: same(current.simulation, guest.simulation) ? null : current.simulation,
    scenario:
      current.scenario.root === guest.scenario.root && current.scenario.followup === guest.scenario.followup
        ? blankCourse(null).scenario
        : current.scenario,
    reflection: { p1: kept("p1"), p2: kept("p2"), p3: kept("p3") },
    assessment: same(quiz(current.assessment), quiz(guest.assessment)) ? emptyAssessment() : current.assessment,
    responses,
    completedAt: current.completedAt === guest.completedAt ? null : current.completedAt,
  };
}

/**
 * The answers kept per item in a stored copy of the store (`raw`): each it
 * can read (readResponses), without the quiz's "tried again" mark, which
 * only steers merging on the page that set it, as the quick check's does.
 */
function readItemAnswers(raw: unknown): ItemAnswers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const items = Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).map(([key, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [key, value];
      const { retaken: _retaken, ...rest } = value as Record<string, unknown>;
      void _retaken;
      return [key, rest];
    })
  );
  return readResponses({ v: 1, items });
}

/**
 * The course state once `slug`'s saved progress (`saved`, null if none) has
 * loaded, or null for "leave it as it is": the learner has moved on to
 * another course, or there's nothing saved and nothing done yet (opening a
 * course doesn't enroll anyone).
 *
 * Otherwise it's always a NEW object — the merge, or a copy of the current
 * progress when nothing was saved — so the store's debounced write-through
 * runs and saves what the learner did while this loaded.
 *
 * `migrated` is the guest's course when it moved into the account on
 * sign-in (guest-migration.ts) and this is its first load. It was sent in
 * fill mode, so the account wins (spec 5.4) — and so it does here: what the
 * current progress still holds of it counts as the guest's, filling only
 * what the account lacks, as the server's fill does; what the learner did
 * on the page besides it wins over the account like any local change. The
 * save that follows then sends only that and the gaps, never the guest's
 * answer over one another device saved meanwhile.
 */
export function courseAfterLoad(
  current: CourseProgress,
  slug: string,
  saved: CourseProgress | null,
  migrated?: CourseProgress | null
): CourseProgress | null {
  if (current.courseSlug !== slug) return null;
  if (migrated?.courseSlug === slug) {
    const account = saved?.courseSlug === slug ? saved : blankCourse(slug);
    return mergeCourseProgress(doneBesides(current, migrated), accountFirst(account, migrated));
  }
  if (saved?.courseSlug === slug) return mergeCourseProgress(current, saved);
  return hasCourseProgress(current) ? { ...current } : null;
}

/**
 * The course state once a guest's last-played course (`migrated`) has moved
 * to their account on sign-in — it's already saved there — or null for
 * "leave it as it is". It's merged in only when it's the course being
 * played, as courseAfterLoad does, keeping what the learner did while their
 * account loaded; shown when no course is being played; and any other
 * course being played is left alone, so its steps stay its own: the
 * migrated course loads like any other when it's opened.
 */
export function courseAfterMigration(
  current: CourseProgress,
  migrated: CourseProgress
): CourseProgress | null {
  if (!migrated.courseSlug) return null;
  if (current.courseSlug === null) return { ...migrated };
  return courseAfterLoad(current, migrated.courseSlug, migrated);
}

/**
 * The Comp Card once the saved one (`saved`, null if none) has loaded.
 * `local` is the card in the store, which started as `blank`. If the
 * learner filled it in while the saved card loaded (updatedAt set), what
 * they entered is newer and wins, field by field: a text with more than
 * whitespace in it, a confidence or privacy changed from the blank card's.
 * A field they didn't touch keeps the saved value — they never saw it, so
 * leaving it isn't clearing it. updatedAt stays set, so the store's
 * write-through saves the merged card. Nothing entered: the saved card.
 */
export function mergeCompCardOnHydrate(
  local: CompCardData,
  saved: CompCardData | null,
  blank: CompCardData
): CompCardData {
  if (!saved) return local;
  if (!local.updatedAt) return saved;
  const text = (l: string, s: string) => (answered(l) ? l : s);
  return {
    wentWell: text(local.wentWell, saved.wentWell),
    difficult: text(local.difficult, saved.difficult),
    improve: text(local.improve, saved.improve),
    behaviour: text(local.behaviour, saved.behaviour),
    confidence:
      local.confidence !== blank.confidence ? local.confidence : saved.confidence,
    privacy: local.privacy !== blank.privacy ? local.privacy : saved.privacy,
    updatedAt: local.updatedAt,
  };
}

/** Badges are only ever earned: the server's, then any earned locally. */
export function mergeBadges(db: string[], local: string[]): string[] {
  const known = new Set(db);
  return [...db, ...local.filter((b) => !known.has(b))];
}

/**
 * A guest's store once their progress has been read from this browser's
 * guest store (`stored`). The page may have been used before that — the
 * read waits for the session — and what was done meanwhile is kept, as it
 * is for a signed-in learner: the course being played stays that course,
 * merged with its stored progress when it's the same one
 * (courseAfterMigration), so opening another course never records its
 * steps against the stored one; badges are a union; the Comp Card is
 * merged field by field. `blank` is the empty store.
 */
export function guestStateAfterHydrate(
  current: DemoState,
  stored: DemoState,
  blank: DemoState
): DemoState {
  return {
    ...stored,
    badges: mergeBadges(stored.badges ?? [], current.badges),
    course:
      courseAfterMigration(current.course, stored.course) ?? current.course,
    compCard: mergeCompCardOnHydrate(
      current.compCard,
      stored.compCard,
      blank.compCard
    ),
  };
}

/**
 * A copy of the store read back from this browser's guest store (`raw`,
 * parsed JSON), with what it lacks taken from the empty store (`blank`).
 * The guest store may hold a copy written by an older page: one from before
 * quick-check answers were kept holds three empty slots, which are read as
 * a quick check not yet answered (assessment-progress.ts); one from before
 * Release 2 has no lessons of the course's own or answers per item, which
 * are read as none — and what it holds of those is read as the server
 * reads them, leaving out what can't be (parse.ts). The server's refusals
 * aren't read back: they belong to the page that got them. Anything that
 * isn't a stored copy at all is the empty store.
 */
export function storedGuestState(raw: unknown, blank: DemoState): DemoState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return blank;
  const stored = raw as Partial<DemoState>;
  const course = (stored.course ?? {}) as Partial<CourseProgress>;
  return {
    ...blank,
    ...stored,
    badges: Array.isArray(stored.badges) ? stored.badges : blank.badges,
    course: {
      ...blank.course,
      ...course,
      assessment: readAssessment(course.assessment),
      sectionsCompleted: readIds(course.sectionsCompleted),
      responses: readItemAnswers(course.responses),
    },
    compCard: { ...blank.compCard, ...stored.compCard },
    refusedKeys: blank.refusedKeys,
  };
}

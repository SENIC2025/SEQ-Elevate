/**
 * What the course page gives one lesson (LessonSection): the contract between
 * the lesson list and workspace (CourseWorkspace) and the lesson's editors.
 *
 * Release 1 builds those two sides in parallel, so this file is the only
 * place they meet: CourseWorkspace always passes every prop, and
 * LessonSection reads nothing else from the page. Owned by the Foundation;
 * after it merges, only the integration lead edits it.
 */

import type { ReactNode } from "react";
import type {
  CourseKind,
  CourseOutline,
  LessonOutline,
  NarrativeInitial,
} from "@/lib/cms/course-admin-types";
import type { CourseStatus } from "@/lib/cms/course-status";
import type { NewOnlyReason } from "@/lib/cms/sections/contract";
import type { StoredStructure } from "@/lib/cms/structure";
import type { LessonDocumentRef, Locale, VideoContent } from "@/lib/cms/types";
import type { StaffLessonLink } from "@/lib/cms/lesson-links";

export interface LessonSectionProps {
  lesson: LessonOutline;
  /**
   * The lesson's heading: "2. Skill concept" in the content language
   * (resolved by CourseWorkspace), unnumbered for a lesson learners don't
   * get, such as an "Add …" slot.
   */
  label: string;
  /**
   * The language `label` is in, when it isn't the menu's: a created course
   * names its lessons in the content language (WCAG 3.1.2).
   */
  labelLang?: Locale;
  slug: string;
  kind: CourseKind;
  /** The course's status: whether a save for learners goes live at once. */
  status: CourseStatus;
  lang: Locale;
  open: boolean;
  /** Bumped when this lesson's text in `lang` was re-read after a revert. */
  rev: number;
  /** Learners enrolled (D53), for the hints on what they would lose (G4, G5). */
  enrolled: number;
  /**
   * The course's reasons (course level): only "unreadable" matters now, for
   * predicting that every content change is refused (G8).
   */
  reasons: readonly NewOnlyReason[];
  /**
   * Release 2 (D66, D67): the course's learners and the 1 December
   * cut-off, for the rules on adding, moving and removing content
   * (SectionsMeta; absent for a built-in course).
   */
  live?: { learners: number; finished: number; closed: boolean; closedFrom: string | null };
  /**
   * An "Add …" lesson whose first "Save stage" would add it while the
   * course takes no new lesson (finding 1 of the integration review: at
   * the limit, its list unreadable, or from the cut-off with learners): why,
   * in words. Its Add button is then aria-disabled, described by this.
   * Unset when it may be added (with learners, the save asks first).
   */
  addLocked?: string;
  /** Rendered in the lesson's header (the lesson list's Rename shortcut). */
  headerExtra?: ReactNode;
  onOpen(): void;
  onClose(): void;
  onNarrativeSaved(value: NarrativeInitial): void;
  /**
   * Re-read this lesson's text in `lang` from the server, once it is no
   * longer the `stale` version the editor had (then `rev` bumps).
   */
  onReread(stale: string | null): void;
  onStructureSaved(structure: StoredStructure): void;
  /** An interactive lesson's draft was saved (as stored) or is gone (null). */
  onStructureDraftChanged(draft: StoredStructure | null): void;
  onStructureCleared(): void;
  onVideoSaved(video: VideoContent | null): void;
  onDocumentsChanged(documents: LessonDocumentRef[]): void;
  /**
   * Release 4 (D107): the lesson's further-reading links after a change in
   * its link manager, drafts included, as getLessonLinks read them back.
   */
  onLinksChanged(links: StaffLessonLink[]): void;
  /**
   * A structural content action (add, move or remove content) returned the
   * whole course outline, built after it committed: take it in (D39).
   */
  onOutline(outline: CourseOutline): void;
  /**
   * Say something in the page's one polite live region (spec 11.3): content
   * added, moved or removed. The same words twice are read twice.
   */
  announce(text: string): void;
}

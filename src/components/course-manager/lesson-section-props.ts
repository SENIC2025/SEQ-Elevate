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

export interface LessonSectionProps {
  lesson: LessonOutline;
  /**
   * The lesson's heading: "2. Skill concept" in the content language
   * (resolved by CourseWorkspace), unnumbered for a lesson learners don't
   * get, such as an "Add …" slot.
   */
  label: string;
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
   * Why learners couldn't get the course as it stands (course level), for
   * predicting which content changes a published course refuses.
   */
  reasons: readonly NewOnlyReason[];
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
   * A structural content action (add, move or remove content) returned the
   * whole course outline, built after it committed: take it in (D39).
   */
  onOutline(outline: CourseOutline): void;
}

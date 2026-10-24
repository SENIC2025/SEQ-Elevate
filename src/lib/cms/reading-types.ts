/**
 * Release 4's types for further reading and languages (spec 4.4). Since R2
 * the two optional fields are in types.ts as well
 * (`LessonDocumentRef.languages`, `CourseStage.links`); the intersections
 * written before it (`LessonDocumentRef & ItemLanguages`,
 * `CourseStage & StageReading`) stay valid.
 *
 * Types only: nothing here runs.
 */

import type { LinkKind } from "@/lib/rich-text/link-url";
import type { Locale } from "./types";

/**
 * A further-reading link of a lesson, as a page gets it (D107): `url` and
 * `kind` are what checkLinkHref accepted when the row was read, so a page
 * only ever draws an accepted, normalised address. A stored row the check
 * refuses never becomes one.
 */
export interface LessonLinkRef {
  id: string;
  title: string;
  url: string;
  kind: LinkKind;
  /** Plain text; "" when there is none. */
  description: string;
  /** The languages it is for; [] = every language (D108). */
  languages: Locale[];
  /** Shown to learners. Editors see drafts too; learners only get published links. */
  published: boolean;
}

/** The languages a document or link is for (D108); absent or [] = every language. */
export type ItemLanguages = { languages?: Locale[] };

/** A lesson's further reading, published links only for learners. */
export type StageReading = { links?: LessonLinkRef[] };

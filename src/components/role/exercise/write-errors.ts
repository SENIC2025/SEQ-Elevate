/**
 * What the lesson's content editors say when the server refuses a change
 * (Release 1's new refusals included), as a key under `exerciseEditor` plus
 * its values. Pure, so every code is checked against the real message files
 * (write-errors.test.ts); the exercise editor, the text content editor and
 * the content controls (Add content, Move, Remove) share it.
 *
 * A refusal says what happened and what to do next, never "try again" when
 * trying again can't work (the lesson left the list, the list can't be
 * read, the course is live).
 */

/** A refusal as the editors handle it: the action's error, with its count when it has one. */
export interface WriteRefusal {
  error: string;
  /** has-learners: how many learners would lose what they have. */
  count?: number;
}

export interface MessageRef {
  /** Under `exerciseEditor`. */
  key: string;
  values?: Record<string, number>;
}

/** The message for one refused write. Unknown codes get the generic one. */
export function writeErrorMessage(r: WriteRefusal): MessageRef {
  switch (r.error) {
    case "forbidden":
      return { key: "errors.forbidden" };
    case "not-cms-course":
      return { key: "errors.notCms" };
    case "bad-input":
    case "bad-locale":
      return { key: "errors.mismatch" };
    case "kind-mismatch":
      return { key: "errors.kindMismatch" };
    case "not-a-section":
      return { key: "errors.notASection" };
    case "outline-unreadable":
      return { key: "errors.outlineUnreadable" };
    case "has-learners":
      return { key: "errors.hasLearners", values: { count: r.count ?? 0 } };
    case "live-course-standard-only":
      return { key: "errors.liveCourseStandardOnly" };
    case "parts-too-large":
      return { key: "errors.partsTooLarge" };
    case "use-main-editor":
      return { key: "errors.useMainEditor" };
    case "unknown-part":
      return { key: "errors.unknownPart" };
    default:
      return { key: "errors.generic" };
  }
}

/**
 * "Remove stage" keeps Release 0's wording for a refusal it already had
 * ("only editors and admins can change courses"), and names the new ones.
 */
export function removeErrorMessage(r: WriteRefusal): MessageRef {
  switch (r.error) {
    case "has-learners":
    case "not-a-section":
    case "outline-unreadable":
    case "kind-mismatch":
    case "not-cms-course":
    case "live-course-standard-only":
      return writeErrorMessage(r);
    default:
      return { key: "errors.removeFailed" };
  }
}

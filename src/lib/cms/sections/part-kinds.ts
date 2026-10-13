/**
 * The question kinds a lesson can hold (D56): Release 0's practice question,
 * branching scenario and quick check, plus the flexible editor's reflection
 * questions and 1–5 self-assessment.
 *
 * The three Release 0 kinds go through Release 0's rules untouched
 * (sanitizeStructure, validateStructure), so a practice question saved as
 * extra content is checked exactly like one saved with "Save stage". The two
 * new kinds follow the same rules with the same helpers: rebuilt from what
 * the editor can produce, never passed through; text over a limit refused,
 * not cut; and what is stored already may stay as long as it doesn't grow
 * (D52), so no saved question becomes unsaveable.
 *
 * Pure and client-safe: the editor and the server use the same checks.
 */

import {
  hasText,
  issueField,
  validateStructure,
  type LocalizedText,
  type StoredStructure,
  type StructureIssue,
  type StructureIssueCode,
} from "../structure";
import {
  idsIn,
  isRecord,
  list,
  record,
  Refused,
  sanitizeStructure,
  storedField,
  storedItems,
  storedLists,
  STRUCTURE_LIMITS,
  text,
  type Stored,
} from "../structure-sanitize";
import {
  PART_LIMITS,
  type EmptyExercise,
  type ExerciseKind,
  type PartFieldCode,
  type PartFieldKey,
  type PartIssue,
  type PartIssueCode,
  type PartIssueField,
  type PartLimitBreach,
  type PartListCode,
  type PartPlaces,
  type SanitizeExercise,
  type StoredRating,
  type StoredReflection,
  type ValidateExercise,
} from "./contract";

type Rec = Record<string, unknown>;

const LEGACY_KINDS: readonly ExerciseKind[] = ["simulation", "scenario", "assessment"];
const isLegacyKind = (kind: ExerciseKind): kind is StoredStructure["kind"] =>
  LEGACY_KINDS.includes(kind);

/* ---------------------------------- empty ---------------------------------- */

/**
 * A new question in the shape the editor starts it: Release 0's empty
 * exercise (two options with the first marked best, two first choices, one
 * question with two answers), or one question / statement to write. The ids
 * are fixed rather than random so the server can make it: they only need to
 * be unique in their list, and the editor's own new ids never look like them.
 */
export const emptyExercise: EmptyExercise = (kind) => {
  switch (kind) {
    case "simulation":
      return {
        kind,
        title: {},
        prompt: {},
        instruction: {},
        options: [
          { id: "o1", isBest: true, text: {}, feedback: {} },
          { id: "o2", isBest: false, text: {}, feedback: {} },
        ],
      };
    case "scenario":
      return {
        kind,
        title: {},
        setup: {},
        question: {},
        followupQuestion: {},
        choices: [
          { id: "c1", quality: "best", text: {}, outcome: {}, followups: [] },
          { id: "c2", quality: "poor", text: {}, outcome: {} },
        ],
      };
    case "assessment":
      return {
        kind,
        title: {},
        intro: {},
        questions: [
          {
            id: "q1",
            correctOptionId: "",
            question: {},
            options: [
              { id: "a1", text: {} },
              { id: "a2", text: {} },
            ],
          },
        ],
      };
    case "reflection":
      return { kind, title: {}, intro: {}, prompts: [{ id: "p1", label: {} }] };
    case "rating":
      return {
        kind,
        title: {},
        intro: {},
        minLabel: {},
        maxLabel: {},
        statements: [{ id: "s1", text: {} }],
      };
  }
};

/* -------------------------------- sanitize --------------------------------- */

/** One of the new kinds' text boxes, with the same box in what is stored. */
function box(
  node: Rec,
  stored: Stored,
  key: string,
  field: PartFieldCode,
  max: number,
  params?: PartPlaces
): LocalizedText {
  // Every new box is one line except an intro, as in the editor.
  const oneLine = field !== "partIntro";
  return text<PartFieldCode>(
    node[key],
    max,
    { field, ...(params ? { params } : {}), stored: storedField(stored, key) },
    oneLine
  );
}

/** A box kept only when the question has it (like a stage's optional title). */
function optional(
  node: Rec,
  stored: Stored,
  key: "title" | "intro" | "placeholder",
  field: PartFieldCode,
  max: number,
  params?: PartPlaces
): Partial<Record<typeof key, LocalizedText>> {
  return node[key] === undefined ? {} : { [key]: box(node, stored, key, field, max, params) };
}

/** A list of the new kinds, with the same list in what is stored. */
function items(node: Rec, stored: Stored, key: string, max: number, name: PartListCode): Rec[] {
  return list<PartListCode>(node[key], max, storedLists(stored, key), { list: name }).map(record);
}

function reflection(s: Rec, stored: Stored): StoredReflection {
  const storedPrompts = storedLists(stored, "prompts");
  const prompts = items(s, stored, "prompts", PART_LIMITS.reflectionPrompts, "reflectionPrompts");
  const ids = idsIn(prompts);
  return {
    kind: "reflection",
    ...optional(s, stored, "title", "partTitle", PART_LIMITS.titleChars),
    ...optional(s, stored, "intro", "partIntro", PART_LIMITS.introChars),
    prompts: prompts.map((p, i) => {
      const was = storedItems(storedPrompts, ids[i]);
      const at = { prompt: i + 1 };
      return {
        id: ids[i],
        label: box(p, was, "label", "reflectionPromptLabel", PART_LIMITS.promptChars, at),
        ...optional(
          p,
          was,
          "placeholder",
          "reflectionPromptPlaceholder",
          PART_LIMITS.placeholderChars,
          at
        ),
      };
    }),
  };
}

function rating(s: Rec, stored: Stored): StoredRating {
  const storedStatements = storedLists(stored, "statements");
  const statements = items(s, stored, "statements", PART_LIMITS.ratingStatements, "ratingStatements");
  const ids = idsIn(statements);
  return {
    kind: "rating",
    ...optional(s, stored, "title", "partTitle", PART_LIMITS.titleChars),
    ...optional(s, stored, "intro", "partIntro", PART_LIMITS.introChars),
    minLabel: box(s, stored, "minLabel", "ratingMinLabel", PART_LIMITS.endLabelChars),
    maxLabel: box(s, stored, "maxLabel", "ratingMaxLabel", PART_LIMITS.endLabelChars),
    statements: statements.map((st, i) => ({
      id: ids[i],
      text: box(
        st,
        storedItems(storedStatements, ids[i]),
        "text",
        "ratingStatementText",
        PART_LIMITS.statementChars,
        { statement: i + 1 }
      ),
    })),
  };
}

/**
 * The question as it may be stored for a part of `kind`, or why not — see
 * sanitizeStructure, whose rules (and, for its three kinds, whose code) this
 * is. `stored` is what the part holds now, its live version and its draft,
 * read by the server under the lesson's lock: never the client's base.
 */
export const sanitizeExercise: SanitizeExercise = (input, kind, stored = []) => {
  if (isLegacyKind(kind)) {
    const res = sanitizeStructure(input, kind, stored);
    return res.ok ? { ok: true, value: res.structure } : res;
  }
  try {
    const s = record(input);
    if (s.kind !== kind) throw new Refused();
    const same = stored.filter((v): v is Rec => isRecord(v) && v.kind === kind);
    const value = kind === "reflection" ? reflection(s, same) : rating(s, same);
    const size = JSON.stringify(value).length;
    if (
      size > STRUCTURE_LIMITS.maxJsonChars &&
      !same.some((v) => size <= JSON.stringify(v).length)
    ) {
      throw new Refused({ limit: "total", max: STRUCTURE_LIMITS.maxJsonChars });
    }
    return { ok: true, value };
  } catch (error) {
    if (error instanceof Refused) {
      // Only the new kinds' boxes and lists can be named here.
      return error.at
        ? { ok: false, error: "too-large", at: error.at as PartLimitBreach }
        : { ok: false, error: "bad-input" };
    }
    throw error;
  }
};

/* -------------------------------- validate --------------------------------- */

/**
 * Why a question isn't ready for learners. The Release 0 kinds: exactly
 * "Save stage"'s reasons. Reflection questions: at least one, each written
 * in some language. A self-assessment: at least one statement, each written,
 * and both ends of the scale named — a learner can't rate "1 to 5" of
 * nothing.
 */
export const validateExercise: ValidateExercise = (v) => {
  if (v.kind !== "reflection" && v.kind !== "rating") return validateStructure(v);
  const issues: PartIssue[] = [];
  if (v.kind === "reflection") {
    const prompts = Array.isArray(v.prompts) ? v.prompts : [];
    if (prompts.length < 1) issues.push({ code: "reflectionNoPrompts" });
    prompts.forEach((p, i) => {
      if (!hasText(p?.label)) issues.push({ code: "reflectionPromptText", params: { prompt: i + 1 } });
    });
    return issues;
  }
  const statements = Array.isArray(v.statements) ? v.statements : [];
  if (statements.length < 1) issues.push({ code: "ratingNoStatements" });
  statements.forEach((st, i) => {
    if (!hasText(st?.text)) {
      issues.push({ code: "ratingStatementText", params: { statement: i + 1 } });
    }
  });
  if (!hasText(v.minLabel) || !hasText(v.maxLabel)) issues.push({ code: "ratingEndLabels" });
  return issues;
};

/* --------------------------------- fields ---------------------------------- */

/** fieldKey's places, in its order, then the new kinds' own. */
const PLACES = ["option", "choice", "followup", "question", "answer", "prompt", "statement"] as const;

/**
 * The key of one text box in a question's editor: structure.ts fieldKey,
 * plus the question or statement a new kind's box is in. A Release 0 box
 * gets exactly the key fieldKey gives it.
 */
export const partFieldKey: PartFieldKey = (code, params = {}) =>
  [code, ...PLACES.flatMap((p) => (params[p] ? [`${p}${params[p]}`] : []))].join("-");

/** The reasons only the new kinds have. */
type NewIssueCode = Exclude<PartIssueCode, StructureIssueCode>;

/**
 * The box each new reason is about, by the name the editor and the size
 * limits call it (PartFieldCode) — a Release 0 reason names its box by its
 * own code instead. Null: about the whole question (nothing written), or
 * about two boxes at once (both ends of a scale).
 */
const NEW_ISSUE_FIELDS: Readonly<Record<NewIssueCode, PartFieldCode | null>> = {
  reflectionNoPrompts: null,
  reflectionPromptText: "reflectionPromptLabel",
  ratingNoStatements: null,
  ratingStatementText: "ratingStatementText",
  ratingEndLabels: null,
};

const isNewIssue = (code: PartIssueCode): code is NewIssueCode =>
  Object.hasOwn(NEW_ISSUE_FIELDS, code);

/** The text box a reason is about, or null when it is about no single box. */
export const partIssueField: PartIssueField = (issue) => {
  if (!isNewIssue(issue.code)) return issueField(issue as StructureIssue);
  const field = NEW_ISSUE_FIELDS[issue.code];
  return field ? partFieldKey(field, issue.params) : null;
};

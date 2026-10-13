/**
 * Checking an interactive stage (simulation / scenario / quick check) before
 * it is stored — as a draft or for learners. A server action's arguments come
 * straight from the browser, so the structure is rebuilt from what its kind
 * allows, never passed through (like sanitizeNarrativeBlocks, D36):
 *
 * - every text keeps only the three content languages, cleaned of invisible
 *   characters (Postgres refuses a NUL or a lone surrogate in JSON);
 * - a language left blank is dropped, so learners fall back to a language
 *   that has text instead of meeting an empty box;
 * - ids must be short tokens, unique in their list (learners' answers are
 *   stored against them);
 * - scenarios keep one level of follow-ups, as the editor and player do.
 *
 * Whether the stage is complete is not checked here — a draft may be
 * unfinished. That is validateStructure's job, for the save learners see.
 *
 * Text over a limit is refused rather than cut short: silently losing the end
 * of an author's text is worse than asking them to shorten it. The editor's
 * boxes stop at the same limits, so only a crafted request meets them — or a
 * stage saved before the limits existed (Release 0). Such a stage must stay
 * editable, or an editor couldn't even fix a typo in it (nor save a draft),
 * and the only way out would be removing it, which breaks the ids learners'
 * answers point to. So what the row already holds is allowed: a text no
 * longer than the same box's stored text in that language, a list no longer
 * than the same list stored. Only growth past a limit is refused, and the
 * refusal says where, so the editor can point to the box.
 *
 * Pure and unit-tested: no DB, no server-only boundary.
 */

import { cleanInlineText, cleanPlainText } from "@/lib/rich-text/sanitize";
import type { Locale, OutcomeQuality } from "./types";
import type {
  LocalizedText,
  StoredAssessment,
  StoredAssessmentOption,
  StoredAssessmentQuestion,
  StoredScenario,
  StoredScenarioChoice,
  StoredSimOption,
  StoredSimulation,
  StoredStructure,
  StructureFieldCode,
  StructureIssue,
} from "./structure";

export const STRUCTURE_LIMITS = {
  /** A stage title (one line). */
  maxTitleChars: 200,
  /** Any other text: a prompt, a choice, an outcome, a question, an answer. */
  maxTextChars: 2_000,
  maxIdChars: 40,
  /** Simulation options. */
  maxOptions: 10,
  /** Scenario first choices. */
  maxChoices: 8,
  /** Follow-ups under one scenario choice. */
  maxFollowups: 6,
  maxQuestions: 20,
  /** Answers to one quick-check question. */
  maxAnswers: 8,
  /** The whole stage as JSON — a last guard on what one save may store. */
  maxJsonChars: 200_000,
} as const;

/** The lists the editor caps, named like its boxes (StructureFieldCode). */
export const STRUCTURE_LIST_CODES = [
  "simOptions",
  "scenarioChoices",
  "scenarioFollowups",
  "assessmentQuestions",
  "assessmentAnswers",
] as const;
export type StructureListCode = (typeof STRUCTURE_LIST_CODES)[number];

/**
 * Where a structure is over a limit, in the editor's terms: the box (its
 * fieldKey code and place, counted from 1 as the editor numbers them) and
 * the language, or the list and how long it is, or the whole stage. `max`
 * is the limit itself.
 */
export type StructureLimitBreach =
  | {
      limit: "text";
      field: StructureFieldCode;
      params?: StructureIssue["params"];
      locale: Locale;
      max: number;
    }
  | {
      limit: "list";
      list: StructureListCode;
      params?: StructureIssue["params"];
      max: number;
      count: number;
    }
  | { limit: "total"; max: number };

export type SanitizeStructureResult =
  | { ok: true; structure: StoredStructure }
  | { ok: false; error: "bad-input" }
  | { ok: false; error: "too-large"; at: StructureLimitBreach };

const LOCALES: readonly Locale[] = ["en", "de", "el"];
const QUALITIES: readonly OutcomeQuality[] = ["best", "okay", "poor"];
const ID = /^[A-Za-z0-9_-]+$/;

type Rec = Record<string, unknown>;
type Places = StructureIssue["params"];

/** Thrown inside the walk, turned into the result at the top. */
class Refused extends Error {
  constructor(readonly at?: StructureLimitBreach) {
    super(at ? "too-large" : "bad-input");
  }
}

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function record(value: unknown): Rec {
  if (!isRecord(value)) throw new Refused();
  return value;
}

/*
 * What is stored: the same node in each stored version (the structure, the
 * draft), as far as they have it. Read defensively — it is only ever used to
 * allow more, never trusted as a shape.
 */
type Stored = Rec[];

/** The same field of each stored node. */
const storedField = (stored: Stored, key: string): unknown[] =>
  stored.map((node) => node[key]);

/** The same list of each stored node. */
const storedLists = (stored: Stored, key: string): unknown[][] =>
  stored.flatMap((node) => (Array.isArray(node[key]) ? [node[key] as unknown[]] : []));

/** The stored items with this id, in each stored list. */
const storedItems = (lists: unknown[][], id: string): Stored =>
  lists.flatMap((items) => items.filter((item): item is Rec => isRecord(item) && item.id === id));

/** A list, at most `max` long — or as long as the same list stored. */
function list(
  value: unknown,
  max: number,
  stored: unknown[][],
  where: { list: StructureListCode; params?: Places }
): unknown[] {
  if (!Array.isArray(value)) throw new Refused();
  const allowed = Math.max(max, ...stored.map((items) => items.length));
  if (value.length > allowed) {
    throw new Refused({ limit: "list", ...where, max, count: value.length });
  }
  return value;
}

/** Ids for one list: short tokens, none repeated. */
function idsIn(items: Rec[]): string[] {
  const ids = items.map((item) => {
    const id = item.id;
    if (
      typeof id !== "string" ||
      id.length > STRUCTURE_LIMITS.maxIdChars ||
      !ID.test(id)
    ) {
      throw new Refused();
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) throw new Refused();
  return ids;
}

/** One text box: which it is, and the same box in what is stored. */
interface Box {
  field: StructureFieldCode;
  params?: Places;
  stored: unknown[];
}

/**
 * One text in every language it is written in. Missing = nothing written yet
 * (an unfinished draft). A string over twice what is allowed is refused
 * before it is cleaned: whatever cleaning would remove, reading it is wasted
 * work.
 */
function text(value: unknown, max: number, box: Box, oneLine = false): LocalizedText {
  if (value === undefined || value === null) return {};
  const t = record(value);
  const out: LocalizedText = {};
  for (const locale of LOCALES) {
    const raw = t[locale];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") throw new Refused();
    // As long as this box's text in this language is stored already.
    const allowed = Math.max(
      max,
      ...box.stored.map((s) =>
        isRecord(s) && typeof s[locale] === "string" ? (s[locale] as string).length : 0
      )
    );
    const tooLong = (): never => {
      throw new Refused({
        limit: "text",
        field: box.field,
        ...(box.params ? { params: box.params } : {}),
        locale,
        max,
      });
    };
    if (raw.length > 2 * allowed) tooLong();
    const clean = oneLine ? cleanInlineText(raw) : cleanPlainText(raw);
    if (clean.length > allowed) tooLong();
    if (clean.trim()) out[locale] = clean;
  }
  return out;
}

/** A text box other than the title, with its stored versions. */
function body(
  node: Rec,
  stored: Stored,
  key: string,
  field: StructureFieldCode,
  params?: Places
): LocalizedText {
  return text(node[key], STRUCTURE_LIMITS.maxTextChars, {
    field,
    params,
    stored: storedField(stored, key),
  });
}

/** The optional stage heading: kept only when the structure has one. */
function withTitle(s: Rec, stored: Stored): { title?: LocalizedText } {
  return s.title === undefined
    ? {}
    : {
        title: text(
          s.title,
          STRUCTURE_LIMITS.maxTitleChars,
          { field: "stageTitle", stored: storedField(stored, "title") },
          true
        ),
      };
}

function quality(value: unknown): OutcomeQuality {
  if (!QUALITIES.includes(value as OutcomeQuality)) {
    throw new Refused();
  }
  return value as OutcomeQuality;
}

function simulation(s: Rec, stored: Stored): StoredSimulation {
  const storedOptions = storedLists(stored, "options");
  const options = list(s.options, STRUCTURE_LIMITS.maxOptions, storedOptions, {
    list: "simOptions",
  }).map(record);
  const ids = idsIn(options);
  return {
    kind: "simulation",
    ...withTitle(s, stored),
    prompt: body(s, stored, "prompt", "simPrompt"),
    instruction: body(s, stored, "instruction", "simInstruction"),
    options: options.map((o, i): StoredSimOption => {
      const was = storedItems(storedOptions, ids[i]);
      const at = { option: i + 1 };
      return {
        id: ids[i],
        isBest: o.isBest === true,
        text: body(o, was, "text", "simOptionText", at),
        feedback: body(o, was, "feedback", "simOptionFeedback", at),
      };
    }),
  };
}

/**
 * Scenario choices: the first choices, or (with `parent`, the 1-based number
 * of their choice) one choice's follow-ups.
 */
function choices(value: unknown, stored: unknown[][], parent?: number) {
  const items = list(
    value,
    parent ? STRUCTURE_LIMITS.maxFollowups : STRUCTURE_LIMITS.maxChoices,
    stored,
    parent ? { list: "scenarioFollowups", params: { choice: parent } } : { list: "scenarioChoices" }
  ).map(record);
  const ids = idsIn(items);
  return items.map((c, i): StoredScenarioChoice => {
    const was = storedItems(stored, ids[i]);
    const at = parent ? { choice: parent, followup: i + 1 } : { choice: i + 1 };
    const choice: StoredScenarioChoice = {
      id: ids[i],
      quality: quality(c.quality),
      text: body(c, was, "text", parent ? "scenarioFollowupText" : "scenarioChoiceText", at),
      outcome: body(
        c,
        was,
        "outcome",
        parent ? "scenarioFollowupOutcome" : "scenarioChoiceOutcome",
        at
      ),
    };
    // Follow-ups of follow-ups are dropped: nothing shows them.
    if (!parent && c.followups !== undefined && c.followups !== null) {
      choice.followups = choices(c.followups, storedLists(was, "followups"), i + 1);
    }
    return choice;
  });
}

function scenario(s: Rec, stored: Stored): StoredScenario {
  return {
    kind: "scenario",
    ...withTitle(s, stored),
    setup: body(s, stored, "setup", "scenarioSetup"),
    question: body(s, stored, "question", "scenarioQuestion"),
    followupQuestion: body(s, stored, "followupQuestion", "scenarioFollowupQuestion"),
    choices: choices(s.choices, storedLists(stored, "choices")),
  };
}

function assessment(s: Rec, stored: Stored): StoredAssessment {
  const storedQuestions = storedLists(stored, "questions");
  const questions = list(s.questions, STRUCTURE_LIMITS.maxQuestions, storedQuestions, {
    list: "assessmentQuestions",
  }).map(record);
  const ids = idsIn(questions);
  return {
    kind: "assessment",
    ...withTitle(s, stored),
    intro: body(s, stored, "intro", "assessmentIntro"),
    questions: questions.map((q, i): StoredAssessmentQuestion => {
      const was = storedItems(storedQuestions, ids[i]);
      const question = i + 1;
      const storedAnswers = storedLists(was, "options");
      const options = list(q.options, STRUCTURE_LIMITS.maxAnswers, storedAnswers, {
        list: "assessmentAnswers",
        params: { question },
      }).map(record);
      const optionIds = idsIn(options);
      // A draft may not have a ticked answer yet (""); validateStructure
      // asks for one before learners see it.
      const correct =
        typeof q.correctOptionId === "string" &&
        q.correctOptionId.length <= STRUCTURE_LIMITS.maxIdChars
          ? q.correctOptionId
          : "";
      return {
        id: ids[i],
        correctOptionId: correct,
        question: body(q, was, "question", "assessmentQuestionText", { question }),
        options: options.map(
          (o, j): StoredAssessmentOption => ({
            id: optionIds[j],
            text: body(o, storedItems(storedAnswers, optionIds[j]), "text", "assessmentAnswerText", {
              question,
              answer: j + 1,
            }),
          })
        ),
      };
    }),
  };
}

/**
 * The structure as it may be stored for a lesson of `kind`, or why not:
 * "bad-input" for anything the editor can't produce (another kind, a wrong
 * type, a bad id), "too-large" — saying where — for text or lists over
 * STRUCTURE_LIMITS.
 *
 * `stored` is what the lesson row holds now (its structure and its draft):
 * anything over a limit there may stay, as long as it doesn't grow. A save
 * action may take it from the request, as the base the editor started from:
 * it writes only when that base is still what the row holds (D33), so a
 * made-up base gains nothing but "changed-elsewhere".
 */
export function sanitizeStructure(
  input: unknown,
  kind: StoredStructure["kind"],
  stored: readonly unknown[] = []
): SanitizeStructureResult {
  try {
    const s = record(input);
    if (s.kind !== kind) throw new Refused();
    const same = stored.filter((v): v is Rec => isRecord(v) && v.kind === kind);
    const structure =
      kind === "simulation"
        ? simulation(s, same)
        : kind === "scenario"
          ? scenario(s, same)
          : assessment(s, same);
    const size = JSON.stringify(structure).length;
    // Measured only when over: a stored stage may be large.
    if (
      size > STRUCTURE_LIMITS.maxJsonChars &&
      !same.some((v) => size <= JSON.stringify(v).length)
    ) {
      throw new Refused({ limit: "total", max: STRUCTURE_LIMITS.maxJsonChars });
    }
    return { ok: true, structure };
  } catch (error) {
    if (error instanceof Refused) {
      return error.at
        ? { ok: false, error: "too-large", at: error.at }
        : { ok: false, error: "bad-input" };
    }
    throw error;
  }
}

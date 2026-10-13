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
 * boxes stop at the same limits, so only a crafted request meets them.
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

export type SanitizeStructureResult =
  | { ok: true; structure: StoredStructure }
  | { ok: false; error: "bad-input" | "too-large" };

const LOCALES: readonly Locale[] = ["en", "de", "el"];
const QUALITIES: readonly OutcomeQuality[] = ["best", "okay", "poor"];
const ID = /^[A-Za-z0-9_-]+$/;

type Rec = Record<string, unknown>;

/** Thrown inside the walk, turned into the result at the top. */
class Refused extends Error {
  constructor(readonly reason: "bad-input" | "too-large") {
    super(reason);
  }
}

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function record(value: unknown): Rec {
  if (!isRecord(value)) throw new Refused("bad-input");
  return value;
}

function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value)) throw new Refused("bad-input");
  if (value.length > max) throw new Refused("too-large");
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
      throw new Refused("bad-input");
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) throw new Refused("bad-input");
  return ids;
}

/**
 * One text in every language it is written in. Missing = nothing written yet
 * (an unfinished draft). A string over twice the limit is refused before it
 * is cleaned: whatever cleaning would remove, reading it is wasted work.
 */
function text(value: unknown, max: number, oneLine = false): LocalizedText {
  if (value === undefined || value === null) return {};
  const t = record(value);
  const out: LocalizedText = {};
  for (const locale of LOCALES) {
    const raw = t[locale];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") throw new Refused("bad-input");
    if (raw.length > 2 * max) throw new Refused("too-large");
    const clean = oneLine ? cleanInlineText(raw) : cleanPlainText(raw);
    if (clean.length > max) throw new Refused("too-large");
    if (clean.trim()) out[locale] = clean;
  }
  return out;
}

const body = (value: unknown) => text(value, STRUCTURE_LIMITS.maxTextChars);

/** The optional stage heading: kept only when the structure has one. */
function withTitle(s: Rec): { title?: LocalizedText } {
  return s.title === undefined
    ? {}
    : { title: text(s.title, STRUCTURE_LIMITS.maxTitleChars, true) };
}

function quality(value: unknown): OutcomeQuality {
  if (!QUALITIES.includes(value as OutcomeQuality)) {
    throw new Refused("bad-input");
  }
  return value as OutcomeQuality;
}

function simulation(s: Rec): StoredSimulation {
  const options = list(s.options, STRUCTURE_LIMITS.maxOptions).map(record);
  const ids = idsIn(options);
  return {
    kind: "simulation",
    ...withTitle(s),
    prompt: body(s.prompt),
    instruction: body(s.instruction),
    options: options.map(
      (o, i): StoredSimOption => ({
        id: ids[i],
        isBest: o.isBest === true,
        text: body(o.text),
        feedback: body(o.feedback),
      })
    ),
  };
}

function choices(value: unknown, max: number, nested: boolean) {
  const items = list(value, max).map(record);
  const ids = idsIn(items);
  return items.map((c, i): StoredScenarioChoice => {
    const choice: StoredScenarioChoice = {
      id: ids[i],
      quality: quality(c.quality),
      text: body(c.text),
      outcome: body(c.outcome),
    };
    // Follow-ups of follow-ups are dropped: nothing shows them.
    if (nested && c.followups !== undefined && c.followups !== null) {
      choice.followups = choices(
        c.followups,
        STRUCTURE_LIMITS.maxFollowups,
        false
      );
    }
    return choice;
  });
}

function scenario(s: Rec): StoredScenario {
  return {
    kind: "scenario",
    ...withTitle(s),
    setup: body(s.setup),
    question: body(s.question),
    followupQuestion: body(s.followupQuestion),
    choices: choices(s.choices, STRUCTURE_LIMITS.maxChoices, true),
  };
}

function assessment(s: Rec): StoredAssessment {
  const questions = list(s.questions, STRUCTURE_LIMITS.maxQuestions).map(
    record
  );
  const ids = idsIn(questions);
  return {
    kind: "assessment",
    ...withTitle(s),
    intro: body(s.intro),
    questions: questions.map((q, i): StoredAssessmentQuestion => {
      const options = list(q.options, STRUCTURE_LIMITS.maxAnswers).map(record);
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
        question: body(q.question),
        options: options.map(
          (o, j): StoredAssessmentOption => ({
            id: optionIds[j],
            text: body(o.text),
          })
        ),
      };
    }),
  };
}

/**
 * The structure as it may be stored for a lesson of `kind`, or why not:
 * "bad-input" for anything the editor can't produce (another kind, a wrong
 * type, a bad id), "too-large" for text or lists over STRUCTURE_LIMITS.
 */
export function sanitizeStructure(
  input: unknown,
  kind: StoredStructure["kind"]
): SanitizeStructureResult {
  try {
    const s = record(input);
    if (s.kind !== kind) throw new Refused("bad-input");
    const structure =
      kind === "simulation"
        ? simulation(s)
        : kind === "scenario"
          ? scenario(s)
          : assessment(s);
    if (JSON.stringify(structure).length > STRUCTURE_LIMITS.maxJsonChars) {
      throw new Refused("too-large");
    }
    return { ok: true, structure };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.reason };
    throw error;
  }
}

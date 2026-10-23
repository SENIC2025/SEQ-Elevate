/**
 * Release 3 (D37, D69, D79, D80): "Add it to my account". What the browser
 * sends — its guest work, once, as the guest store holds it — and what the
 * server answers, part by part.
 *
 * The server decides each part in one transaction (claimGuestWork in
 * src/app/actions/learner.ts), as the account is then:
 *
 *   - the course moves only into an account with no progress in it
 *     ("moved"); one that holds all of it already says so ("already"); any
 *     other keeps its own, and the browser keeps the guest's ("kept"); a
 *     course nobody can open any more isn't added ("unavailable");
 *   - the Comp Card moves only where the account has none, or a blank one
 *     not shared, and as "Only me" ("moved"); the same card is "already"
 *     there; a card with something of the account's own in it keeps it
 *     ("kept"), and a blank shared one gets nothing ("shared"): moving
 *     never shares;
 *   - badges are a union: each is in the account ("moved" or "already"),
 *     or can't be given there ("refused": no such badge, or under the
 *     player's kill switch a course not finished in the account).
 *
 * A text too long to add (a Comp Card answer over 2,000 characters, a
 * reflection answer over 5,000), or a claim too big for one save, means
 * nothing is written: the page offers the texts to be shortened. Never cut
 * (D80, D62.d).
 *
 * Pure and client-safe: the browser builds and checks the claim with it
 * (src/store/guest-migration.ts), and the server checks it again before
 * anything is written.
 */

import { isSectionId, type PartKey, type SectionId } from "@/lib/cms/sections/contract";
import { COMP_CARD_FIELDS, COMP_CARD_TEXT_MAX, type CompCardField } from "@/lib/comp-card-visibility";
import { RESPONSE_LIMITS, type PatchAnswer, type ProgressPatch } from "@/lib/learner-progress/contract";
import { readAnswer, type ParsedPatch } from "@/lib/learner-progress/parse";

/** A guest's Comp Card as the claim carries it: its texts and confidence, never who sees it. */
export interface GuestClaimCard {
  wentWell: string;
  difficult: string;
  improve: string;
  behaviour: string;
  confidence: number;
}

/** What "Add it to my account" sends: each part only when the guest store holds work in it. */
export interface GuestClaim {
  claim: 1;
  /** The guest's one course (D69), as a patch of everything in it (patchSince from nothing). */
  course?: { slug: string; patch: ProgressPatch };
  compCard?: GuestClaimCard;
  badges?: string[];
}

/** A text of the guest work: a Comp Card answer, or one reflection question's answer in the course. */
export type GuestText =
  | { part: "compCard"; field: CompCardField }
  | { part: "course"; key: string; prompt: string };

export type ClaimCourseOutcome = "moved" | "already" | "kept" | "unavailable";
export type ClaimCardOutcome = "moved" | "already" | "kept" | "shared";

/** A Comp Card's texts and confidence as the account holds them, and when it last changed. */
export interface ClaimedCard {
  wentWell: string;
  difficult: string;
  improve: string;
  behaviour: string;
  confidence: number;
  updatedAt: string | null;
}

/**
 * The server's answer. Answered, never thrown, when no try could change it,
 * so the browser doesn't send it again; a thrown error (no session, a
 * dropped connection) is tried again, and changes nothing twice.
 */
export type GuestClaimResult =
  | {
      ok: true;
      /** The course's part, when the claim had one. */
      course?: ClaimCourseOutcome;
      /** The Comp Card's part, when the claim had one. */
      compCard?: ClaimCardOutcome;
      /** The card as the account holds it, when the guest's is in it (moved or already). */
      card?: ClaimedCard;
      badges: { moved: string[]; already: string[]; refused: string[] };
      /** Every badge the account holds now. */
      accountBadges: string[];
    }
  | { ok: false; error: "other-account" | "profile-incomplete" | "bad-input" | "too-large" }
  | { ok: false; error: "too-long"; texts: GuestText[] };

/** The longest a reflection answer and a Comp Card answer may be, and the most a claim may hold. */
export const CLAIM_LIMITS = {
  reflectionChars: RESPONSE_LIMITS.reflectionChars,
  cardChars: COMP_CARD_TEXT_MAX,
  /** The claim's JSON, as one save's (D62): well within a server action's 1 MB, Greek text included. */
  jsonChars: RESPONSE_LIMITS.patchJsonChars,
  badges: 100,
  badgeChars: 100,
} as const;

/** The limit of a text of the guest work. */
export const maxOf = (text: GuestText) => (text.part === "compCard" ? CLAIM_LIMITS.cardChars : CLAIM_LIMITS.reflectionChars);

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const written = (v: unknown) => typeof v === "string" && v.trim() !== "";
const isConfidence = (v: unknown): v is 1 | 2 | 3 | 4 | 5 => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5;

/** The claim, checked: what the server writes from. */
export interface ParsedClaim {
  course: { slug: string; patch: ParsedPatch } | null;
  compCard: (Record<CompCardField, string> & { confidence: 1 | 2 | 3 | 4 | 5 }) | null;
  badges: string[];
  /** Answers and lessons in the course no one can read (a damaged or hand-edited store): not added, counted. */
  unreadable: number;
}

export type ParseClaimResult =
  | { ok: true; claim: ParsedClaim }
  | { ok: false; error: "bad-input" | "too-large" }
  | { ok: false; error: "too-long"; texts: GuestText[] };

const CLAIM_FIELDS = ["claim", "course", "compCard", "badges"];
const PATCH_FIELDS = ["v", "completed", "answers", "completedAt"];
/** A completion time further ahead than this is the client's clock, not the learner (as parse.ts). */
const FUTURE_SLACK_MS = 5 * 60 * 1000;

/** The JSON's length, or null when it can't be written as JSON. */
function jsonLength(v: unknown): number | null {
  try {
    return JSON.stringify(v)?.length ?? null;
  } catch {
    return null;
  }
}

/**
 * The texts of a claim over their limit, in order: the course's reflection
 * answers, then the Comp Card's. The browser shows them to be shortened;
 * the server writes nothing while there are any.
 */
export function tooLongIn(claim: unknown): GuestText[] {
  const out: GuestText[] = [];
  if (!isRecord(claim)) return out;
  const course = claim.course;
  const answers = isRecord(course) && isRecord(course.patch) && isRecord(course.patch.answers) ? course.patch.answers : {};
  for (const [key, answer] of Object.entries(answers)) {
    if (!isRecord(answer) || answer.type !== "reflection" || !isRecord(answer.text)) continue;
    for (const [prompt, text] of Object.entries(answer.text)) {
      if (typeof text === "string" && text.length > CLAIM_LIMITS.reflectionChars) out.push({ part: "course", key, prompt });
    }
  }
  const card = claim.compCard;
  if (isRecord(card)) {
    for (const field of COMP_CARD_FIELDS) {
      const text = card[field];
      if (typeof text === "string" && text.length > CLAIM_LIMITS.cardChars) out.push({ part: "compCard", field });
    }
  }
  return out;
}

/**
 * The course's part: a patch of the guest's progress, read as a stored
 * answer is (readAnswer: no limits on how many questions, since one claim
 * carries a whole course, bounded by the claim's size). What can't be read
 * is left out and counted.
 */
function parseCoursePatch(raw: unknown, now: Date): { patch: ParsedPatch; unreadable: number } | null {
  if (!isRecord(raw) || raw.v !== 2 || Object.keys(raw).some((f) => !PATCH_FIELDS.includes(f))) return null;
  const { completed, answers, completedAt } = raw;
  if (completed !== undefined && !(Array.isArray(completed) && completed.every((c) => typeof c === "string"))) return null;
  if (answers !== undefined && !isRecord(answers)) return null;
  if (completedAt !== undefined && typeof completedAt !== "string") return null;
  let unreadable = 0;
  const done: SectionId[] = [];
  for (const id of (completed as string[] | undefined) ?? []) {
    if (!isSectionId(id)) unreadable++;
    else if (!done.includes(id)) done.push(id);
  }
  const taken: [PartKey, PatchAnswer][] = [];
  for (const [key, value] of Object.entries((answers as Rec | undefined) ?? {})) {
    const answer = readAnswer(key, value);
    if (answer) taken.push([key as PartKey, answer]);
    else unreadable++;
  }
  let at: Date | null = null;
  if (typeof completedAt === "string") {
    const t = Date.parse(completedAt);
    at = Number.isFinite(t) && t <= now.getTime() + FUTURE_SLACK_MS ? new Date(t) : now;
  }
  return { patch: { completed: done, answers: taken, completedAt: at, fill: false, refused: [] }, unreadable };
}

/**
 * Too big to add (the server answers "too-large", parseGuestClaim): the
 * browser says so before sending it, so a claim past a server action's
 * 1 MB body is never sent to be turned away unanswered.
 */
export const claimTooLarge = (claim: unknown): boolean => (jsonLength(claim) ?? Infinity) > CLAIM_LIMITS.jsonChars;

/** A claim from the browser, checked (`now` is the server's time). */
export function parseGuestClaim(raw: unknown, now: Date): ParseClaimResult {
  const bad = { ok: false as const, error: "bad-input" as const };
  if (!isRecord(raw) || raw.claim !== 1 || Object.keys(raw).some((f) => !CLAIM_FIELDS.includes(f))) return bad;
  const length = jsonLength(raw);
  if (length === null) return bad;

  let course: ParsedClaim["course"] = null;
  let unreadable = 0;
  if (raw.course !== undefined) {
    const c = raw.course;
    if (!isRecord(c) || typeof c.slug !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(c.slug)) return bad;
    const parsed = parseCoursePatch(c.patch, now);
    if (!parsed) return bad;
    course = { slug: c.slug, patch: parsed.patch };
    unreadable = parsed.unreadable;
  }

  let compCard: ParsedClaim["compCard"] = null;
  if (raw.compCard !== undefined) {
    const c = raw.compCard;
    if (!isRecord(c) || !isConfidence(c.confidence)) return bad;
    const texts = {} as Record<CompCardField, string>;
    for (const field of COMP_CARD_FIELDS) {
      const text = c[field] ?? "";
      if (typeof text !== "string") return bad;
      texts[field] = text;
    }
    // A card with no answer in it isn't work: nothing to add.
    if (COMP_CARD_FIELDS.some((f) => written(texts[f]))) compCard = { ...texts, confidence: c.confidence };
  }

  const badges: string[] = [];
  if (raw.badges !== undefined) {
    if (!Array.isArray(raw.badges) || raw.badges.length > CLAIM_LIMITS.badges) return bad;
    for (const slug of raw.badges) {
      if (typeof slug !== "string" || !slug || slug.length > CLAIM_LIMITS.badgeChars) return bad;
      if (!badges.includes(slug)) badges.push(slug);
    }
  }

  if (length > CLAIM_LIMITS.jsonChars) return { ok: false, error: "too-large" };
  const texts = tooLongIn(raw);
  if (texts.length) return { ok: false, error: "too-long", texts };
  return { ok: true, claim: { course, compCard, badges, unreadable } };
}

/** The same text of the guest work? */
export const sameText = (a: GuestText, b: GuestText) =>
  a.part === "compCard"
    ? b.part === "compCard" && a.field === b.field
    : b.part === "course" && a.key === b.key && a.prompt === b.prompt;

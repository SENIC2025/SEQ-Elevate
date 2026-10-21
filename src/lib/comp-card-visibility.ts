/**
 * Release 3 (D80, D81, spec 4.2): who may read a learner's Comp Card, and
 * what a save may write.
 *
 * A card is shared only when all three hold: privacy is FACILITATOR,
 * sharedAt is set (only the sharing action writes it), and it was shared
 * with the organisation the learner belongs to now. Anything else, an
 * unknown privacy value included, is "Only me". So a card's privacy written
 * by anything else, or a card shared with an organisation the learner has
 * since left, shares nothing.
 *
 * A shared card is read by the facilitators and partner admins of that
 * organisation, and by an ADMIN only when the ADMIN's own profile belongs to
 * it: "Me and the facilitators at ‹organisation›" stays literally true. No
 * card, an unshared card and a card shared elsewhere all read as null.
 *
 * Pure (type-only imports), so it can be tested without a database.
 */

import type { Role } from "@prisma/client";
import { canSupportLearners } from "@/lib/permissions";
import type { Scope } from "@/lib/scope";

/** The longest a Comp Card text field may grow, in characters (D80). */
export const COMP_CARD_TEXT_MAX = 2000;

/** The version of the sharing wording (compCard.sharing.*); bumped when it changes. */
export const SHARING_TEXT_VERSION = "2026-11-20";

export type Sharing = "onlyMe" | "facilitators";
export type CompCardField = "wentWell" | "difficult" | "improve" | "behaviour";
export const COMP_CARD_FIELDS: readonly CompCardField[] = ["wentWell", "difficult", "improve", "behaviour"];

/** What sharing reads of a stored card. */
export interface CardSharing {
  privacy: string;
  sharedAt: Date | null;
  sharedWithOrganisationId: string | null;
}

/** A stored card, as far as reading it goes. */
export interface CardRow extends CardSharing, Record<CompCardField, string> {
  confidence: number;
}

/** "facilitators" only when all three hold; anything else is "onlyMe". */
export function effectiveSharing(card: CardSharing, learnerOrganisationId: string | null): Sharing {
  return card.privacy === "FACILITATOR" &&
    card.sharedAt !== null &&
    card.sharedAt !== undefined &&
    !!card.sharedWithOrganisationId &&
    card.sharedWithOrganisationId === learnerOrganisationId
    ? "facilitators"
    : "onlyMe";
}

/** What a viewer may read of a card shared with them. */
export interface SharedCompCard {
  /** The non-empty fields, minus fields the template hides. */
  fields: Partial<Record<CompCardField, string>>;
  /** Null when stored outside 1..5. */
  confidence: 1 | 2 | 3 | 4 | 5 | null;
  sharedAt: string;
}

/** A Comp Card template field a viewer may be kept from: a text field or the confidence. */
export type HideableField = CompCardField | "confidence";
const HIDEABLE: readonly HideableField[] = [...COMP_CARD_FIELDS, "confidence"];

/**
 * The fields the Comp Card template (Project.compCardTemplate, per language)
 * hides in ANY language: a learner using that language never saw the field,
 * so it is left out of a shared card whatever language they used (fails
 * closed). Untrusted JSON: anything but a known key is ignored.
 */
export function hiddenInAnyLanguage(template: unknown): Set<HideableField> {
  const hidden = new Set<HideableField>();
  if (!template || typeof template !== "object" || Array.isArray(template)) return hidden;
  for (const copy of Object.values(template as Record<string, unknown>)) {
    const keys = (copy as { hidden?: unknown } | null)?.hidden;
    if (!Array.isArray(keys)) continue;
    for (const key of keys) if (HIDEABLE.includes(key as HideableField)) hidden.add(key as HideableField);
  }
  return hidden;
}

/** The organisation a viewer reads shared cards for: their own, or none. */
export function viewerOrganisation(scope: Scope): string | null {
  if (scope.kind === "organisation") return scope.organisationId;
  if (scope.kind === "project") return scope.viewerOrganisationId;
  return null;
}

const isConfidence = (value: unknown): value is 1 | 2 | 3 | 4 | 5 =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;

/**
 * The card as this viewer may see it, or null ("nothing shared with you").
 * Visible only when the card is shared (effectiveSharing), the viewer
 * supports learners, and the viewer's organisation is the one it was shared
 * with. `hiddenFields`: fields the Comp Card template hides in any language,
 * which the learner may never have seen (hiddenInAnyLanguage); a hidden
 * confidence reads as null.
 */
export function compCardForViewer(
  card: CardRow | null,
  learnerOrganisationId: string | null,
  viewer: { scope: Scope; roles: readonly Role[] },
  hiddenFields: ReadonlySet<HideableField>
): SharedCompCard | null {
  if (!card || !card.sharedAt) return null;
  if (effectiveSharing(card, learnerOrganisationId) !== "facilitators") return null;
  if (!canSupportLearners(viewer.roles)) return null;
  const organisation = viewerOrganisation(viewer.scope);
  if (!organisation || organisation !== card.sharedWithOrganisationId) return null;

  const fields: Partial<Record<CompCardField, string>> = {};
  for (const field of COMP_CARD_FIELDS) {
    const text = card[field];
    if (!hiddenFields.has(field) && typeof text === "string" && text.trim()) fields[field] = text;
  }
  return {
    fields,
    confidence: !hiddenFields.has("confidence") && isConfidence(card.confidence) ? card.confidence : null,
    sharedAt: card.sharedAt.toISOString(),
  };
}

export type ParsedCompCardInput =
  | { ok: true; value: Partial<Record<CompCardField, string>> & { confidence?: 1 | 2 | 3 | 4 | 5 } }
  | { ok: false; error: "bad-input" | "too-long"; field?: CompCardField };

/**
 * What a Comp Card save may write: only the fields it sends. Every text field
 * and the confidence are optional; an omitted one keeps its stored value. A
 * text over COMP_CARD_TEXT_MAX is refused only if it is longer than the
 * stored text (growth only), and then the whole save is refused with that
 * field named. Any privacy or other key is ignored: sharing changes only
 * through its own action.
 */
export function parseCompCardInput(
  input: unknown,
  stored: Partial<Record<CompCardField, string>> | null
): ParsedCompCardInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "bad-input" };
  const raw = input as Record<string, unknown>;
  const value: Partial<Record<CompCardField, string>> & { confidence?: 1 | 2 | 3 | 4 | 5 } = {};
  for (const field of COMP_CARD_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, field) || raw[field] === undefined) continue;
    const text = raw[field];
    if (typeof text !== "string") return { ok: false, error: "bad-input", field };
    if (text.length > COMP_CARD_TEXT_MAX && text.length > (stored?.[field]?.length ?? 0)) {
      return { ok: false, error: "too-long", field };
    }
    value[field] = text;
  }
  if (Object.prototype.hasOwnProperty.call(raw, "confidence") && raw.confidence !== undefined) {
    if (!isConfidence(raw.confidence)) return { ok: false, error: "bad-input" };
    value.confidence = raw.confidence;
  }
  return { ok: true, value };
}

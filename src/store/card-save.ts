/**
 * The Comp Card's saves, as the learner store sends them (D80, spec 4.3).
 *
 * A page keeps what the server is known to hold of the card's texts and
 * confidence (`SavedCard`): what loaded, what "Add it to my account"
 * answered, moved on by every save the server confirmed. A save sends only
 * the fields the learner changed on this page from that (cardChanges),
 * worked out when it is SENT: the server writes only the fields it gets
 * (saveCompCard), so a page that loaded the card before another tab or
 * device changed it — the guest's card added to the account in another
 * tab, say — never writes its older copy of a field it didn't change. A
 * field whose save wasn't confirmed (a dropped connection: it may have
 * been written) isn't known any more, and goes with the next save; a field
 * the server refused keeps what it was known to hold.
 *
 * Another tab may change the card under a page (the guest's card added to
 * the account): the page then reads the account's card again, and keeps
 * only what it changed itself and the server hasn't confirmed yet
 * (cardAfterReread).
 *
 * No React: DemoStateProvider in demo-state.tsx applies it.
 */

import type { CompCardInput } from "@/app/actions/learner";
import { COMP_CARD_FIELDS, type CompCardField } from "@/lib/comp-card-visibility";
import type { CompCardData } from "./demo-state";
import { cardToSave } from "./guest-migration";

/** A field of the card a save may send. */
export type SavedCardField = CompCardField | "confidence";
const SAVED_FIELDS: readonly SavedCardField[] = [...COMP_CARD_FIELDS, "confidence"];

/** What the server is known to hold of the card; a field left out isn't known. */
export type SavedCard = Partial<Record<CompCardField, string>> & { confidence?: number };

/** The card's texts and confidence as the server holds them; no card: a blank one's (`blank`). */
export function savedCardOf(
  card: Pick<CompCardData, SavedCardField> | null | undefined,
  blank: Pick<CompCardData, SavedCardField>
): SavedCard {
  const from = card ?? blank;
  return {
    wentWell: from.wentWell,
    difficult: from.difficult,
    improve: from.improve,
    behaviour: from.behaviour,
    confidence: from.confidence,
  };
}

/** What a save of `card` sends: what cardToSave would, less what the server is known to hold. */
export function cardChanges(card: CompCardData, saved: SavedCard): CompCardInput {
  const all = cardToSave(card);
  const input: CompCardInput = {};
  for (const field of SAVED_FIELDS) {
    if (all[field] === undefined || all[field] === saved[field]) continue;
    (input as Record<string, unknown>)[field] = all[field];
  }
  return input;
}

/**
 * What the server is known to hold once a save of `sent` was answered:
 * confirmed, the fields sent; refused, as before; failed (thrown: it may
 * have been written), the fields sent are no longer known.
 */
export function afterCardSave(saved: SavedCard, sent: CompCardInput, answer: "ok" | "refused" | "failed"): SavedCard {
  if (answer === "refused") return saved;
  const next: SavedCard = { ...saved };
  for (const field of SAVED_FIELDS) {
    if (sent[field] === undefined) continue;
    if (answer === "ok") (next as Record<string, unknown>)[field] = sent[field];
    else delete next[field];
  }
  return next;
}

/**
 * The card on a page once the account's card was read again (`server`; null:
 * none): what the server holds, but a field the learner changed here that
 * the server isn't known to hold (`saved`) stays as it is here. Who sees it
 * is the server's.
 */
export function cardAfterReread(
  local: CompCardData,
  saved: SavedCard,
  server: CompCardData | null,
  blank: CompCardData
): CompCardData {
  const from = server ?? blank;
  const card: CompCardData = {
    ...from,
    sharing: from.sharing === "facilitators" ? "facilitators" : "onlyMe",
    sharedAt: from.sharing === "facilitators" ? (from.sharedAt ?? null) : null,
    organisationName: from.sharing === "facilitators" ? (from.organisationName ?? null) : null,
    updatedAt: from.updatedAt ?? local.updatedAt,
  };
  let edited = false;
  for (const field of SAVED_FIELDS) {
    if (local[field] === saved[field]) continue;
    (card as unknown as Record<string, unknown>)[field] = local[field];
    edited = true;
  }
  return edited ? { ...card, updatedAt: local.updatedAt } : card;
}

/** The guest store's card or badges changed (or it went): the account's card may have changed with it. */
export function guestCardOrBadgesChanged(before: string | null, after: string | null): boolean {
  if (before === after) return false;
  if (before === null || after === null) return true;
  try {
    const was = JSON.parse(before) as Record<string, unknown> | null;
    const is = JSON.parse(after) as Record<string, unknown> | null;
    if (!was || typeof was !== "object" || !is || typeof is !== "object") return true;
    return JSON.stringify(was.compCard) !== JSON.stringify(is.compCard) || JSON.stringify(was.badges) !== JSON.stringify(is.badges);
  } catch {
    return true;
  }
}

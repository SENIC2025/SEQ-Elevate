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
 * the server refused keeps what it was known to hold. When something is
 * still left once a save is confirmed — an answer changed back while that
 * save was on its way, whose own save found nothing to send — another is
 * scheduled (saveCard), as a course's is (course-save.ts); so it is when a
 * save fails once the page has changed since it was sent, as a newer save
 * may have been worked out while what it sent was still known.
 *
 * Another tab may change the card under a page (the guest's card added to
 * the account): the page then reads the account's card again, and keeps
 * only what it changed itself and the server hasn't confirmed yet
 * (cardAfterReread).
 *
 * Next sends a page's server actions one at a time: a card save handed
 * over while another is on its way waits behind it, and one waiting never
 * leaves a page that goes. So when the page is left (pagehide), while a
 * save of the card is on its way or failed, the fields it has that the
 * server hasn't confirmed — every field a save on its way carries counted
 * as not confirmed — are sent outside that queue too, with
 * fetch(keepalive), which the browser finishes after the page has gone
 * (cardBeacon; POST /api/progress/beacon, D37 as built). The route saves
 * them through the card's save action, so a save that also arrives through
 * the queue writes the same values.
 *
 * Before the profile step is done (D79) the save action refuses
 * ("profile-incomplete"): a page loaded before the Terms changed, say.
 * The page then says so (`profileIncomplete`), and keeps the card on screen.
 *
 * No React: DemoStateProvider in demo-state.tsx applies it.
 */

import type { CompCardInput, SaveCompCardResult } from "@/app/actions/learner";
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

/** What a page keeps for its Comp Card saves: what the server is known to hold, and for whom; null once let go of. */
export interface CardSavedRef {
  current: { forUser: string; card: SavedCard } | null;
}

/** A card save sent and not answered yet, as sent, and for whom. */
export interface CardSending {
  forUser: string;
  input: CompCardInput;
}

/** The page's card saves on their way: replaced whole once the page lets go of the learner. */
export interface CardSendingRef {
  current: CardSending[];
}

export interface CardSaveDeps {
  /** saveCompCard. */
  send(input: CompCardInput, forUser: string): Promise<SaveCompCardResult>;
  /** The card as the page has it now: the last one handed to the saves. */
  latest(): CompCardData | null;
  /** Something is left to send: schedule another save, of the card as it is then. */
  again(): void;
  /** The saves on their way, kept for the page's keepalive request as it goes (cardBeacon). */
  sending?: CardSendingRef;
  /** The save was refused because the profile step isn't done (D79): the page says so. */
  profileIncomplete?(): void;
}

/**
 * Sends what the learner changed on `card` from what the server is known
 * to hold (`saved`), for `forUser`, and moves that on by the answer
 * (afterCardSave). Once a save is confirmed, a card that still differs
 * from what the server is now known to hold gets another (`again`): an
 * answer changed and changed back while the first save was on its way had
 * nothing to send then, the server being known to hold it, and holds the
 * change once that save is confirmed. Not after a refusal: the same save
 * would be refused again.
 *
 * A thrown error is thrown on, so the save is tried again (pending-save.ts)
 * — unless a newer one has been scheduled since, which may already have
 * been worked out while the server was still known to hold what this one
 * sent, and found nothing to send (an answer changed back). So once the
 * page has changed since `card`, a card that differs from what the server
 * is now known to hold gets another save (`again`), which a failure tries
 * again as any (1 s, 2 s, 4 s, 8 s); the page as `card` is tries this one.
 */
export async function saveCard(card: CompCardData, forUser: string, saved: CardSavedRef, deps: CardSaveDeps): Promise<void> {
  const known = saved.current;
  if (known?.forUser !== forUser) return;
  const input = cardChanges(card, known.card);
  if (Object.keys(input).length === 0) return;
  const answered = (answer: "ok" | "refused" | "failed") => {
    const now = saved.current;
    if (now?.forUser === forUser) saved.current = { forUser, card: afterCardSave(now.card, input, answer) };
  };
  /** Another save, if the page (`latest`) differs from what the server is now known to hold. */
  const againIfLeft = (latest: CompCardData | null) => {
    const now = saved.current;
    if (now?.forUser === forUser && latest && Object.keys(cardChanges(latest, now.card)).length > 0) deps.again();
  };
  // On its way until answered: the page's keepalive request carries what
  // it carries as the page has it (cardBeacon).
  const onItsWay: CardSending = { forUser, input };
  const sending = deps.sending?.current;
  sending?.push(onItsWay);
  const sent = () => {
    const at = sending?.indexOf(onItsWay) ?? -1;
    if (at >= 0) sending?.splice(at, 1);
  };
  let result: SaveCompCardResult;
  try {
    result = await deps.send(input, forUser);
  } catch (err) {
    sent();
    answered("failed");
    const latest = deps.latest();
    if (latest !== card) againIfLeft(latest);
    throw err;
  }
  sent();
  answered(result.ok ? "ok" : "refused");
  if (result.ok) againIfLeft(deps.latest());
  else if (result.error === "profile-incomplete" && saved.current?.forUser === forUser) deps.profileIncomplete?.();
}

/**
 * The page is being left (pagehide), its waiting card save just sent
 * (pending-save.ts flush). While a save of the card for `forUser` is on
 * its way — on the wire, or waiting behind another in Next's queue, never
 * to leave a page that goes — or one failed (a field the server isn't
 * known to hold): the fields of `card` (the page's, as the saves have it)
 * that the server isn't known to hold, and every field a save on its way
 * carries, as the page has it — what a save sends of them (cardToSave:
 * never who sees the card, never a text over the limit). Never a field
 * the page didn't change: another tab's or device's change of it stays.
 * The fields of POST /api/progress/beacon's card body, sent with
 * fetch(keepalive): the browser finishes it after the page has gone, and
 * the route saves it through the card's save action, so a save that also
 * arrives through the queue writes the same values (D37 as built). Null
 * when there's no such save, or nothing to send.
 */
export function cardBeacon(
  card: CompCardData | null,
  forUser: string,
  saved: CardSavedRef,
  sending: readonly CardSending[]
): CompCardInput | null {
  const known = saved.current;
  if (!card || known?.forUser !== forUser) return null;
  const onTheirWay = sending.filter((s) => s.forUser === forUser);
  const failed = SAVED_FIELDS.some((field) => known.card[field] === undefined);
  if (!onTheirWay.length && !failed) return null;
  const carried = new Set(SAVED_FIELDS.filter((field) => onTheirWay.some((s) => s.input[field] !== undefined)));
  const all = cardToSave(card);
  const input: CompCardInput = {};
  for (const field of SAVED_FIELDS) {
    if (all[field] === undefined) continue;
    if (carried.has(field) || all[field] !== known.card[field]) (input as Record<string, unknown>)[field] = all[field];
  }
  return Object.keys(input).length ? input : null;
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

/**
 * The facilitator workspace's Save: a note about the learner, then a
 * validation of their competence, as two writes (saveObservation,
 * recordValidation in src/app/actions/facilitator.ts).
 *
 * Each note sent is a new Observation row, so a Save tried again after the
 * validation failed must not send the note a second time: it would show up
 * twice on the learner's record. What got through is remembered (`done`),
 * and the next Save sends only the rest. A write the server refused (the
 * person isn't a learner of the project any more) and one that failed on
 * the way (a dropped connection) are told apart, so the facilitator is
 * told the right reason.
 *
 * No React: RealFacilitatorView applies it.
 */

/** Which of the two writes the server has. */
export interface FacilitatorSaved {
  note: boolean;
  validation: boolean;
}

export const NOTHING_SAVED: FacilitatorSaved = { note: false, validation: false };

/** Why a Save didn't get everything through; null when it did. */
export type FacilitatorSaveFailure = "refused" | "error" | null;

export interface FacilitatorWrites {
  saveObservation(note: string): Promise<{ ok: boolean }>;
  /** The note goes with the validation as its evidence. */
  recordValidation(evidence: string): Promise<{ ok: boolean }>;
}

/**
 * Sends what of `note` and the validation (when `validate`) isn't in
 * `done` yet, in that order, stopping at the first that fails. Never
 * rejects: a thrown write is a failure "error".
 */
export async function saveFacilitatorEntry(
  {
    note,
    validate,
    done,
  }: { note: string; validate: boolean; done: FacilitatorSaved },
  writes: FacilitatorWrites
): Promise<{ done: FacilitatorSaved; failure: FacilitatorSaveFailure }> {
  const saved = { ...done };
  const send = async (
    write: () => Promise<{ ok: boolean }>
  ): Promise<FacilitatorSaveFailure> => {
    try {
      return (await write()).ok ? null : "refused";
    } catch {
      return "error";
    }
  };

  if (note.trim() && !saved.note) {
    const failure = await send(() => writes.saveObservation(note));
    if (failure) return { done: saved, failure };
    saved.note = true;
  }
  if (validate && !saved.validation) {
    const failure = await send(() => writes.recordValidation(note));
    if (failure) return { done: saved, failure };
    saved.validation = true;
  }
  return { done: saved, failure: null };
}

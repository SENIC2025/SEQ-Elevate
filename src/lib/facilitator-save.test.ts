import { describe, it, expect, vi } from "vitest";
import { saveFacilitatorEntry, NOTHING_SAVED } from "./facilitator-save";

// The facilitator's Save sends a note, then a validation. The note is a new
// row each time it's sent, so a retry after a failed validation must not
// send it again; and a refusal and a failure on the way read differently.
const ok = async () => ({ ok: true });
const refused = async () => ({ ok: false });
const broken = async (): Promise<{ ok: boolean }> => {
  throw new Error("network down");
};

describe("saveFacilitatorEntry", () => {
  it("sends the note and the validation, and reports both saved", async () => {
    const writes = { saveObservation: vi.fn(ok), recordValidation: vi.fn(ok) };
    const result = await saveFacilitatorEntry(
      { note: "Listened well", validate: true, done: NOTHING_SAVED },
      writes
    );
    expect(result).toEqual({
      done: { note: true, validation: true },
      failure: null,
    });
    expect(writes.saveObservation).toHaveBeenCalledWith("Listened well");
    expect(writes.recordValidation).toHaveBeenCalledWith("Listened well");
  });

  it("keeps the note as saved when the validation after it fails, and a retry sends only the validation", async () => {
    const writes = {
      saveObservation: vi.fn(ok),
      recordValidation: vi.fn(broken),
    };
    const first = await saveFacilitatorEntry(
      { note: "Listened well", validate: true, done: NOTHING_SAVED },
      writes
    );
    expect(first).toEqual({
      done: { note: true, validation: false },
      failure: "error",
    });

    writes.recordValidation.mockImplementation(ok);
    const retry = await saveFacilitatorEntry(
      { note: "Listened well", validate: true, done: first.done },
      writes
    );
    expect(retry).toEqual({
      done: { note: true, validation: true },
      failure: null,
    });
    expect(writes.saveObservation).toHaveBeenCalledTimes(1);
    expect(writes.recordValidation).toHaveBeenCalledTimes(2);
  });

  it("tells a refusal from a failure on the way", async () => {
    const refusedResult = await saveFacilitatorEntry(
      { note: "Listened well", validate: false, done: NOTHING_SAVED },
      { saveObservation: refused, recordValidation: ok }
    );
    expect(refusedResult.failure).toBe("refused");

    const brokenResult = await saveFacilitatorEntry(
      { note: "Listened well", validate: false, done: NOTHING_SAVED },
      { saveObservation: broken, recordValidation: ok }
    );
    expect(brokenResult.failure).toBe("error");
  });

  it("doesn't try the validation when the note before it failed", async () => {
    const writes = { saveObservation: vi.fn(refused), recordValidation: vi.fn(ok) };
    const result = await saveFacilitatorEntry(
      { note: "Listened well", validate: true, done: NOTHING_SAVED },
      writes
    );
    expect(result.done).toEqual(NOTHING_SAVED);
    expect(writes.recordValidation).not.toHaveBeenCalled();
  });

  it("sends nothing again when everything is already saved, or there's no note", async () => {
    const writes = { saveObservation: vi.fn(ok), recordValidation: vi.fn(ok) };
    await expect(
      saveFacilitatorEntry(
        { note: "Listened well", validate: true, done: { note: true, validation: true } },
        writes
      )
    ).resolves.toEqual({ done: { note: true, validation: true }, failure: null });
    await saveFacilitatorEntry(
      { note: "   ", validate: false, done: NOTHING_SAVED },
      writes
    );
    expect(writes.saveObservation).not.toHaveBeenCalled();
    expect(writes.recordValidation).not.toHaveBeenCalled();
  });
});

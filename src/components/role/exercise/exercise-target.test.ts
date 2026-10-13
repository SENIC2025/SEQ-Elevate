import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExerciseState, StoredPart, StoredReflection } from "@/lib/cms/sections/contract";
import { emptyExercise } from "@/lib/cms/sections/part-kinds";
import { partVersions } from "@/lib/cms/sections/versions";
import type { StoredScenario } from "@/lib/cms/structure";

const structure = vi.hoisted(() => ({
  getStructure: vi.fn(),
  saveStructure: vi.fn(),
  saveStructureDraft: vi.fn(),
  discardStructureDraft: vi.fn(),
  clearStructure: vi.fn(),
}));
const parts = vi.hoisted(() => ({
  getPart: vi.fn(),
  savePart: vi.fn(),
  savePartDraft: vi.fn(),
  discardPartDraft: vi.fn(),
}));
vi.mock("@/app/actions/structure", () => structure);
vi.mock("@/app/actions/parts", () => parts);

import {
  lessonTarget,
  partBase,
  partTarget,
  toDoneResult,
  toDraftResult,
  toSaveResult,
} from "./exercise-target";

const reflection: StoredReflection = {
  kind: "reflection",
  title: { en: "Look back" },
  prompts: [{ id: "p1", label: { en: "What went well?" } }],
};
const draft: StoredReflection = { ...reflection, title: { en: "Look back, again" } };

beforeEach(() => {
  for (const fn of [...Object.values(structure), ...Object.values(parts)]) fn.mockReset();
});

describe("partBase", () => {
  it("fingerprints what the editor loaded exactly as the server fingerprints the stored part", () => {
    const stored: StoredPart = { id: "p-abcdefgh", type: "reflection", data: reflection, draft };
    // Key order and absent fields don't matter (stored JSON comes back reordered).
    const loaded: ExerciseState = {
      structure: JSON.parse(JSON.stringify({ prompts: reflection.prompts, title: reflection.title, kind: "reflection" })),
      draft,
    };
    expect(partBase(loaded)).toEqual(partVersions(stored));
  });

  it("is null for what isn't there", () => {
    expect(partBase({ structure: null, draft: null })).toEqual({ data: null, draft: null });
    expect(partBase({ structure: null, draft })).toEqual({
      data: null,
      draft: partVersions({ id: "p-abcdefgh", type: "reflection", data: null, draft }).draft,
    });
  });

  it("is short: never the stored JSON", () => {
    const base = partBase({ structure: reflection, draft });
    expect(base.data!.length).toBeLessThanOrEqual(32);
    expect(base.draft!.length).toBeLessThanOrEqual(32);
  });
});

describe("partTarget", () => {
  const target = partTarget("my-course", "s-abcdefgh", "p-abcdefgh", "reflection");

  it("is a question of its type's kind in the lesson's extra content", () => {
    expect(target.kind).toBe("reflection");
    expect(target.scope).toBe("part");
    expect(target.clear).toBeUndefined();
    expect(target.key).toBe("my-course:s-abcdefgh:p-abcdefgh");
    expect(partTarget("my-course", "concept", "p-abcdefgh", "quiz").kind).toBe("assessment");
    expect(partTarget("my-course", "concept", "p-abcdefgh", "practice").kind).toBe("simulation");
  });

  it("loads through getPart", async () => {
    parts.getPart.mockResolvedValue({ structure: reflection, draft: null });
    expect(await target.load()).toEqual({ structure: reflection, draft: null });
    expect(parts.getPart).toHaveBeenCalledWith("my-course", "s-abcdefgh", "p-abcdefgh");
  });

  it("saves with fingerprint bases, and reads the stored value back as the new base", async () => {
    parts.savePart.mockResolvedValue({ ok: true, structure: reflection });
    const base = { structure: null, draft };
    expect(await target.save(reflection, base)).toEqual({ ok: true, value: reflection });
    expect(parts.savePart).toHaveBeenCalledWith(
      "my-course",
      "s-abcdefgh",
      "p-abcdefgh",
      reflection,
      partBase(base)
    );
  });

  it("passes the reasons a save was refused through to the editor", async () => {
    const issues = [{ code: "reflectionPromptText", params: { prompt: 1 } }];
    parts.savePart.mockResolvedValueOnce({ ok: false, error: "invalid", issues });
    expect(await target.save(reflection, { structure: null, draft: null })).toEqual({
      ok: false,
      error: "invalid",
      issues,
    });
    const at = { limit: "text", field: "partTitle", locale: "en", max: 200 };
    parts.savePart.mockResolvedValueOnce({ ok: false, error: "too-large", at });
    expect(await target.save(reflection, { structure: null, draft: null })).toEqual({
      ok: false,
      error: "too-large",
      at,
    });
    parts.savePart.mockResolvedValueOnce({ ok: false, error: "changed-elsewhere" });
    expect(await target.save(reflection, { structure: null, draft: null })).toEqual({
      ok: false,
      error: "changed-elsewhere",
    });
    parts.savePart.mockResolvedValueOnce({ ok: false, error: "unknown-part" });
    expect(await target.save(reflection, { structure: null, draft: null })).toEqual({
      ok: false,
      error: "unknown-part",
    });
  });

  it("saves and discards drafts with the same bases", async () => {
    parts.savePartDraft.mockResolvedValue({ ok: true, draft, issues: [] });
    const base = { structure: reflection, draft: null };
    expect(await target.saveDraft(draft, base)).toEqual({ ok: true, draft });
    expect(parts.savePartDraft).toHaveBeenCalledWith(
      "my-course",
      "s-abcdefgh",
      "p-abcdefgh",
      draft,
      partBase(base)
    );
    parts.discardPartDraft.mockResolvedValue({ ok: true });
    expect(await target.discardDraft({ structure: reflection, draft })).toEqual({ ok: true });
    expect(parts.discardPartDraft).toHaveBeenCalledWith(
      "my-course",
      "s-abcdefgh",
      "p-abcdefgh",
      partBase({ structure: reflection, draft })
    );
  });
});

describe("lessonTarget", () => {
  const scenario = emptyExercise("scenario") as StoredScenario;

  it("is Release 0's main content: whole-JSON bases, as before", async () => {
    const target = lessonTarget("my-course", "scenario", "scenario");
    expect(target.scope).toBe("main");
    expect(target.kind).toBe("scenario");
    const base = { structure: scenario, draft: null };
    structure.saveStructure.mockResolvedValue({ ok: true, structure: scenario });
    expect(await target.save(scenario, base)).toEqual({ ok: true, value: scenario });
    expect(structure.saveStructure).toHaveBeenCalledWith("my-course", "scenario", scenario, base);
    structure.clearStructure.mockResolvedValue({ ok: false, error: "has-learners", count: 4 });
    expect(await target.clear!(base)).toEqual({ ok: false, error: "has-learners", count: 4 });
    expect(structure.clearStructure).toHaveBeenCalledWith("my-course", "scenario", base);
  });

  it("edits a lesson of the course's own by its id", async () => {
    const target = lessonTarget("my-course", "s-abcdefgh", "assessment");
    structure.getStructure.mockResolvedValue({ structure: null, draft: null });
    await target.load();
    expect(structure.getStructure).toHaveBeenCalledWith("my-course", "s-abcdefgh");
    structure.saveStructureDraft.mockResolvedValue({ ok: false, error: "not-a-section" });
    expect(await target.saveDraft(scenario, { structure: null, draft: null })).toEqual({
      ok: false,
      error: "not-a-section",
    });
    structure.discardStructureDraft.mockResolvedValue({ ok: false, error: "kind-mismatch" });
    expect(await target.discardDraft({ structure: null, draft: scenario })).toEqual({
      ok: false,
      error: "kind-mismatch",
    });
  });
});

describe("result mapping", () => {
  it("keeps the learner count and nothing else of a refusal", () => {
    expect(toDoneResult({ ok: false, error: "has-learners", count: 2 })).toEqual({
      ok: false,
      error: "has-learners",
      count: 2,
    });
    expect(
      toSaveResult({ ok: false, error: "live-course-standard-only", reasons: [{ code: "extra-parts" }] })
    ).toEqual({ ok: false, error: "live-course-standard-only" });
    expect(toDraftResult({ ok: false, error: "forbidden" })).toEqual({ ok: false, error: "forbidden" });
  });
});

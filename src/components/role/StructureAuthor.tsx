"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getStructure,
  saveStructure,
  clearStructure,
  listAuthorableCourses,
  type AuthorableCourse,
} from "@/app/actions/structure";
import type {
  StoredStructure,
  StoredSimulation,
  StoredScenario,
  StoredAssessment,
  StoredScenarioChoice,
  LocalizedText,
  StructureStageKey,
} from "@/lib/cms/structure";
import type { Locale, OutcomeQuality } from "@/lib/cms/types";
import {
  Puzzle,
  Save,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Trash2,
  Star,
  RotateCcw,
} from "lucide-react";

const LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "el", label: "Ελληνικά" },
];
const KINDS: { key: StructureStageKey; label: string }[] = [
  { key: "simulation", label: "Simulation" },
  { key: "scenario", label: "Scenario" },
  { key: "assessment", label: "Assessment" },
];
const QUALITIES: OutcomeQuality[] = ["best", "okay", "poor"];

const inputCls =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";

let idSeq = 0;
const newId = (p: string) => `${p}${(idSeq++).toString(36)}${Date.now().toString(36).slice(-3)}`;

function setLoc(map: LocalizedText, locale: Locale, value: string): LocalizedText {
  return { ...map, [locale]: value };
}

function emptyStructure(kind: StructureStageKey): StoredStructure {
  if (kind === "simulation") {
    return {
      kind: "simulation",
      title: {},
      prompt: {},
      instruction: {},
      options: [
        { id: newId("o"), isBest: true, text: {}, feedback: {} },
        { id: newId("o"), isBest: false, text: {}, feedback: {} },
      ],
    };
  }
  if (kind === "scenario") {
    return {
      kind: "scenario",
      title: {},
      setup: {},
      question: {},
      followupQuestion: {},
      choices: [
        { id: newId("c"), quality: "best", text: {}, outcome: {}, followups: [] },
        { id: newId("c"), quality: "poor", text: {}, outcome: {} },
      ],
    };
  }
  return {
    kind: "assessment",
    title: {},
    intro: {},
    questions: [
      {
        id: newId("q"),
        correctOptionId: "",
        question: {},
        options: [
          { id: newId("a"), text: {} },
          { id: newId("a"), text: {} },
        ],
      },
    ],
  };
}

export function StructureAuthor() {
  const router = useRouter();
  const [courses, setCourses] = React.useState<AuthorableCourse[] | null>(null);
  const [slug, setSlug] = React.useState("");
  const [kind, setKind] = React.useState<StructureStageKey>("simulation");
  const [locale, setLocale] = React.useState<Locale>("en");
  // The draft plus the (course, stage) it belongs to, as one unit. Deriving
  // `ready` from the key means switching course then saving quickly can never
  // write one course's draft onto another — Save waits for the matching load.
  const [loaded, setLoaded] = React.useState<{
    key: string;
    draft: StoredStructure;
    authored: boolean;
  } | null>(null);
  const setDraft = (next: StoredStructure) =>
    setLoaded((l) => (l ? { ...l, draft: next } : l));
  const [status, setStatus] = React.useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [issues, setIssues] = React.useState<string[]>([]);
  const [reloadKey, setReloadKey] = React.useState(0);

  // Load the authorable (CMS-created) courses once.
  const [denied, setDenied] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    listAuthorableCourses().then((list) => {
      if (cancelled) return;
      if (list === null) setDenied(true);
      else {
        setCourses(list);
        setSlug((s) => s || list[0]?.slug || "");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      const existing = await getStructure(slug, kind);
      if (cancelled) return;
      setLoaded({
        key: `${slug}:${kind}`,
        draft: existing ?? emptyStructure(kind),
        authored: Boolean(existing),
      });
      setStatus("idle");
      setIssues([]);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, kind, reloadKey]);

  // Until the load for the current selectors resolves, `loaded.key` still holds
  // the previous pair, so `ready` is false — no synchronous reset needed.
  const ready = loaded?.key === `${slug}:${kind}`;
  const draft = ready ? loaded!.draft : null;
  const authored = ready ? loaded!.authored : false;

  React.useEffect(() => {
    if (status !== "saved") return;
    const id = setTimeout(() => setStatus("idle"), 2500);
    return () => clearTimeout(id);
  }, [status]);

  async function onSave() {
    if (!draft || !ready) return;
    setStatus("saving");
    const res = await saveStructure(slug, kind, draft);
    if (res.ok) {
      setStatus("saved");
      setIssues([]);
      setReloadKey((k) => k + 1);
      router.refresh();
    } else {
      setStatus("error");
      setIssues(
        res.error === "invalid" && res.issues
          ? res.issues.map((i) => i.message)
          : [
              res.error === "forbidden"
                ? "Editors and admins only."
                : res.error === "not-cms-course"
                  ? "Only courses created in the CMS can be authored here."
                  : res.error === "kind-mismatch"
                    ? "That structure doesn't match the stage."
                    : "Something went wrong.",
            ]
      );
    }
  }

  async function onClear() {
    setStatus("saving");
    await clearStructure(slug, kind);
    setReloadKey((k) => k + 1);
    router.refresh();
  }

  if (denied) return null;
  if (courses === null) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-[var(--muted-foreground)]">
          Loading…
        </CardContent>
      </Card>
    );
  }
  if (courses.length === 0) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-[var(--muted-foreground)]">
          Create a course first — interactive stages are authored on
          CMS-created courses. Bundled demo courses keep their built-in
          structure.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4" role="region" aria-label="Interactive stage">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <Puzzle className="h-4 w-4 text-[var(--accent)]" />
            Interactive stage
          </p>
          <Badge variant={authored ? "accent" : "muted"} className="text-[10px]">
            {authored ? "Authored" : "Not added yet"}
          </Badge>
        </div>

        {/* Selectors */}
        <div className="flex flex-wrap gap-2 mb-4">
          <label className="text-xs text-[var(--muted-foreground)]">
            <span className="block mb-1">Course</span>
            <select
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              aria-label="Course"
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
            >
              {courses.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--muted-foreground)]">
            <span className="block mb-1">Stage</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as StructureStageKey)}
              aria-label="Stage"
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
            >
              {KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--muted-foreground)]">
            <span className="block mb-1">Language</span>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              aria-label="Language"
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
            >
              {LOCALES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {issues.length ? (
          <div
            className="mb-3 rounded-lg border border-[var(--danger)] bg-[var(--danger)]/10 p-3"
            role="alert"
          >
            <p className="text-sm font-medium text-[var(--danger)] flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" />
              Not ready to save:
            </p>
            <ul className="mt-1 ml-6 list-disc text-sm text-[var(--foreground)]">
              {issues.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {draft ? (
          <>
            {draft.kind === "simulation" ? (
              <SimulationEditor
                value={draft}
                locale={locale}
                onChange={setDraft}
              />
            ) : draft.kind === "scenario" ? (
              <ScenarioEditor value={draft} locale={locale} onChange={setDraft} />
            ) : (
              <AssessmentEditor
                value={draft}
                locale={locale}
                onChange={setDraft}
              />
            )}
          </>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
          <Button
            size="sm"
            onClick={onSave}
            disabled={status === "saving" || !ready}
          >
            {status === "saving" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save stage
          </Button>
          {authored ? (
            <Button size="sm" variant="outline" onClick={onClear}>
              <RotateCcw className="h-4 w-4" />
              Remove stage
            </Button>
          ) : null}
          {status === "saved" ? (
            <span
              role="status"
              className="text-xs text-[var(--success)] inline-flex items-center gap-1"
            >
              <CheckCircle2 className="h-4 w-4" />
              Saved
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/* --------------------------------- shared --------------------------------- */

function LocField({
  label,
  map,
  locale,
  onChange,
  textarea,
  placeholder,
}: {
  label: string;
  map: LocalizedText;
  locale: Locale;
  onChange: (next: LocalizedText) => void;
  textarea?: boolean;
  placeholder?: string;
}) {
  const val = map[locale] ?? "";
  return (
    <label className="block text-xs text-[var(--muted-foreground)]">
      <span className="block mb-1">{label}</span>
      {textarea ? (
        <textarea
          value={val}
          onChange={(e) => onChange(setLoc(map, locale, e.target.value))}
          placeholder={placeholder}
          rows={2}
          className={inputCls}
        />
      ) : (
        <input
          value={val}
          onChange={(e) => onChange(setLoc(map, locale, e.target.value))}
          placeholder={placeholder}
          className={inputCls}
        />
      )}
    </label>
  );
}

/* ------------------------------- simulation ------------------------------- */

function SimulationEditor({
  value,
  locale,
  onChange,
}: {
  value: StoredSimulation;
  locale: Locale;
  onChange: (s: StoredSimulation) => void;
}) {
  const set = (patch: Partial<StoredSimulation>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <LocField
        label="Stage title"
        map={value.title ?? {}}
        locale={locale}
        onChange={(m) => set({ title: m })}
        placeholder="e.g. Practise the response"
      />
      <LocField
        label="Prompt (the situation)"
        map={value.prompt}
        locale={locale}
        onChange={(m) => set({ prompt: m })}
        textarea
      />
      <LocField
        label="Instruction"
        map={value.instruction}
        locale={locale}
        onChange={(m) => set({ instruction: m })}
        placeholder="e.g. Choose the strongest response."
      />

      <p className="text-xs font-medium text-[var(--foreground)] pt-1">
        Options — mark the one best response with the star.
      </p>
      <ul className="space-y-2">
        {value.options.map((o, i) => (
          <li
            key={o.id}
            className="rounded-lg border border-[var(--border)] p-3 space-y-2"
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  set({
                    options: value.options.map((x) => ({
                      ...x,
                      isBest: x.id === o.id,
                    })),
                  })
                }
                aria-pressed={o.isBest}
                aria-label={`Mark option ${i + 1} as best`}
                className={`rounded-md p-1 ${
                  o.isBest
                    ? "text-[var(--accent)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                <Star
                  className="h-4 w-4"
                  fill={o.isBest ? "currentColor" : "none"}
                />
              </button>
              <span className="text-[11px] text-[var(--muted-foreground)]">
                Option {i + 1}
                {o.isBest ? " · best" : ""}
              </span>
              {value.options.length > 2 ? (
                <button
                  type="button"
                  onClick={() =>
                    set({ options: value.options.filter((x) => x.id !== o.id) })
                  }
                  aria-label={`Remove option ${i + 1}`}
                  className="ml-auto rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <LocField
              label="Option text"
              map={o.text}
              locale={locale}
              onChange={(m) =>
                set({
                  options: value.options.map((x) =>
                    x.id === o.id ? { ...x, text: m } : x
                  ),
                })
              }
            />
            <LocField
              label="Feedback when chosen"
              map={o.feedback}
              locale={locale}
              onChange={(m) =>
                set({
                  options: value.options.map((x) =>
                    x.id === o.id ? { ...x, feedback: m } : x
                  ),
                })
              }
            />
          </li>
        ))}
      </ul>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          set({
            options: [
              ...value.options,
              { id: newId("o"), isBest: false, text: {}, feedback: {} },
            ],
          })
        }
      >
        <Plus className="h-4 w-4" />
        Add option
      </Button>
    </div>
  );
}

/* -------------------------------- scenario -------------------------------- */

function QualitySelect({
  value,
  onChange,
}: {
  value: OutcomeQuality;
  onChange: (q: OutcomeQuality) => void;
}) {
  return (
    <label className="text-[11px] text-[var(--muted-foreground)] inline-flex items-center gap-1">
      Quality
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as OutcomeQuality)}
        aria-label="Outcome quality"
        className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1 text-xs"
      >
        {QUALITIES.map((q) => (
          <option key={q} value={q}>
            {q}
          </option>
        ))}
      </select>
    </label>
  );
}

function ScenarioEditor({
  value,
  locale,
  onChange,
}: {
  value: StoredScenario;
  locale: Locale;
  onChange: (s: StoredScenario) => void;
}) {
  const set = (patch: Partial<StoredScenario>) => onChange({ ...value, ...patch });
  const setChoice = (id: string, patch: Partial<StoredScenarioChoice>) =>
    set({
      choices: value.choices.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });

  return (
    <div className="space-y-3">
      <LocField
        label="Stage title"
        map={value.title ?? {}}
        locale={locale}
        onChange={(m) => set({ title: m })}
        placeholder="e.g. Play it out"
      />
      <LocField
        label="Setup"
        map={value.setup}
        locale={locale}
        onChange={(m) => set({ setup: m })}
        textarea
      />
      <LocField
        label="First question"
        map={value.question}
        locale={locale}
        onChange={(m) => set({ question: m })}
      />
      <LocField
        label="Follow-up question"
        map={value.followupQuestion}
        locale={locale}
        onChange={(m) => set({ followupQuestion: m })}
      />

      <p className="text-xs font-medium text-[var(--foreground)] pt-1">
        First choices — each can have follow-up choices.
      </p>
      <ul className="space-y-2">
        {value.choices.map((c, i) => (
          <li
            key={c.id}
            className="rounded-lg border border-[var(--border)] p-3 space-y-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--muted-foreground)]">
                Choice {i + 1}
              </span>
              <QualitySelect
                value={c.quality}
                onChange={(q) => setChoice(c.id, { quality: q })}
              />
              {value.choices.length > 2 ? (
                <button
                  type="button"
                  onClick={() =>
                    set({ choices: value.choices.filter((x) => x.id !== c.id) })
                  }
                  aria-label={`Remove choice ${i + 1}`}
                  className="ml-auto rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <LocField
              label="Choice text"
              map={c.text}
              locale={locale}
              onChange={(m) => setChoice(c.id, { text: m })}
            />
            <LocField
              label="Outcome shown"
              map={c.outcome}
              locale={locale}
              onChange={(m) => setChoice(c.id, { outcome: m })}
              textarea
            />

            {/* Follow-ups */}
            <div className="ml-3 border-l border-[var(--border)] pl-3 space-y-2">
              {(c.followups ?? []).map((f, j) => (
                <div key={f.id} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-[var(--muted-foreground)]">
                      Follow-up {i + 1}.{j + 1}
                    </span>
                    <QualitySelect
                      value={f.quality}
                      onChange={(q) =>
                        setChoice(c.id, {
                          followups: (c.followups ?? []).map((x) =>
                            x.id === f.id ? { ...x, quality: q } : x
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setChoice(c.id, {
                          followups: (c.followups ?? []).filter(
                            (x) => x.id !== f.id
                          ),
                        })
                      }
                      aria-label={`Remove follow-up ${i + 1}.${j + 1}`}
                      className="ml-auto rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <LocField
                    label="Follow-up text"
                    map={f.text}
                    locale={locale}
                    onChange={(m) =>
                      setChoice(c.id, {
                        followups: (c.followups ?? []).map((x) =>
                          x.id === f.id ? { ...x, text: m } : x
                        ),
                      })
                    }
                  />
                  <LocField
                    label="Follow-up outcome"
                    map={f.outcome}
                    locale={locale}
                    onChange={(m) =>
                      setChoice(c.id, {
                        followups: (c.followups ?? []).map((x) =>
                          x.id === f.id ? { ...x, outcome: m } : x
                        ),
                      })
                    }
                    textarea
                  />
                </div>
              ))}
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setChoice(c.id, {
                    followups: [
                      ...(c.followups ?? []),
                      { id: newId("f"), quality: "okay", text: {}, outcome: {} },
                    ],
                  })
                }
              >
                <Plus className="h-4 w-4" />
                Add follow-up
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          set({
            choices: [
              ...value.choices,
              { id: newId("c"), quality: "okay", text: {}, outcome: {}, followups: [] },
            ],
          })
        }
      >
        <Plus className="h-4 w-4" />
        Add first choice
      </Button>
    </div>
  );
}

/* ------------------------------- assessment ------------------------------- */

function AssessmentEditor({
  value,
  locale,
  onChange,
}: {
  value: StoredAssessment;
  locale: Locale;
  onChange: (s: StoredAssessment) => void;
}) {
  const set = (patch: Partial<StoredAssessment>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <LocField
        label="Stage title"
        map={value.title ?? {}}
        locale={locale}
        onChange={(m) => set({ title: m })}
        placeholder="e.g. Quick check"
      />
      <LocField
        label="Intro"
        map={value.intro}
        locale={locale}
        onChange={(m) => set({ intro: m })}
      />

      <ul className="space-y-2">
        {value.questions.map((q, i) => (
          <li
            key={q.id}
            className="rounded-lg border border-[var(--border)] p-3 space-y-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--muted-foreground)]">
                Question {i + 1}
              </span>
              {value.questions.length > 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    set({
                      questions: value.questions.filter((x) => x.id !== q.id),
                    })
                  }
                  aria-label={`Remove question ${i + 1}`}
                  className="ml-auto rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <LocField
              label="Question"
              map={q.question}
              locale={locale}
              onChange={(m) =>
                set({
                  questions: value.questions.map((x) =>
                    x.id === q.id ? { ...x, question: m } : x
                  ),
                })
              }
            />
            <p className="text-[11px] text-[var(--muted-foreground)]">
              Answers — tick the correct one.
            </p>
            {q.options.map((a, j) => (
              <div key={a.id} className="flex items-start gap-2">
                <input
                  type="radio"
                  name={`correct-${q.id}`}
                  checked={q.correctOptionId === a.id}
                  onChange={() =>
                    set({
                      questions: value.questions.map((x) =>
                        x.id === q.id ? { ...x, correctOptionId: a.id } : x
                      ),
                    })
                  }
                  aria-label={`Answer ${j + 1} is correct`}
                  className="mt-2.5"
                />
                <div className="flex-1">
                  <LocField
                    label={`Answer ${j + 1}`}
                    map={a.text}
                    locale={locale}
                    onChange={(m) =>
                      set({
                        questions: value.questions.map((x) =>
                          x.id === q.id
                            ? {
                                ...x,
                                options: x.options.map((y) =>
                                  y.id === a.id ? { ...y, text: m } : y
                                ),
                              }
                            : x
                        ),
                      })
                    }
                  />
                </div>
                {q.options.length > 2 ? (
                  <button
                    type="button"
                    onClick={() =>
                      set({
                        questions: value.questions.map((x) =>
                          x.id === q.id
                            ? {
                                ...x,
                                options: x.options.filter((y) => y.id !== a.id),
                              }
                            : x
                        ),
                      })
                    }
                    aria-label={`Remove answer ${j + 1}`}
                    className="mt-1 rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                set({
                  questions: value.questions.map((x) =>
                    x.id === q.id
                      ? { ...x, options: [...x.options, { id: newId("a"), text: {} }] }
                      : x
                  ),
                })
              }
            >
              <Plus className="h-4 w-4" />
              Add answer
            </Button>
          </li>
        ))}
      </ul>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          set({
            questions: [
              ...value.questions,
              {
                id: newId("q"),
                correctOptionId: "",
                question: {},
                options: [
                  { id: newId("a"), text: {} },
                  { id: newId("a"), text: {} },
                ],
              },
            ],
          })
        }
      >
        <Plus className="h-4 w-4" />
        Add question
      </Button>
    </div>
  );
}

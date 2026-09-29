"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getStructure,
  saveStructure,
  clearStructure,
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
  RefreshCw,
} from "lucide-react";

const KIND_LABEL: Record<StructureStageKey, string> = {
  simulation: "Simulation",
  scenario: "Scenario",
  assessment: "Assessment",
};
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

/**
 * Tell the page when unsaved edits appear and when they're gone — saved,
 * reloaded, or discarded because the editor closed.
 */
function useReportDirty(dirty: boolean, onDirtyChange?: (d: boolean) => void) {
  const report = React.useRef(onDirtyChange);
  React.useEffect(() => {
    report.current = onDirtyChange;
  });
  React.useEffect(() => {
    if (!dirty) return;
    report.current?.(true);
    return () => report.current?.(false);
  }, [dirty]);
}

interface LoadedStructure {
  key: string;
  draft: StoredStructure;
  /** What's stored (or the empty template): unsaved edits = draft !== saved. */
  saved: StoredStructure;
  /**
   * What the server holds as far as this editor knows (null = nothing yet).
   * Sent with a save, so the server can refuse it if someone else has saved
   * the stage since (the draft holds every language — D33).
   */
  stored: StoredStructure | null;
  authored: boolean;
}

type Status = "idle" | "saving" | "saved" | "removed" | "error";

/**
 * Author one interactive stage (simulation / scenario / assessment) of a
 * CMS-created course, on the course page. The page gives the lesson and the
 * language being written; the draft holds every language at once, so a
 * language switch keeps unsaved work.
 *
 * It reads the stage fresh whenever it opens, rather than taking what the
 * page loaded: a colleague may have saved another language since.
 */
export function StructureAuthor({
  courseSlug: slug,
  kind,
  locale,
  regionLabel,
  embedded = false,
  onSaved,
  onCleared,
  onDirtyChange,
}: {
  courseSlug: string;
  kind: StructureStageKey;
  /** The language being written. The draft holds every language at once. */
  locale: Locale;
  /** Heading and region name, e.g. "Interactive stage — Simulation". */
  regionLabel?: string;
  /** Inside a lesson on the course page: lighter frame. */
  embedded?: boolean;
  onSaved?: (structure: StoredStructure) => void;
  onCleared?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const headingId = React.useId();
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  // The draft plus the (course, stage) it belongs to, as one unit. Deriving
  // `ready` from the key means Save waits until the stage has loaded.
  const [loaded, setLoaded] = React.useState<LoadedStructure | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [status, setStatus] = React.useState<Status>("idle");
  const setDraft = (next: StoredStructure) => {
    setLoaded((l) => (l ? { ...l, draft: next } : l));
    // "Removed" / "Saved" describe the stage before this edit.
    setStatus((s) => (s === "removed" || s === "saved" ? "idle" : s));
  };
  const [issues, setIssues] = React.useState<string[]>([]);
  const [clearError, setClearError] = React.useState("");
  // Someone else saved this stage after it was loaded here.
  const [conflict, setConflict] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    getStructure(slug, kind).then(
      (existing) => {
        if (cancelled) return;
        const draft = existing ?? emptyStructure(kind);
        setLoaded({
          key: `${slug}:${kind}`,
          draft,
          saved: draft,
          stored: existing,
          authored: Boolean(existing),
        });
        setLoadFailed(false);
        setConflict(false);
        setIssues([]);
        // Keep "Removed" after the reload that follows a removal.
        setStatus((s) => (s === "removed" ? s : "idle"));
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [slug, kind, reloadKey]);

  // Until the load resolves, `loaded.key` doesn't match (or `loaded` is
  // null), so `ready` is false — no synchronous reset needed.
  const ready = loaded?.key === `${slug}:${kind}`;
  const draft = ready ? loaded!.draft : null;
  const authored = ready ? loaded!.authored : false;
  const dirty = ready && loaded!.draft !== loaded!.saved;
  useReportDirty(dirty, onDirtyChange);
  const kindLabel = KIND_LABEL[kind];

  React.useEffect(() => {
    if (status !== "saved") return;
    const id = setTimeout(() => setStatus("idle"), 2500);
    return () => clearTimeout(id);
  }, [status]);

  async function onSave() {
    if (!draft || !ready) return;
    const savedKey = `${slug}:${kind}`;
    setStatus("saving");
    setClearError("");
    setConflict(false);
    const res = await saveStructure(slug, kind, draft, loaded!.stored);
    if (res.ok) {
      // The server stores exactly this draft, so keep it rather than reloading:
      // a reload resets status to "idle" (the "Saved" confirmation flashed for
      // ~25ms) and overwrites anything typed while it was in flight — which
      // stays unsaved, since it's a newer draft than the one sent.
      setLoaded((l) =>
        l?.key === savedKey
          ? { ...l, authored: true, saved: draft, stored: draft }
          : l
      );
      setStatus("saved");
      setIssues([]);
      // The page re-reads itself (what learners see, warnings).
      onSaved?.(draft);
    } else if (res.error === "changed-elsewhere") {
      // Nothing was written; the edits stay on screen.
      setStatus("error");
      setIssues([]);
      setConflict(true);
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

  function onReload() {
    if (
      dirty &&
      !window.confirm(
        "Load the saved version of this stage? Your unsaved edits here will be replaced."
      )
    ) {
      return;
    }
    setReloadKey((k) => k + 1);
  }

  async function onClear() {
    if (
      !window.confirm(
        `Remove this ${kindLabel.toLowerCase()}? Learners will no longer see it.`
      )
    ) {
      return;
    }
    // "Remove stage" goes away once it's done (and so do the lesson's video
    // and documents above): keep focus here, not on the page.
    headingRef.current?.focus();
    setStatus("saving");
    setClearError("");
    setConflict(false);
    const res = await clearStructure(slug, kind);
    if (!res.ok) {
      setStatus("error");
      setClearError(
        "Couldn't remove the stage: only editors and admins can change courses."
      );
      return;
    }
    setStatus("removed");
    setReloadKey((k) => k + 1);
    onCleared?.();
  }

  return (
    <Card className={embedded ? "shadow-none" : undefined}>
      <CardContent className="p-4" role="region" aria-labelledby={headingId}>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h3
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="text-sm font-semibold flex items-center gap-1.5"
          >
            <Puzzle className="h-4 w-4 text-[var(--accent)]" aria-hidden />
            {regionLabel ?? "Interactive stage"}
          </h3>
          <Badge variant={authored ? "accent" : "muted"} className="text-[10px]">
            {authored ? "Authored" : "Not added yet"}
          </Badge>
        </div>

        {conflict ? (
          <div
            className="mb-3 rounded-lg border border-[var(--warning)] bg-[var(--warning)]/10 p-3"
            role="alert"
          >
            <p className="text-sm flex items-start gap-1.5">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--warning)]"
                aria-hidden
              />
              <span>
                Someone else saved this stage since you opened it, so nothing
                was saved. Reload it to see their changes — your edits are
                still here until you do.
              </span>
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={onReload}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Reload the saved version
            </Button>
          </div>
        ) : null}

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
        ) : loadFailed ? (
          <p className="text-sm text-[var(--danger)]" role="alert">
            Couldn&rsquo;t load this stage. Reload the page to try again.
          </p>
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
            <Button
              size="sm"
              variant="outline"
              disabled={status === "saving"}
              onClick={onClear}
            >
              <RotateCcw className="h-4 w-4" />
              Remove stage
            </Button>
          ) : null}
          {/* Always mounted, so what it says next is announced. */}
          <span
            role="status"
            aria-live="polite"
            className="text-xs text-[var(--success)] inline-flex items-center gap-1"
          >
            {status === "saved" ? (
              <>
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                Saved
              </>
            ) : status === "removed" ? (
              <>
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                Removed — learners no longer see this stage.
              </>
            ) : null}
          </span>
          {clearError ? (
            <span
              role="alert"
              className="text-xs text-[var(--danger)] inline-flex items-start gap-1"
            >
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {clearError}
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
  // Radio group names from useId, not the question ids: a new question's id
  // is random, and would differ between the server and the browser.
  const group = React.useId();

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
                  name={`${group}-correct-${i}`}
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

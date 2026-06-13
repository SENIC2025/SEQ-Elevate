"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StageBreadcrumb } from "@/components/course/StageBreadcrumb";
import { Sparkles, ChevronLeft, Save, Languages, Eye, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

interface DraftScenario {
  title: string;
  setup: string;
  question: string;
  choices: [string, string, string, string];
  outcome: string;
  outcomeQuality: "best" | "okay" | "poor";
}

const DEFAULT_DRAFT: DraftScenario = {
  title: "Asking for help at a new job",
  setup:
    "Your second week at the warehouse. The machine you're meant to use today is one nobody has shown you yet. The supervisor is busy on a call. Two colleagues are nearby, both wearing headphones. The next batch is due in 15 minutes.",
  question: "What do you do?",
  choices: [
    "Wait until the supervisor finishes the call",
    "Try to figure the machine out yourself from the manual",
    "Tap a colleague's shoulder and ask, even though they're focused",
    "Send a quick message in the team chat",
  ],
  outcome:
    "Your colleague pulls off one headphone. \"Yeah no worries — give me 30 seconds and I'll come show you.\" The batch gets out on time. You feel something settle in your chest that wasn't settled before.",
  outcomeQuality: "best",
};

export function ContentLivePreview() {
  const [draft, setDraft] = useState<DraftScenario>(DEFAULT_DRAFT);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle"
  );

  const update = <K extends keyof DraftScenario>(
    key: K,
    value: DraftScenario[K]
  ) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaveState("saving");
    setTimeout(() => setSaveState("saved"), 400);
  };

  const updateChoice = (i: number, value: string) => {
    const next = [...draft.choices] as DraftScenario["choices"];
    next[i] = value;
    update("choices", next);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <Link
        href="/content"
        className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-3"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to content
      </Link>

      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <div>
          <Badge variant="primary" className="mb-2">
            <Sparkles className="h-3 w-3" />
            Live preview · Strapi-style authoring
          </Badge>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Edit scenario · see learner view live
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1 max-w-2xl">
            What you type on the left is what the learner sees on the right.
            In production this writes to Strapi with versioning, translation
            memory, and accessibility warnings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--muted-foreground)]">
            <Languages className="inline h-3 w-3 mr-1" />
            EN draft
          </span>
          <SaveBadge state={saveState} />
        </div>
      </div>

      <div className="mt-6 grid lg:grid-cols-[1fr_440px] gap-6">
        {/* ============== Form column (editor) ============== */}
        <Card>
          <CardContent className="p-6 space-y-5">
            <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-3 mb-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Scenario fields
              </h2>
              <span className="text-[10px] text-[var(--muted-foreground)] font-mono bg-[var(--surface-muted)] px-2 py-0.5 rounded">
                model: Scenario
              </span>
            </header>

            <div>
              <FieldLabel
                label="Scenario title"
                hint="Shown to learner at top. Plain language."
                required
              />
              <input
                type="text"
                value={draft.title}
                onChange={(e) => update("title", e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>

            <div>
              <FieldLabel
                label="Setup"
                hint="The situation. Short, concrete, real-life. Avoid jargon."
                required
              />
              <Textarea
                value={draft.setup}
                onChange={(e) => update("setup", e.target.value)}
                rows={4}
              />
              <FieldFooter
                value={draft.setup}
                hint="Target 30–60 words. Reading level grade 6."
              />
            </div>

            <div>
              <FieldLabel
                label="Decision question"
                hint="One short question the learner answers."
                required
              />
              <input
                type="text"
                value={draft.question}
                onChange={(e) => update("question", e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>

            <div>
              <FieldLabel
                label="Choices (4)"
                hint="One best, two workable, one costly. Order doesn't matter."
                required
              />
              <div className="space-y-2">
                {draft.choices.map((choice, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <span className="mt-2 flex h-6 w-6 items-center justify-center rounded-md bg-[var(--surface-muted)] text-xs font-semibold text-[var(--muted-foreground)] flex-shrink-0">
                      {i + 1}
                    </span>
                    <input
                      type="text"
                      value={choice}
                      onChange={(e) => updateChoice(i, e.target.value)}
                      className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-start">
              <div>
                <FieldLabel
                  label="Best-path outcome"
                  hint="What happens after the strongest choice."
                />
                <Textarea
                  value={draft.outcome}
                  onChange={(e) => update("outcome", e.target.value)}
                  rows={3}
                />
              </div>
              <div>
                <FieldLabel label="Quality tag" hint="Used by analytics." />
                <select
                  value={draft.outcomeQuality}
                  onChange={(e) =>
                    update("outcomeQuality", e.target.value as DraftScenario["outcomeQuality"])
                  }
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                >
                  <option value="best">best</option>
                  <option value="okay">okay</option>
                  <option value="poor">poor</option>
                </select>
              </div>
            </div>

            <div className="border-t border-[var(--border)] pt-4 mt-2 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
              <div className="flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5" />
                <span>
                  Accessibility check:{" "}
                  <span className="text-[var(--success)]">no issues</span>
                </span>
              </div>
              <Button size="sm" variant="primary">
                <Save className="h-3.5 w-3.5" />
                Publish draft
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ============== Preview column ============== */}
        <div className="lg:sticky lg:top-20 self-start">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-1.5">
              <Smartphone className="h-4 w-4" />
              Learner preview
            </h2>
            <span className="text-[10px] text-[var(--muted-foreground)]">
              Live — updates as you type
            </span>
          </div>
          <PhoneFrame>
            <PreviewScenario
              draft={draft}
              selectedChoice={selectedChoice}
              onChoice={setSelectedChoice}
            />
          </PhoneFrame>
          <p className="mt-3 text-xs text-[var(--muted-foreground)] text-center">
            Tap a choice to preview the outcome rendering.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------- Subcomponents ------- */

function FieldLabel({
  label,
  hint,
  required,
}: {
  label: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div className="mb-1.5">
      <p className="text-sm font-medium">
        {label}
        {required ? (
          <span className="text-[var(--accent)] ml-0.5">*</span>
        ) : null}
      </p>
      {hint ? (
        <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{hint}</p>
      ) : null}
    </div>
  );
}

function FieldFooter({ value, hint }: { value: string; hint: string }) {
  const words = value.trim().split(/\s+/).filter(Boolean).length;
  return (
    <p className="mt-1 flex items-center justify-between text-[10px] text-[var(--muted-foreground)]">
      <span>{hint}</span>
      <span className="font-mono">{words}w</span>
    </p>
  );
}

function SaveBadge({ state }: { state: "idle" | "saving" | "saved" }) {
  if (state === "idle") return null;
  return (
    <Badge variant={state === "saved" ? "success" : "muted"} className="text-[10px]">
      {state === "saving" ? "Saving…" : "Saved"}
    </Badge>
  );
}

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[400px] rounded-[2rem] border-[10px] border-[#2e2e3d] bg-[var(--background)] shadow-2xl overflow-hidden">
      {/* notch */}
      <div className="h-5 bg-[#2e2e3d] flex items-center justify-center">
        <div className="h-1.5 w-16 rounded-full bg-[#1a1a22]" />
      </div>
      <div className="h-[600px] overflow-y-auto">{children}</div>
    </div>
  );
}

function PreviewScenario({
  draft,
  selectedChoice,
  onChoice,
}: {
  draft: DraftScenario;
  selectedChoice: number | null;
  onChoice: (i: number | null) => void;
}) {
  const t = useTranslations("common");
  return (
    <div className="bg-[var(--background)] min-h-full">
      {/* Mini header */}
      <div className="sticky top-0 bg-[var(--surface)] border-b border-[var(--border)] px-4 py-2 z-10">
        <div className="flex items-center gap-1.5">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--primary)] text-[var(--primary-foreground)]">
            <Sparkles className="h-3 w-3" />
          </span>
          <span className="text-xs font-semibold">{t("appName")}</span>
        </div>
      </div>

      {/* Course header */}
      <div className="px-4 pt-3">
        <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
          Step 5 of 7 · Applied scenario
        </p>
      </div>

      {/* Breadcrumb */}
      <div className="px-4 mt-2">
        <StageBreadcrumb current="scenario" completed={["context", "concept", "behaviour", "simulation"]} />
      </div>

      {/* Scenario card */}
      <div className="p-4 mt-2">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--accent)] font-semibold mb-1">
            <Sparkles className="h-3 w-3" />
            Branching scenario
          </div>
          <h2 className="text-lg font-bold tracking-tight">{draft.title || "(untitled)"}</h2>
          <p className="mt-2 text-sm leading-relaxed">{draft.setup}</p>

          <p className="mt-4 font-medium text-sm">{draft.question}</p>
          <div className="mt-2 space-y-1.5">
            {draft.choices.map((choice, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onChoice(selectedChoice === i ? null : i)}
                className={cn(
                  "w-full text-left rounded-lg border p-3 text-sm transition-colors",
                  selectedChoice === i
                    ? "border-[var(--primary)] bg-[var(--accent)]/5"
                    : "border-[var(--border)] hover:bg-[var(--surface-muted)]"
                )}
              >
                {choice || `(choice ${i + 1})`}
              </button>
            ))}
          </div>

          {selectedChoice !== null ? (
            <div
              className={cn(
                "mt-4 rounded-lg border p-3",
                draft.outcomeQuality === "best"
                  ? "border-[var(--success)]/30 bg-[var(--success)]/5"
                  : draft.outcomeQuality === "okay"
                    ? "border-[var(--border)] bg-[var(--surface-muted)]"
                    : "border-[var(--warning)]/30 bg-[var(--warning)]/5"
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
                  What just happened
                </span>
                <Badge
                  variant={
                    draft.outcomeQuality === "best"
                      ? "success"
                      : draft.outcomeQuality === "okay"
                        ? "muted"
                        : "accent"
                  }
                  className="text-[9px]"
                >
                  {draft.outcomeQuality}
                </Badge>
              </div>
              <p className="text-xs leading-relaxed">{draft.outcome}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { PlayerAnnouncer, useAnnounce } from "@/components/course/PlayerAnnouncer";
import { SafeguardingHint } from "@/components/safeguarding/SafeguardingHint";
import { COMP_CARD_TEXT_MAX } from "@/lib/comp-card-visibility";
import { useDemoState } from "@/store/demo-state";
import { CompCardPrint } from "./CompCardPrint";
import {
  Printer,
  Save,
  Lock,
  Eye,
  CheckCircle2,
  ChevronLeft,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CompCardTemplate } from "@/lib/cms/types";

/**
 * Whether this person may share their Comp Card, as the server read it for
 * the page (learner/comp-card/page.tsx): a guest can't; signed in, they
 * share with the facilitators of their own organisation, unless they have
 * none yet, or were invited under the guardian rule without a guardian's
 * permission that covers sharing (D80, spec 5.6).
 */
export interface SharingContext {
  signedIn: boolean;
  /** The learner's organisation: the facilitators they would share with. */
  organisationName: string | null;
  blocked: "no-organisation" | "guardian-consent-needed" | null;
}

const GUEST: SharingContext = { signedIn: false, organisationName: null, blocked: null };

/** From here on the learner is told how many characters are left. */
export const NEAR_CARD_LIMIT = 1_800;

type FieldLength = { kind: "left"; left: number } | { kind: "tooLong" } | null;

/** What to tell the learner about a text's length: nothing while it's short. */
export function cardFieldLength(text: string): FieldLength {
  if (text.length > COMP_CARD_TEXT_MAX) return { kind: "tooLong" };
  if (text.length >= NEAR_CARD_LIMIT) return { kind: "left", left: COMP_CARD_TEXT_MAX - text.length };
  return null;
}

/**
 * The learner's Comp Card. Release 3 (D80, spec 4.5):
 * - who sees it is one of two choices, each a toggle button: "Only me"
 *   (at once) and "Me and the facilitators at ‹organisation›", which asks
 *   first in place (focus to the question; Escape or Cancel returns to the
 *   button). It is saved by its own action, never with the text. Guests,
 *   learners without an organisation and learners whose guardian's
 *   permission doesn't cover sharing see "Only me", fixed, and why;
 * - under it, always: what facilitators and the platform's staff see
 *   whatever the choice, outside every text an editor can reword;
 * - each text has no maxLength (the browser would cut pasted text without
 *   a word): from 1,800 characters it says how many are left, and over
 *   2,000 that it is too long to save — that field is then not sent and
 *   keeps its saved text, the others save. Crossing into either is said
 *   once through the page's own polite live region.
 */
export function CompCard({
  template,
  sharing = GUEST,
}: {
  /**
   * Field wording resolved server-side (bundled copy + the editor's CMS
   * override). Absent = fall back to the message catalogue, which keeps the
   * component usable in isolation (storybook, tests).
   */
  template?: CompCardTemplate;
  sharing?: SharingContext;
}) {
  return (
    <PlayerAnnouncer>
      <CompCardBody template={template} sharing={sharing} />
    </PlayerAnnouncer>
  );
}

function CompCardBody({ template, sharing }: { template?: CompCardTemplate; sharing: SharingContext }) {
  const t = useTranslations("compCard");
  const tPlayer = useTranslations("coursePlayer");
  const locale = useLocale();

  const { state, dispatch } = useDemoState();
  const c = state.compCard;
  const set = (patch: Partial<typeof c>) =>
    dispatch({ type: "updateCompCard", patch });

  // Template-driven wording, with the bundled copy as the fallback.
  const tpl = template?.fields;
  const field = (key: string) => tpl?.find((f) => f.key === key);
  const shown = (key: string) => (tpl ? Boolean(field(key)) : true);
  const labelFor = (key: string, fallback: string) =>
    field(key)?.label ?? fallback;
  const placeholderFor = (key: string, fallback: string) =>
    field(key)?.placeholder ?? fallback;
  // Editors may reorder; without a template keep the canonical order.
  const textKeys = tpl
    ? tpl.filter((f) => f.kind !== "confidence").map((f) => f.key)
    : ["wentWell", "difficult", "improve", "behaviour"];

  // Evidence + course title come from what the learner actually did
  // (stored when they played), so the Comp Card is course-agnostic.
  const sc = state.course.scenario;
  const hasScenarioEvidence = sc.rootLabel && sc.followupLabel;

  const courseTitle = state.course.courseTitle ?? "—";
  const scenarioSummary = hasScenarioEvidence
    ? `${sc.rootLabel} → ${sc.followupLabel}`
    : "—";

  const dateFormat = { year: "numeric", month: "long", day: "numeric" } as const;
  const dateStr = c.updatedAt
    ? new Date(c.updatedAt).toLocaleDateString(locale, dateFormat)
    : new Date().toLocaleDateString(locale, dateFormat);

  return (
    <>
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
        <Link
          href="/learner"
          className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors mb-3"
        >
          <ChevronLeft className="h-4 w-4" />
          {tPlayer("dashboard")}
        </Link>

        <Card>
          <CardContent className="p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--accent)] font-semibold mb-1">
                  <Sparkles className="h-3.5 w-3.5" />
                  SEQ Comp Card
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                  {t("title")}
                </h1>
                <p className="text-sm text-[var(--muted-foreground)] mt-1">
                  {t("subtitle")}
                </p>
              </div>
              {c.updatedAt ? (
                <Badge variant="success" className="text-xs">
                  <CheckCircle2 className="h-3 w-3" />
                  {t("saved")}
                </Badge>
              ) : null}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
                  {t("courseLabel")}
                </p>
                <p className="font-medium">{courseTitle}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
                  {t("dateLabel")}
                </p>
                <p className="font-medium">{dateStr}</p>
              </div>
            </div>

            {/* Evidence pulled from scenario */}
            {hasScenarioEvidence ? (
              <div className="mt-5 rounded-lg border border-[var(--accent)]/20 bg-[var(--accent)]/5 p-4">
                <p className="text-xs uppercase tracking-wider text-[var(--accent)] font-semibold mb-1">
                  {t("evidencePulled")}
                </p>
                <p className="text-sm leading-snug font-medium">
                  {t("fieldScenario")}
                </p>
                <p className="text-sm mt-0.5">{scenarioSummary}</p>
              </div>
            ) : null}

            {/* Form fields */}
            <div className="mt-6 space-y-5">
              {textKeys.map((key) => {
                // Each key maps to a real CompCard column — the template can
                // reword and reorder these, never invent new ones.
                const defaults: Record<
                  string,
                  { label: string; placeholder: string; value: string }
                > = {
                  wentWell: {
                    label: t("fieldWentWell"),
                    placeholder: t("placeholder.wentWell"),
                    value: c.wentWell,
                  },
                  difficult: {
                    label: t("fieldDifficult"),
                    placeholder: t("placeholder.difficult"),
                    value: c.difficult,
                  },
                  improve: {
                    label: t("fieldImprove"),
                    placeholder: t("placeholder.improve"),
                    value: c.improve,
                  },
                  behaviour: {
                    label: t("fieldBehaviour"),
                    placeholder: t("placeholder.behaviour"),
                    value: c.behaviour,
                  },
                };
                const d = defaults[key];
                if (!d) return null;
                return (
                  <Field
                    key={key}
                    id={`comp-card-${key}`}
                    label={labelFor(key, d.label)}
                    value={d.value}
                    placeholder={placeholderFor(key, d.placeholder)}
                    onChange={(v) => set({ [key]: v } as Partial<typeof c>)}
                  />
                );
              })}
              <SafeguardingHint />

              {/* Confidence */}
              <div hidden={!shown("confidence")}>
                <label className="block text-sm font-medium mb-2">
                  {labelFor("confidence", t("fieldConfidence"))}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => set({ confidence: n })}
                      className={cn(
                        "rounded-md border px-3 py-2 text-sm min-w-[3rem]",
                        c.confidence === n
                          ? "border-[var(--primary-hover)] bg-[var(--primary)] text-[var(--primary-foreground)] font-medium"
                          : "border-[var(--border)] hover:bg-[var(--surface-muted)]"
                      )}
                      aria-pressed={c.confidence === n}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-[var(--muted-foreground)] mt-1">
                  {t(`confidenceLabels.${c.confidence}`)}
                </p>
              </div>

              <SharingChoice context={sharing} />
            </div>

            <div className="mt-7 flex flex-wrap gap-3 justify-between">
              <Button
                variant="primary"
                size="md"
                onClick={() => set({})}
              >
                <Save className="h-4 w-4" />
                {t("saved")}
              </Button>
              <Button
                variant="accent"
                size="md"
                onClick={() => window.print()}
              >
                <Printer className="h-4 w-4" />
                {t("printPdf")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Hidden, only visible in print */}
      <CompCardPrint
        courseTitle={courseTitle}
        dateStr={dateStr}
        scenarioSummary={scenarioSummary}
        compCard={c}
        template={template}
      />
    </>
  );
}

/**
 * Who sees the card: "Only me", or the facilitators of the learner's
 * organisation after a question asked in place (the course page's
 * DeleteConfirm pattern). Saved at once by its own action; put back, and
 * said, when that fails.
 */
function SharingChoice({ context }: { context: SharingContext }) {
  const t = useTranslations("compCard");
  const locale = useLocale();
  const { state, setSharing, accountLoaded } = useDemoState();
  const c = state.compCard;
  const ids = React.useId();
  const [asking, setAsking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const shareButton = React.useRef<HTMLButtonElement>(null);
  const question = React.useRef<HTMLHeadingElement>(null);

  const organisation = context.organisationName;
  const shared = c.sharing === "facilitators";
  // Sharing isn't open to them, and nothing is shared to take back.
  const fixed = !shared && (!context.signedIn || !organisation || context.blocked !== null);
  const why = !context.signedIn
    ? t("sharing.guest")
    : context.blocked === "guardian-consent-needed" && organisation
      ? t("sharing.guardianNeeded", { organisation })
      : !organisation || context.blocked === "no-organisation"
        ? t("sharing.noOrganisation")
        : null;

  React.useEffect(() => {
    if (asking) question.current?.focus();
  }, [asking]);

  const choose = async (choice: "onlyMe" | "facilitators") => {
    if (busy || !accountLoaded) return;
    setBusy(true);
    setFailed(false);
    const ok = await setSharing(choice);
    setBusy(false);
    setFailed(!ok);
    if (choice === "facilitators") {
      setAsking(false);
      shareButton.current?.focus();
    }
  };
  const cancel = () => {
    setAsking(false);
    shareButton.current?.focus();
  };

  const option = (pressed: boolean) =>
    cn(
      "w-full text-left rounded-lg border px-4 py-3 flex items-center gap-3 text-sm",
      pressed ? "border-[var(--primary)] bg-[var(--accent)]/5" : "border-[var(--border)] hover:bg-[var(--surface-muted)]"
    );
  const icon = (pressed: boolean) =>
    cn("h-4 w-4 flex-shrink-0", pressed ? "text-[var(--accent)]" : "text-[var(--muted-foreground)]");

  return (
    <div>
      <p id={`${ids}-label`} className="block text-sm font-medium mb-2">
        {t("privacyLabel")}
      </p>
      {fixed ? (
        <div className={option(true)}>
          <Lock className={icon(true)} aria-hidden />
          <span>{t("sharing.onlyMe")}</span>
        </div>
      ) : (
        <div role="group" aria-labelledby={`${ids}-label`} className="space-y-1.5">
          <button
            type="button"
            aria-pressed={!shared}
            aria-disabled={!accountLoaded || busy || undefined}
            onClick={() => {
              if (shared) void choose("onlyMe");
            }}
            className={option(!shared)}
          >
            <Lock className={icon(!shared)} aria-hidden />
            <span>{t("sharing.onlyMe")}</span>
          </button>
          <button
            ref={shareButton}
            type="button"
            aria-pressed={shared}
            aria-disabled={!accountLoaded || busy || undefined}
            onClick={() => {
              if (!shared && accountLoaded && !busy) setAsking(true);
            }}
            className={option(shared)}
          >
            <Eye className={icon(shared)} aria-hidden />
            <span>{t("sharing.facilitators", { organisation: organisation ?? c.organisationName ?? "" })}</span>
          </button>
        </div>
      )}

      {asking && !shared ? (
        <div
          role="group"
          aria-labelledby={`${ids}-ask`}
          className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              if (!busy) cancel();
            }
          }}
        >
          <h2 id={`${ids}-ask`} ref={question} tabIndex={-1} className="text-sm font-semibold outline-none">
            {t("sharing.shareConfirm", { organisation: organisation ?? "" })}
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              aria-disabled={busy || undefined}
              onClick={() => void choose("facilitators")}
            >
              {t("sharing.share")}
            </Button>
            <Button type="button" size="sm" variant="outline" aria-disabled={busy || undefined} onClick={() => !busy && cancel()}>
              {t("sharing.cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {shared && c.sharedAt ? (
        <p className="mt-2 text-sm">
          {t("sharing.sharedSince", {
            date: new Date(c.sharedAt).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" }),
          })}
        </p>
      ) : null}
      {fixed && why ? <p className="mt-2 text-sm text-[var(--muted-foreground)]">{why}</p> : null}
      {failed ? (
        <p role="alert" className="mt-2 text-sm font-medium text-[var(--danger)]">
          {t("sharing.failed")}
        </p>
      ) : null}
      <p className="mt-3 text-xs text-[var(--muted-foreground)]">
        {organisation ? t("sharing.always", { organisation }) : t("sharing.alwaysNoOrganisation")}
      </p>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  const t = useTranslations("compCard");
  const announce = useAnnounce();
  const length = cardFieldLength(value);
  const kind = length?.kind ?? null;
  const note =
    length?.kind === "tooLong"
      ? t("tooLong", { max: COMP_CARD_TEXT_MAX })
      : length?.kind === "left"
        ? t("charsLeft", { count: length.left })
        : null;
  // Said once when it crosses into a kind, not every character typed, and
  // not for a card that opens long already (the note is read with the box).
  const said = React.useRef<string | null>(kind);
  React.useEffect(() => {
    if (kind === said.current) return;
    said.current = kind;
    if (kind && note) announce(note);
    // Said when the kind changes, with the words of that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1.5">
        {label}
      </label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        aria-describedby={note ? `${id}-length` : undefined}
        aria-invalid={kind === "tooLong" || undefined}
      />
      {note ? (
        <p
          id={`${id}-length`}
          className={cn(
            "mt-1 text-sm",
            kind === "tooLong" ? "font-medium text-[var(--danger)]" : "text-[var(--muted-foreground)]"
          )}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}

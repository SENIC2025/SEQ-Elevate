"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineConfirm } from "@/components/ui/inline-confirm";
import {
  addLessonLink,
  getLessonLinks,
  removeLessonLink,
  setLessonLinkOrder,
  setLessonLinkPublished,
  updateLessonLink,
} from "@/app/actions/lesson-reading";
import { LINK_LIMITS, linkPlace, type StaffLessonLink } from "@/lib/cms/lesson-links";
import type { ItemLanguages } from "@/lib/cms/reading-types";
import type { LessonDocumentRef, Locale } from "@/lib/cms/types";
import { checkLinkHref, type LinkRefusal } from "@/lib/rich-text/link-url";
import { linkTextProblem, toLinkInput } from "@/lib/rich-text/link-text";
import { ownFileHost } from "@/lib/rich-text/own-file-host";
import { AlertTriangle, BookOpen, ChevronDown, ChevronUp, Eye, EyeOff, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

/*
 * Release 4 (D107, D108; spec 4.6): a lesson's further reading on the course
 * page, beside its documents. English, like the document manager and the
 * other authoring tools (D106).
 */

const LANGUAGES: { code: Locale; name: string }[] = [
  { code: "en", name: "English" },
  { code: "de", name: "German" },
  { code: "el", name: "Greek" },
];
const nameOf = (code: Locale) => LANGUAGES.find((l) => l.code === code)?.name ?? code;

/** The form's fields as typed. */
export interface LinkFormValues {
  title: string;
  url: string;
  description: string;
  /** The ticked language boxes; all three = every language. */
  languages: Locale[];
}

export type LinkFormField = "title" | "url" | "description" | "languages";
export type LinkFormProblems = Partial<Record<LinkFormField, string>>;

/** Why an address can't be used, in words. */
export function addressMessage(reason: LinkRefusal | "own-file"): string {
  switch (reason) {
    case "empty":
      return "Write the web address.";
    case "too-long":
      return "This address is too long (at most 2,048 characters).";
    case "credentials":
      return "Addresses can't contain a user name or password.";
    case "redirect":
      return "This is an Outlook safe link, which carries the address of the mailbox it was sent to. Use the original address instead.";
    case "own-file":
      return "This is a file uploaded to the platform. Upload it as a document instead.";
    default:
      return "Use an address starting with https:// or http://, or an email address.";
  }
}

const MISLEADING_TITLE = "The title shows a different address than the link opens. Use the real address, or a few words.";
const HTTP_WARNING = "This address isn't secure (http). Use https:// if the site offers it.";
const UNUSABLE = "This address can't be used. Edit it or remove the link.";
const ADDED = "Added as a draft — learners can't see it until you choose “Show to learners”.";

/**
 * The form's own check, before anything is sent: the server's rules (spec
 * 4.2), with what an author types completed first (toLinkInput: a bare
 * email address gains mailto:, a bare host https://, an Outlook safe link
 * or a Google redirect becomes its target). Returns the problems by field,
 * the address that will be stored, and whether it uses http.
 */
export function checkLinkForm(values: LinkFormValues): {
  problems: LinkFormProblems;
  href: string | null;
  insecure: boolean;
} {
  const problems: LinkFormProblems = {};
  const title = values.title.replace(/\s+/g, " ").trim();
  if (!title) problems.title = "Give the link a title.";
  else if (title.length > LINK_LIMITS.title) problems.title = `The title is too long (at most ${LINK_LIMITS.title} characters).`;

  const check = checkLinkHref(toLinkInput(values.url), { ownFileHost: ownFileHost() });
  let href: string | null = null;
  if (!check.ok) problems.url = addressMessage(check.reason);
  else if (check.ownFile) problems.url = addressMessage("own-file");
  else {
    href = check.href;
    if (!problems.title && linkTextProblem(title, href) === "misleading") problems.title = MISLEADING_TITLE;
  }

  if (values.description.replace(/\s+/g, " ").trim().length > LINK_LIMITS.description) {
    problems.description = `The description is too long (at most ${LINK_LIMITS.description} characters).`;
  }
  if (!values.languages.length) problems.languages = "Choose at least one language.";
  return { problems, href, insecure: check.ok && check.insecure };
}

type ActionAnswer = Awaited<ReturnType<typeof addLessonLink>>;

/** A refusal from the server, as the form or the list says it: the field it belongs to, if any. */
export function refusalMessage(answer: Exclude<ActionAnswer, { ok: true }>): { field?: LinkFormField; text: string } {
  switch (answer.error) {
    case "invalid":
      if (answer.field === "url") {
        return { field: "url", text: addressMessage(answer.reason === "misleading" ? "scheme" : answer.reason) };
      }
      if (answer.field === "title") {
        if (answer.reason === "misleading") return { field: "title", text: MISLEADING_TITLE };
        if (answer.reason === "empty") return { field: "title", text: "Give the link a title." };
        return { field: "title", text: `The title is too long (at most ${LINK_LIMITS.title} characters).` };
      }
      return { field: "description", text: `The description is too long (at most ${LINK_LIMITS.description} characters).` };
    case "too-many":
      return { text: `A lesson can have at most ${LINK_LIMITS.perLesson} further-reading links.` };
    case "forbidden":
      return { text: "Your account can't edit courses any more. Sign in again, or ask an administrator for the Editor role." };
    case "not-found":
      return { text: "This lesson or link isn't there any more. Reload the page." };
    case "not-a-section":
    case "outline-unreadable":
      return { text: "This lesson isn't in the course's lesson list any more. Reload the page." };
    default:
      return { text: "The server refused the change. Try again." };
  }
}

/** The hints the page can give from what it knows of the lesson (spec 4.6). */
export function linkHints(lesson: {
  /** Learners get this lesson now (`live`). */
  live: boolean;
  /** It has text, an exercise, extra content or a video. */
  otherContent: boolean;
  documents: readonly (LessonDocumentRef & ItemLanguages)[];
}): string[] {
  const published = lesson.documents.filter((d) => d.published);
  if (!lesson.otherContent && !published.length) {
    return ["Further reading alone doesn't make a lesson appear for learners."];
  }
  const hints: string[] = [];
  if (!lesson.live) hints.push("Learners don't get this lesson now, so they don't see its further reading.");
  // Languages never change which lessons there are: a lesson whose only
  // material is documents for some languages reaches everyone, and the
  // others see those documents, marked with their language.
  if (!lesson.otherContent && published.every((d) => d.languages?.length)) {
    const covered = LANGUAGES.filter((l) => published.some((d) => d.languages?.includes(l.code)));
    if (covered.length < LANGUAGES.length) {
      const names = covered.map((l) => l.name);
      const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
      hints.push(
        covered.length === 1 && published.length === 1
          ? `Every language gets this lesson: its only material is for ${list} learners, so others see the ${list} document, marked “In ${list}”.`
          : `Every language gets this lesson: its only material is for ${list} learners, so others see it too, marked with its language.`
      );
    }
  }
  return hints;
}

const EMPTY: LinkFormValues = { title: "", url: "", description: "", languages: ["en", "de", "el"] };
const formOf = (link: StaffLessonLink): LinkFormValues => ({
  title: link.title,
  url: link.url,
  description: link.description,
  languages: link.languages.length ? [...link.languages] : ["en", "de", "el"],
});
const languagesBadge = (languages: readonly Locale[]) =>
  languages.length ? languages.map(nameOf).join(", ") : "All languages";

/**
 * The list of a lesson's further-reading links and the "Add a link" form
 * (spec 4.6). New links are drafts until "Show to learners" (Q15). After
 * every change it reads the list back (getLessonLinks) and reports it up
 * (`onLinksChanged`), so the page's read view, delete summary and content
 * base follow.
 *
 * The form opens from its own "Add a link" button, or from outside
 * (`adding` and `onAddingChange`, when the document card holds the button).
 * It isn't a <form>: no browser check blocks an address the form completes
 * (help@verein.de, www.bpb.de), and Enter in a field saves.
 *
 * A stored address the check refuses (only a direct database write leaves
 * one) is shown as text, with Edit and Remove, never as a link.
 */
export function LessonLinkManager({
  courseSlug,
  stageKey,
  initialLinks,
  onLinksChanged,
  adding: addingProp,
  onAddingChange,
  hints = [],
}: {
  courseSlug: string;
  stageKey: string;
  /** Every link on the lesson, drafts included; skips the first load. */
  initialLinks?: StaffLessonLink[];
  onLinksChanged?: (links: StaffLessonLink[]) => void;
  /** The form is open (controlled from outside, with onAddingChange). */
  adding?: boolean;
  onAddingChange?: (adding: boolean) => void;
  /** What the page knows of the lesson, in words (linkHints). */
  hints?: readonly string[];
}) {
  const ids = React.useId();
  const [links, setLinks] = React.useState<StaffLessonLink[]>(initialLinks ?? []);
  const [ownAdding, setOwnAdding] = React.useState(false);
  const adding = addingProp ?? ownAdding;
  const setAdding = (open: boolean) => {
    setOwnAdding(open);
    onAddingChange?.(open);
  };
  const [editing, setEditing] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const [listError, setListError] = React.useState("");
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  /**
   * Once a form closes, focus goes back to where it was opened from: the
   * row's Edit button, or "Add a link" (the heading when the page holds that
   * button, whose own focus the page keeps).
   */
  const focusAfterForm = (linkId?: string) =>
    requestAnimationFrame(() => {
      const edit = linkId ? document.getElementById(`${ids}-edit-${linkId}`) : null;
      const add = addingProp === undefined ? document.getElementById(`${ids}-add`) : null;
      (edit ?? add ?? headingRef.current)?.focus();
    });
  const report = React.useRef(onLinksChanged);
  React.useEffect(() => {
    report.current = onLinksChanged;
  });

  const reread = React.useCallback(async () => {
    const { links: fresh } = await getLessonLinks(courseSlug, stageKey);
    setLinks(fresh);
    report.current?.(fresh);
  }, [courseSlug, stageKey]);

  // The page handed the links over: no first load.
  const [seeded] = React.useState(initialLinks !== undefined);
  React.useEffect(() => {
    if (seeded) return;
    let cancelled = false;
    (async () => {
      try {
        const { links: fresh } = await getLessonLinks(courseSlug, stageKey);
        if (cancelled) return;
        setLinks(fresh);
        report.current?.(fresh);
      } catch {
        if (!cancelled) setListError("Couldn't load the further reading. Reload the page.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seeded, courseSlug, stageKey]);

  async function change(what: string, run: () => Promise<{ ok: boolean }>, done?: string) {
    setBusy(true);
    setListError("");
    setNotice("");
    try {
      const answer = await run();
      if (answer.ok) {
        if (done) setNotice(done);
      } else {
        setListError(`${what}: ${refusalMessage(answer as Exclude<ActionAnswer, { ok: true }>).text}`);
      }
      await reread();
    } catch {
      setListError(`${what}: the connection was interrupted or the server ran into a problem. Try again.`);
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= links.length) return;
    const next = [...links];
    [next[index], next[j]] = [next[j], next[index]];
    setLinks(next);
    await change("Couldn't save the new order", () => setLessonLinkOrder(courseSlug, stageKey, next.map((l) => l.id)));
  }

  return (
    <section aria-labelledby={`${ids}-h`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={`${ids}-h`} ref={headingRef} tabIndex={-1} className="flex items-center gap-1.5 text-sm font-semibold">
          <BookOpen className="h-4 w-4 text-[var(--accent)]" aria-hidden />
          Further reading
        </h4>
        {addingProp === undefined && !adding ? (
          <Button id={`${ids}-add`} type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add a link
          </Button>
        ) : null}
      </div>
      {hints.map((hint) => (
        <p key={hint} className="text-xs text-[var(--muted-foreground)]">
          {hint}
        </p>
      ))}

      {adding ? (
        <LinkForm
          label="Add a link"
          initial={EMPTY}
          busy={busy}
          onCancel={() => {
            setAdding(false);
            focusAfterForm();
          }}
          onSave={async (values, href) => {
            const answer = await addLessonLink(courseSlug, stageKey, {
              title: values.title,
              url: href,
              description: values.description,
              languages: values.languages,
            });
            if (answer.ok) {
              setAdding(false);
              setNotice(ADDED);
              focusAfterForm();
              await reread();
            }
            return answer;
          }}
        />
      ) : null}

      {links.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)]">No further reading on this lesson yet.</p>
      ) : (
        <ol className="space-y-1.5">
          {links.map((l, i) => (
            <li key={l.id} className="rounded-lg border border-[var(--border)] px-2 py-2 text-sm">
              {editing === l.id ? (
                <LinkForm
                  label={`Edit “${l.title}”`}
                  initial={formOf(l)}
                  busy={busy}
                  onCancel={() => {
                    setEditing(null);
                    focusAfterForm(l.id);
                  }}
                  onSave={async (values, href) => {
                    const answer = await updateLessonLink(l.id, {
                      title: values.title,
                      url: href,
                      description: values.description,
                      languages: values.languages,
                    });
                    if (answer.ok) {
                      setEditing(null);
                      focusAfterForm(l.id);
                      await reread();
                    }
                    return answer;
                  }}
                />
              ) : removing === l.id ? (
                <InlineConfirm
                  title={`Remove “${l.title}” from this lesson?`}
                  confirmLabel="Remove"
                  keepLabel="Keep it"
                  busy={busy}
                  error={null}
                  onKeep={() => {
                    setRemoving(null);
                    requestAnimationFrame(() => document.getElementById(`${ids}-remove-${l.id}`)?.focus());
                  }}
                  onConfirm={async () => {
                    headingRef.current?.focus();
                    setRemoving(null);
                    await change(`Couldn't remove “${l.title}”`, () => removeLessonLink(l.id), `Removed “${l.title}” from this lesson.`);
                  }}
                >
                  <p className="mt-1 text-xs">Learners will no longer see it.</p>
                </InlineConfirm>
              ) : (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <div className="flex flex-col flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0 || busy}
                      aria-label={`Move “${l.title}” up`}
                      className="text-[var(--muted-foreground)] hover:text-[var(--accent)] disabled:opacity-30"
                    >
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === links.length - 1 || busy}
                      aria-label={`Move “${l.title}” down`}
                      className="text-[var(--muted-foreground)] hover:text-[var(--accent)] disabled:opacity-30"
                    >
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                  <div className="min-w-[10rem] flex-1">
                    {l.unusable ? (
                      <>
                        <span className="font-medium">{l.title}</span>
                        <p className="break-all text-xs text-[var(--muted-foreground)]">{l.url}</p>
                        <p className="flex items-start gap-1 text-xs text-[var(--danger)]">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                          {UNUSABLE}
                        </p>
                      </>
                    ) : (
                      <>
                        <a href={l.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                          {l.title}
                        </a>
                        <p className="break-all text-xs text-[var(--muted-foreground)]">{linkPlace(l)}</p>
                      </>
                    )}
                  </div>
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                    <Badge variant="muted" className="text-[10px]">
                      {languagesBadge(l.languages)}
                    </Badge>
                    {l.published ? (
                      <Badge variant="success" className="text-[10px]">
                        Published
                      </Badge>
                    ) : (
                      <Badge variant="muted" className="text-[10px]">
                        Draft — hidden from learners
                      </Badge>
                    )}
                    <button
                      id={`${ids}-edit-${l.id}`}
                      type="button"
                      disabled={busy}
                      onClick={() => setEditing(l.id)}
                      aria-label={`Edit: ${l.title}`}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--surface-muted)]"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        change(
                          l.published ? `Couldn't hide “${l.title}” from learners` : `Couldn't show “${l.title}” to learners`,
                          () => setLessonLinkPublished(l.id, !l.published)
                        )
                      }
                      aria-label={l.published ? `Hide from learners: ${l.title}` : `Show to learners: ${l.title}`}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--surface-muted)]"
                    >
                      {l.published ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
                      {l.published ? "Hide from learners" : "Show to learners"}
                    </button>
                    <button
                      id={`${ids}-remove-${l.id}`}
                      type="button"
                      disabled={busy}
                      onClick={() => setRemoving(l.id)}
                      aria-label={`Remove: ${l.title}`}
                      className="rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <p role="status" aria-live="polite" className={notice ? "text-xs text-[var(--muted-foreground)]" : "sr-only"}>
        {notice}
      </p>
      {listError ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          {listError}
        </p>
      ) : null}
    </section>
  );
}

/**
 * The fields of one link: title, web address, short description and the
 * three language boxes. Problems are shown under their field, which
 * describes it (aria-describedby), and focus goes to the first; the http
 * warning shows under the address without stopping the save.
 */
function LinkForm({
  label,
  initial,
  busy,
  onSave,
  onCancel,
}: {
  label: string;
  initial: LinkFormValues;
  busy: boolean;
  onSave: (values: LinkFormValues, href: string) => Promise<ActionAnswer | { ok: true }>;
  onCancel: () => void;
}) {
  const ids = React.useId();
  const [values, setValues] = React.useState(initial);
  const [problems, setProblems] = React.useState<LinkFormProblems>({});
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const fields = React.useRef<Partial<Record<LinkFormField, HTMLElement | null>>>({});
  const titleRef = React.useRef<HTMLInputElement>(null);
  const insecure = React.useMemo(() => checkLinkForm(values).insecure, [values]);

  React.useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const show = (found: LinkFormProblems) => {
    setProblems(found);
    const first = (["title", "url", "description", "languages"] as const).find((f) => found[f]);
    if (first) fields.current[first]?.focus();
  };

  async function save() {
    if (saving || busy) return;
    setError("");
    const { problems: found, href } = checkLinkForm(values);
    if (Object.keys(found).length || !href) return show(found);
    setSaving(true);
    try {
      const answer = await onSave(values, href);
      if (!answer.ok) {
        const refused = refusalMessage(answer);
        if (refused.field) show({ [refused.field]: refused.text });
        else setError(refused.text);
      }
    } catch {
      setError("The connection was interrupted or the server ran into a problem. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void save();
    }
  };
  const described = (field: LinkFormField, extra?: string) =>
    [problems[field] ? `${ids}-${field}-p` : null, extra].filter(Boolean).join(" ") || undefined;
  const problem = (field: LinkFormField) =>
    problems[field] ? (
      <p id={`${ids}-${field}-p`} className="mt-1 flex items-start gap-1 text-xs text-[var(--danger)]">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
        {problems[field]}
      </p>
    ) : null;
  const input =
    "mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]";

  return (
    <div
      role="group"
      aria-label={label}
      className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div>
        <label htmlFor={`${ids}-title`} className="text-xs font-medium">
          Title
        </label>
        <input
          id={`${ids}-title`}
          ref={(el) => {
            titleRef.current = el;
            fields.current.title = el;
          }}
          type="text"
          value={values.title}
          onChange={(e) => setValues({ ...values, title: e.target.value })}
          onKeyDown={onEnter}
          aria-invalid={problems.title ? true : undefined}
          aria-describedby={described("title")}
          className={input}
        />
        {problem("title")}
      </div>
      <div>
        <label htmlFor={`${ids}-url`} className="text-xs font-medium">
          Web address
        </label>
        <input
          id={`${ids}-url`}
          ref={(el) => {
            fields.current.url = el;
          }}
          type="url"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          value={values.url}
          onChange={(e) => setValues({ ...values, url: e.target.value })}
          onKeyDown={onEnter}
          aria-invalid={problems.url ? true : undefined}
          aria-describedby={described("url", insecure ? `${ids}-http` : undefined)}
          className={input}
        />
        {problem("url")}
        {insecure ? (
          <p id={`${ids}-http`} className="mt-1 flex items-start gap-1 text-xs text-[var(--warning)]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
            {HTTP_WARNING}
          </p>
        ) : null}
      </div>
      <div>
        <label htmlFor={`${ids}-description`} className="text-xs font-medium">
          Short description (optional)
        </label>
        <textarea
          id={`${ids}-description`}
          ref={(el) => {
            fields.current.description = el;
          }}
          rows={2}
          value={values.description}
          onChange={(e) => setValues({ ...values, description: e.target.value })}
          aria-invalid={problems.description ? true : undefined}
          aria-describedby={described("description")}
          className={input}
        />
        {problem("description")}
      </div>
      <fieldset aria-describedby={described("languages")}>
        <legend className="text-xs font-medium">Languages</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {LANGUAGES.map((l, i) => (
            <label key={l.code} className="inline-flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                ref={
                  i === 0
                    ? (el) => {
                        fields.current.languages = el;
                      }
                    : undefined
                }
                checked={values.languages.includes(l.code)}
                onChange={(e) =>
                  setValues({
                    ...values,
                    languages: e.target.checked
                      ? LANGUAGES.map((x) => x.code).filter((c) => c === l.code || values.languages.includes(c))
                      : values.languages.filter((c) => c !== l.code),
                  })
                }
              />
              {l.name}
            </label>
          ))}
        </div>
        {problem("languages")}
      </fieldset>
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => void save()} aria-disabled={saving || busy ? true : undefined}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

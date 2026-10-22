"use client";

import * as React from "react";
import { checkLinkHref, emailAddressOf, MAX_HREF_CHARS, type LinkRefusal } from "@/lib/rich-text/link-url";
import { linkTextProblem, linkTextWarnings, toLinkInput, type LinkTextWarning } from "@/lib/rich-text/link-text";
import { ownFileHost } from "@/lib/rich-text/own-file-host";
import { cn } from "@/lib/utils";

/**
 * The lesson text editor's Link form (D106, spec 3.7): the words to link
 * and the address, as an inline panel under the toolbar, inside the editor
 * box and outside the text. Not modal (no focus trap). A labelled group,
 * never a <form>: the editor may sit inside one, and no browser validation
 * may block a bare "help@verein.de" or "www.bpb.de", which are completed
 * here (toLinkInput).
 *
 * - Apply (or Enter in either field): the address is completed, then
 *   checked (checkLinkHref, our own files refused), then the text against
 *   it (linkTextProblem). A refusal shows under its field, which gets focus.
 *   With no text, the link's text is its address.
 * - "Will open: …" describes the address field (not a live region).
 * - Warnings (http, vague or long link text) never refuse. They go to a
 *   polite status line only when one first appears (after a pause), when a
 *   field loses focus, or on Apply: each is announced once, not on every
 *   key.
 * - Escape cancels. When the editor box loses focus while the form holds
 *   input it didn't open with, the status line says it isn't applied yet.
 *
 * No Tiptap here: RichTextEditor applies the link. Authoring copy, English
 * (like the toolbar).
 */

export type LinkFormWarning = "http" | LinkTextWarning;

export type LinkFormCheck =
  | { ok: true; href: string; text: string; warnings: LinkFormWarning[] }
  | { ok: false; field: "address" | "text"; message: string };

const USE_WEB_OR_EMAIL = "Use an address starting with https:// or http://, or an email address.";

/** Why an address is refused, for authors. */
const REFUSAL: Record<LinkRefusal | "own-file", string> = {
  empty: USE_WEB_OR_EMAIL,
  characters: USE_WEB_OR_EMAIL,
  scheme: USE_WEB_OR_EMAIL,
  host: USE_WEB_OR_EMAIL,
  email: USE_WEB_OR_EMAIL,
  credentials: "Addresses can't contain a user name or password.",
  "too-long": `This address is too long (at most ${MAX_HREF_CHARS.toLocaleString("en")} characters).`,
  redirect:
    "This is an Outlook safe link, which carries the address of the mailbox it was sent to. Use the original address instead.",
  "own-file": "This is a file uploaded to the platform. Add it to the lesson as a document instead.",
};

const MISLEADING = "The text shows a different address than the link opens. Show the real address, or use a few words.";

export const WARNING: Record<LinkFormWarning, string> = {
  http: "This address isn't secure (http). Use https:// if the site offers it.",
  vague: "Link text like “click here” doesn't say where it goes. Use a few words that do.",
  long: "Long link text is hard to use with a screen reader. Link a few words.",
};

/** How a checked address is shown to authors: the address, or an email link's bare address. */
export const shownAddress = (href: string) => emailAddressOf(href) ?? href;

/** The form's rules, pure: what Apply does with `text` and `address` as typed. */
export function checkLinkForm({ text, address }: { text: string; address: string }): LinkFormCheck {
  const check = checkLinkHref(toLinkInput(address), { ownFileHost: ownFileHost() });
  if (!check.ok) return { ok: false, field: "address", message: REFUSAL[check.reason] };
  if (check.ownFile) return { ok: false, field: "address", message: REFUSAL["own-file"] };
  const given = text.trim() !== "";
  const shown = given ? text : shownAddress(check.href);
  if (linkTextProblem(shown, check.href) === "misleading") return { ok: false, field: "text", message: MISLEADING };
  const warnings: LinkFormWarning[] = [];
  if (check.insecure) warnings.push("http");
  if (given) warnings.push(...linkTextWarnings(text));
  return { ok: true, href: check.href, text: shown, warnings };
}

/** A pause after typing before a new warning is announced. */
const ANNOUNCE_AFTER_MS = 750;

export interface LinkFormProps {
  /** The group's id (the Link button's aria-controls); its fields' ids start with it. */
  id: string;
  /** What the form opens with: the selected text (or the link's), and the link's address. */
  initialText: string;
  initialAddress: string;
  /** The cursor is in a link: the form edits it, and offers Remove link. */
  editing: boolean;
  /** The field that gets focus when the form opens. */
  focus: "text" | "address";
  /** Goes up by one each time focus leaves the editor box (see RichTextEditor). */
  blurTick: number;
  /** A checked link: its text and normalised address. */
  onApply: (text: string, href: string) => void;
  onCancel: () => void;
  onRemove: () => void;
}

export function LinkForm({
  id,
  initialText,
  initialAddress,
  editing,
  focus,
  blurTick,
  onApply,
  onCancel,
  onRemove,
}: LinkFormProps) {
  const [text, setText] = React.useState(initialText);
  const [address, setAddress] = React.useState(initialAddress);
  const [error, setError] = React.useState<{ field: "address" | "text"; message: string } | null>(null);
  // The warnings last put in the status line, and the editor box's blur
  // count when the input last changed.
  const [announced, setAnnounced] = React.useState("");
  const [blurAtChange, setBlurAtChange] = React.useState(blurTick);
  const textRef = React.useRef<HTMLInputElement>(null);
  const addressRef = React.useRef<HTMLInputElement>(null);

  const ids = {
    text: `${id}-text`,
    address: `${id}-address`,
    willOpen: `${id}-will-open`,
    error: `${id}-error`,
  };

  const current = checkLinkForm({ text, address });
  const target = checkLinkHref(toLinkInput(address), { ownFileHost: ownFileHost() });
  const willOpen = target.ok && !target.ownFile ? shownAddress(target.href) : null;
  const warningText = current.ok ? current.warnings.map((w) => WARNING[w]).join(" ") : "";
  const dirty = text !== initialText || address !== initialAddress;
  // Focus left the editor box after the input last changed, not applied.
  const notApplied = dirty && blurTick !== blurAtChange;
  const status = [notApplied ? NOT_APPLIED : "", warningText ? announced : ""].filter(Boolean).join(" ");

  // Focus once, when the form opens.
  React.useEffect(() => {
    (focus === "address" ? addressRef : textRef).current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new warning goes to the status line once, after a pause in typing.
  React.useEffect(() => {
    if (!warningText || warningText === announced) return;
    const timer = setTimeout(() => setAnnounced(warningText), ANNOUNCE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [warningText, announced]);

  const changed = () => setBlurAtChange(blurTick);
  const announceNow = () => {
    if (warningText) setAnnounced(warningText);
  };

  const apply = () => {
    const result = checkLinkForm({ text, address });
    if (!result.ok) {
      setError({ field: result.field, message: result.message });
      (result.field === "address" ? addressRef : textRef).current?.focus();
      return;
    }
    announceNow();
    onApply(result.text, result.href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      // Never submits a form the editor sits in.
      e.preventDefault();
      apply();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  const describedBy = (field: "text" | "address", own?: string) =>
    [own, error?.field === field ? ids.error : null].filter(Boolean).join(" ") || undefined;
  const field =
    "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]";
  const errorLine = (which: "text" | "address") =>
    error?.field === which ? (
      <p id={ids.error} className="mt-1 text-xs text-[var(--danger)]">
        {error.message}
      </p>
    ) : null;

  return (
    <div
      id={id}
      role="group"
      aria-label="Link"
      className="space-y-2 border-b border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-2"
    >
      <div>
        <label htmlFor={ids.text} className="mb-0.5 block text-xs font-medium text-[var(--muted-foreground)]">
          Text to show
        </label>
        <input
          ref={textRef}
          id={ids.text}
          type="text"
          value={text}
          aria-invalid={error?.field === "text" || undefined}
          aria-describedby={describedBy("text")}
          onChange={(e) => {
            setText(e.target.value);
            changed();
            if (error?.field === "text") setError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={announceNow}
          className={field}
        />
        {errorLine("text")}
      </div>
      <div>
        <label htmlFor={ids.address} className="mb-0.5 block text-xs font-medium text-[var(--muted-foreground)]">
          Address
        </label>
        <input
          ref={addressRef}
          id={ids.address}
          type="url"
          value={address}
          spellCheck={false}
          autoComplete="off"
          inputMode="url"
          aria-invalid={error?.field === "address" || undefined}
          aria-describedby={describedBy("address", ids.willOpen)}
          onChange={(e) => {
            setAddress(e.target.value);
            changed();
            if (error?.field === "address") setError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={announceNow}
          className={field}
        />
        {errorLine("address")}
        <p id={ids.willOpen} className="mt-1 break-all text-xs text-[var(--muted-foreground)]">
          {willOpen ? `Will open: ${willOpen}` : null}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={apply}
          className="rounded-md bg-[var(--accent)] px-3 py-1 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-[var(--border)] px-3 py-1 text-sm hover:bg-[var(--surface)]"
        >
          Cancel
        </button>
        {editing ? (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md px-3 py-1 text-sm text-[var(--danger)] hover:bg-[var(--surface)]"
          >
            Remove link
          </button>
        ) : null}
      </div>
      {/* Always there, so screen readers hear it when it fills. */}
      <p role="status" className={cn("text-xs text-[var(--muted-foreground)]", !status && "sr-only")}>
        {status}
      </p>
    </div>
  );
}

const NOT_APPLIED = "Not applied yet: press Apply or Cancel.";

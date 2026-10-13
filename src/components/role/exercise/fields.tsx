"use client";

/**
 * The building blocks every exercise editor shares (StructureAuthor's three
 * Release 0 kinds, ReflectionPromptsEditor, RatingEditor): one text box per
 * language, the list of reasons that point to their boxes, and the context
 * that ties the two together. Each editor instance gets its own element ids
 * (React.useId), so several questions in one lesson never share an id.
 */

import * as React from "react";
import type { LocalizedText } from "@/lib/cms/structure";
import { STRUCTURE_LIMITS } from "@/lib/cms/structure-sanitize";
import type { Locale } from "@/lib/cms/types";

export const inputCls =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm aria-invalid:border-[var(--danger)]";

let idSeq = 0;
/** A new item id: letters and digits only, never one of the fixed "o1" / "p1" … ids. */
export const newId = (p: string) =>
  `${p}${(idSeq++).toString(36)}${Date.now().toString(36).slice(-3)}`;

export function setLoc(map: LocalizedText, locale: Locale, value: string): LocalizedText {
  return { ...map, [locale]: value };
}

/**
 * What the text boxes need to know about the reasons listed above them:
 * `idFor` gives each box (by its fieldKey) a stable element id, so a reason
 * can take the author to its box; `refused` maps each box a refused save
 * named (a "Save stage" reason, or a text over its size limit in the
 * language on screen) to the id of that reason, so the box is announced as
 * invalid, with the reason as its description.
 */
export interface FieldIssues {
  idFor: (field: string) => string;
  refused: ReadonlyMap<string, string>;
}

export const FieldIssuesContext = React.createContext<FieldIssues>({
  idFor: (field) => field,
  refused: new Map(),
});

/**
 * The reasons, each naming its box. A reason about one box (`field`, its
 * fieldKey) is a button that takes the author there, so it can be reached
 * by keyboard or voice from the list rather than by counting identical
 * boxes.
 */
export function IssueList({
  items,
  idFor,
  itemId,
}: {
  items: { text: string; field: string | null }[];
  idFor: (field: string) => string;
  /** Ids for the items, when boxes refer to them as their description. */
  itemId?: (i: number) => string;
}) {
  return (
    <ul className="mt-1 ml-6 list-disc text-sm text-[var(--foreground)] break-words">
      {items.map(({ text, field }, i) => (
        <li key={i} id={itemId?.(i)}>
          {field ? (
            <button
              type="button"
              onClick={() => document.getElementById(idFor(field))?.focus()}
              className="py-0.5 text-left underline underline-offset-2 hover:text-[var(--accent)]"
            >
              {text}
            </button>
          ) : (
            text
          )}
        </li>
      ))}
    </ul>
  );
}

/** One text, in the language being written; the other languages are kept as they are. */
export function LocField({
  label,
  map,
  locale,
  onChange,
  textarea,
  placeholder,
  maxLength = STRUCTURE_LIMITS.maxTextChars,
  field,
  context,
}: {
  label: string;
  map: LocalizedText;
  locale: Locale;
  onChange: (next: LocalizedText) => void;
  textarea?: boolean;
  placeholder?: string;
  /** The server's limit (STRUCTURE_LIMITS, PART_LIMITS): the box stops there. */
  maxLength?: number;
  /**
   * The fieldKey of this box: the key a reason or a size limit names it by,
   * so they can point to it.
   */
  field?: string;
  /**
   * The id of the caption this box belongs to ("Choice 2"), so its name
   * says which one it is: "Choice 2 Choice text", not one of several
   * identical "Choice text" boxes.
   */
  context?: string;
}) {
  const { idFor, refused } = React.useContext(FieldIssuesContext);
  const labelId = React.useId();
  const val = map[locale] ?? "";
  // The reason a refused save gave for this box, read out as its description.
  const reasonId = field ? refused.get(field) : undefined;
  const a11y = {
    id: field ? idFor(field) : undefined,
    "aria-labelledby": context ? `${context} ${labelId}` : undefined,
    "aria-invalid": reasonId ? true : undefined,
    "aria-describedby": reasonId,
    // The text is in the content language, whatever the menu's (WCAG 3.1.2).
    lang: locale,
  };
  return (
    <label className="block text-xs text-[var(--muted-foreground)]">
      <span id={labelId} className="block mb-1">
        {label}
      </span>
      {textarea ? (
        <textarea
          {...a11y}
          value={val}
          onChange={(e) => onChange(setLoc(map, locale, e.target.value))}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={2}
          className={inputCls}
        />
      ) : (
        <input
          {...a11y}
          value={val}
          onChange={(e) => onChange(setLoc(map, locale, e.target.value))}
          placeholder={placeholder}
          maxLength={maxLength}
          className={inputCls}
        />
      )}
    </label>
  );
}

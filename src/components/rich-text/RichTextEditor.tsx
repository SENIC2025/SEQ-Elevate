"use client";

import * as React from "react";
import { useLocale } from "next-intl";
import {
  EditorContent,
  useEditor,
  useEditorState,
  type ChainedCommands,
  type Editor,
  type JSONContent,
} from "@tiptap/react";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  AlertTriangle,
  Bold,
  Italic,
  Link2,
  List,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  Redo2,
  Undo2,
  Unlink2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { legacyTextToDoc } from "@/lib/rich-text/from-legacy";
import { edgeBlanks } from "@/lib/rich-text/link-blanks";
import {
  linkProblemMessage,
  richTextProblem,
  sanitizeRichText,
  type LinkProblem,
  type RtAdvice,
  type RtIssue,
  type RtSanitized,
} from "@/lib/rich-text/sanitize";
import { docToPlainText } from "@/lib/rich-text/to-plain";
import { RT_LIMITS, type RichText, type RtDoc } from "@/lib/rich-text/types";
import { editorExtensions, plainTextSlice } from "./editor-extensions";
import { linkRange, newLinkHref } from "./link-extension";
import { LinkForm, shownAddress } from "./LinkForm";
import { cleanPastedHtmlWithReport } from "./paste-cleanup";
import { pasteNotes } from "./paste-links";

export interface RichTextEditorProps {
  /** The block's stored rich text, as saved (it is sanitized before use). */
  rich?: unknown;
  /** The block's plain text: what the editor opens without a readable `rich`. */
  text?: string;
  /**
   * A paragraph, a key message, a reflection lesson's introduction or a
   * course's references list: its look (the learner's) and names.
   */
  variant: "paragraph" | "callout" | "reflection-intro" | "references";
  /**
   * The id of a visible label for the text, which then names it (instead of
   * the variant's own name), as a form field's label would.
   */
  labelledBy?: string;
  /** Put the cursor at the end of the text once the editor is ready. */
  autoFocus?: boolean;
  /**
   * The language the text is written in: the editable text carries it
   * (default: the page's). The editor's own words (toolbar, tip, messages)
   * are English on every locale's page and are marked lang="en" (WCAG 3.1.2).
   */
  lang?: string;
  /**
   * After every edit: the new rich text and its plain text. When the text
   * can't be stored (too long, say, or with a link that can't be used) the
   * editor says so, and still passes on what the author sees — Save then
   * names the block instead of quietly storing an older version, or the
   * text without its link.
   */
  onChange: (rich: RichText, text: string) => void;
}

interface VariantSpec {
  name: string;
  subject: string;
  label: string;
  placeholder: string;
  prose: string;
  box: string;
  advice: RtAdvice;
  indent: boolean;
}

/**
 * Per kind of text. `prose` holds the classes of the learner's element
 * (NarrativeStage, ReflectionIntro), so the text looks the same while it is
 * edited; editor-schema.test.ts checks they haven't drifted apart.
 * `advice`: what the problem line tells an author to do about text that
 * can't be saved (RT_ADVICE): split a lesson's block, shorten a text of its
 * own. `indent`: whether a paragraph takes indent steps (the references
 * list's layout hangs every entry alike, so it has none).
 */
export const VARIANT = {
  paragraph: {
    name: "Paragraph",
    subject: "This paragraph",
    advice: "block",
    indent: true,
    label: "Paragraph text",
    placeholder: "Write the paragraph…",
    prose: "text-base leading-relaxed",
    box: "px-3 py-2",
  },
  callout: {
    name: "Key message",
    subject: "This key message",
    advice: "block",
    indent: true,
    label: "Key message text",
    placeholder: "The one point learners should remember",
    prose: "seq-prose-compact font-medium text-[var(--accent)]",
    // The learner's highlighted box, at full width while editing.
    box: "m-2 rounded-lg border border-[var(--accent)]/20 bg-[var(--primary)]/10 px-4 py-3",
  },
  "reflection-intro": {
    name: "Introduction",
    subject: "This introduction",
    // A reflection lesson's one text: it can't be split into blocks.
    advice: "text",
    indent: true,
    label: "Introduction",
    placeholder: "Write a short introduction…",
    prose: "text-sm text-[var(--muted-foreground)]",
    box: "px-3 py-2",
  },
  // A course's references and bibliography (D109): set as the learner's
  // references page sets it (.seq-references, a hanging indent per entry,
  // so an entry has no indent of its own). One list per language.
  references: {
    name: "References",
    subject: "The references list",
    advice: "list",
    indent: false,
    label: "References & bibliography",
    placeholder: "Write the paragraph…",
    prose: "seq-references",
    box: "px-3 py-2",
  },
} as const satisfies Record<RichTextEditorProps["variant"], VariantSpec>;

/**
 * The lesson text editor for one paragraph, key message or reflection
 * introduction (D36): bold, italic, links, bulleted and numbered lists,
 * indent, undo — the formatting learners see, drawn with the same .seq-prose
 * styles, and nothing else.
 *
 * - It opens `rich` when that reads as version 1 or 2, otherwise `text` by
 *   the rules learners already see (Round 1), so an old block shows the
 *   paragraphs and lists it had. It only becomes rich text once edited:
 *   Tiptap calls onUpdate for real edits only.
 * - Uncontrolled after it mounts: the parent remounts it (a new key) to
 *   start over, e.g. on "Discard changes" or another language.
 * - Pasting: Word and Google Docs HTML is tidied (paste-cleanup.ts) and read
 *   against the schema, which keeps only the formatting above; the status
 *   line says how many links weren't kept, and why, until the text next
 *   changes (an undo included). Plain text with line breaks follows Round
 *   1's rules ("•" and "1." lines are lists).
 * - Links (D104, D106): Link (Ctrl+K, ⌘K) opens the Link form (LinkForm)
 *   for the selected words, or for the link the cursor is in; Remove link
 *   takes the whole link off. Where a link goes shows under the toolbar
 *   while the cursor is in it. A link that can't be saved — its address
 *   refused, its text showing another address, a file of our own — is
 *   named at once, and the text goes up with it, so Save refuses it by name
 *   rather than storing the text without the link the author sees. A
 *   stored link the check refuses is left out when the editor opens, and
 *   the status line names it.
 * - Keyboard: the usual shortcuts; Tab and Shift+Tab move a list point in
 *   and out (and leave the editor at the deepest level or outside lists);
 *   Escape or Alt+F10 goes to the toolbar. Ctrl+K on words across
 *   paragraphs says in the status line why it can't link them.
 *
 * Authoring only: it imports Tiptap, so it is loaded through
 * LazyRichTextEditor and never reaches learner pages.
 */
export function RichTextEditor({
  rich,
  text,
  variant,
  labelledBy,
  autoFocus = false,
  lang,
  onChange,
}: RichTextEditorProps) {
  const v = VARIANT[variant];
  const pageLang = useLocale();
  // Read on every update of the editor (its attributes below), so the text
  // follows its language when the parent's changes (a save that turns
  // another language's text into this one's).
  const textLang = React.useRef(lang ?? pageLang);
  React.useEffect(() => {
    textLang.current = lang ?? pageLang;
  }, [lang, pageLang]);
  const ids = React.useId();
  const toolbarRef = React.useRef<HTMLDivElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  // Set once: the editor keeps its own state after it mounts.
  const [opening] = React.useState(() => openingDoc(rich, text, { indent: v.indent }));
  const [problem, setProblem] = React.useState(() => problemLine(variant, opening));
  const [flattened, setFlattened] = React.useState(false);
  // The status line's notes: after a paste, or the links left out when the
  // editor opened. They stay until the text next changes otherwise (the
  // paste's own change aside: `pasting`).
  const [notes, setNotes] = React.useState<string[]>([]);
  const pasting = React.useRef(false);
  // Why Ctrl+K did nothing, until the selection or the text changes.
  const [hint, setHint] = React.useState<string | null>(null);
  const [linkForm, setLinkForm] = React.useState<LinkFormState | null>(null);
  const [blurTick, setBlurTick] = React.useState(0);
  // Where the Link form's link goes, and the selection it opened on: kept
  // in step with every change to the text while it is open.
  const linkAt = React.useRef<{ from: number; to: number } | null>(null);
  const selectionAt = React.useRef<{ from: number; to: number } | null>(null);
  // Ctrl+K, from the editor's own key handler.
  const openLink = React.useRef<() => void>(() => {});

  const [options] = React.useState(() => ({
    content: opening.doc,
    extensions: editorExtensions(v.placeholder, { indent: v.indent }),
    editorProps: {
      attributes: () => ({
        // rt-editor (globals.css): the height, the empty editor's hint, and
        // no gap above a list point's first line — the editor holds it in a
        // <p>, learners see it right inside the <li>.
        class: cn("seq-prose rt-editor", v.prose),
        // The text's language; the editor's own words around it are English.
        lang: textLang.current,
        role: "textbox",
        "aria-multiline": "true",
        ...(labelledBy
          ? { "aria-labelledby": labelledBy }
          : { "aria-label": v.label }),
        "aria-describedby": `${ids}-tip ${ids}-keys`,
        // Where BlockEditor puts focus when it's asked to.
        "data-block-field": "",
      }),
      transformPastedHTML: (html: string) => {
        const cleaned = cleanPastedHtmlWithReport(html);
        setNotes(pasteNotes(cleaned));
        pasting.current = true;
        return cleaned.html;
      },
      handlePaste: pastePlainText,
      handleKeyDown: (_view: EditorView, event: KeyboardEvent) => {
        if (event.isComposing) return false;
        if (event.key === "Escape" || (event.altKey && event.key === "F10")) {
          toolbarRef.current
            ?.querySelector<HTMLButtonElement>('button[tabindex="0"]')
            ?.focus();
          return true;
        }
        // Ctrl+K / ⌘K: the Link form (and never the browser's search box).
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
          event.preventDefault();
          openLink.current();
          return true;
        }
        return false;
      },
    },
  }));

  const editor = useEditor({
    immediatelyRender: false,
    ...options,
    onUpdate: ({ editor: e }) => {
      const doc = e.getJSON();
      const sanitized = sanitizeRichText({ v: 1, doc });
      setProblem(problemLine(variant, sanitized));
      setFlattened(sanitized.issues.includes("list-flattened"));
      const { rich: changed, text: plain } = editorChange(doc, sanitized, () => e.getText({ blockSeparator: "\n\n" }));
      onChange(changed, plain);
    },
  });

  // Keep the Link form's place as the text around it changes. A note is
  // about the text as it was, so it goes once the text changes (a paste's
  // own change aside), and a hint once the text or the selection does.
  React.useEffect(() => {
    if (!editor) return;
    const follow = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged || transaction.selectionSet) setHint(null);
      if (!transaction.docChanged) return;
      if (pasting.current) pasting.current = false;
      else setNotes((was) => (was.length ? [] : was));
      for (const at of [linkAt, selectionAt]) {
        if (at.current) {
          const from = transaction.mapping.map(at.current.from, 1);
          const to = Math.max(from, transaction.mapping.map(at.current.to, -1));
          at.current = { from, to };
        }
      }
    };
    editor.on("transaction", follow);
    return () => {
      editor.off("transaction", follow);
    };
  }, [editor]);

  const forgetLinkForm = () => {
    setLinkForm(null);
    linkAt.current = null;
    selectionAt.current = null;
  };

  /** Close the Link form without a change; the cursor goes back to the text, at `focusAt` when given. */
  const closeLinkForm = (focusAt?: { from: number; to: number }) => {
    forgetLinkForm();
    if (!editor) return;
    const chain = editor.chain().focus();
    if (focusAt) chain.setTextSelection(focusAt);
    chain.run();
  };

  /**
   * Open the Link form for the selection, or for the link the cursor is in;
   * when the selection spans paragraphs, the status line says why it can't.
   */
  const openLinkForm = () => {
    if (!editor) return;
    if (!canLinkSelection(editor)) {
      setHint(CANT_LINK);
      return;
    }
    setHint(null);
    const { state } = editor;
    const selection = state.selection;
    const range = linkRange(state) ?? { from: selection.from, to: selection.to };
    const href = firstLinkHref(editor, range);
    linkAt.current = range;
    selectionAt.current = { from: selection.from, to: selection.to };
    setLinkForm((was) => ({
      key: (was?.key ?? 0) + 1,
      text: state.doc.textBetween(range.from, range.to, " ", " "),
      address: href ?? "",
      editing: href !== null,
      focus: !selection.empty || href !== null ? "address" : "text",
    }));
  };
  // Ctrl+K reaches it through the editor's key handler, set up once.
  React.useEffect(() => {
    openLink.current = openLinkForm;
  });

  const toggleLinkForm = () => {
    if (linkForm) closeLinkForm(selectionAt.current ?? undefined);
    else openLinkForm();
  };

  /**
   * Apply the form: unchanged words keep their formatting and get the link
   * (any links they had give way); new words take the formatting the
   * selection started with, plus the link. Blanks at either end of the
   * words stay in the text, outside the link (link-blanks.ts: a word
   * selected with the space after it). The cursor goes right after them.
   * (The words lie in one paragraph or list point, so each character of
   * them, a line break's too, is one position.)
   */
  const applyLink = (shown: string, href: string) => {
    const range = linkAt.current;
    if (!editor || !range) return;
    const { from, to } = range;
    const before = editor.state.doc.textBetween(from, to, " ", " ");
    const { lead, trail } = edgeBlanks(shown);
    const chain = editor.chain().focus();
    let end: number;
    if (from < to && shown === before) {
      chain
        .setTextSelection({ from, to })
        .unsetMark("link")
        .setTextSelection({ from: from + lead, to: to - trail })
        .setLessonLink({ href });
      end = to;
    } else {
      const marks = (editor.state.doc.nodeAt(from)?.marks ?? editor.state.selection.$from.marks())
        .filter((mark) => mark.type.name !== "link")
        .map((mark) => mark.toJSON());
      chain
        .insertContentAt({ from, to }, { type: "text", text: shown, marks })
        .setTextSelection({ from: from + lead, to: from + shown.length - trail })
        .setLessonLink({ href });
      end = from + shown.length;
    }
    chain.setTextSelection(end).run();
    forgetLinkForm();
  };

  const removeLink = () => {
    const range = linkAt.current;
    if (!editor || !range) return;
    editor.chain().focus().setTextSelection(range).unsetLessonLink().setTextSelection(range.to).run();
    forgetLinkForm();
  };

  // Once, when it's first on the page (Tiptap's own autofocus can run
  // before React has put the editor in place).
  const [focusOnMount] = React.useState(autoFocus);
  React.useEffect(() => {
    if (editor && focusOnMount) editor.commands.focus("end");
  }, [editor, focusOnMount]);

  // Links the editor left out when it opened, named just after it is on
  // the page, so screen readers hear the status line fill.
  const [removedNote] = React.useState(() => removedLinksNote(opening.removedLinks));
  React.useEffect(() => {
    if (!editor || !removedNote) return;
    const timer = setTimeout(() => setNotes([removedNote]), 0);
    return () => clearTimeout(timer);
  }, [editor, removedNote]);

  if (!editor) return <EditorLoading />;

  const status = [
    flattened ? "Points nested more than 3 levels deep show at the third level for learners." : null,
    hint,
    ...notes,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={boxRef}
      lang="en"
      onBlur={(e) => {
        // Focus left the editor box (not just moved inside it).
        if (!boxRef.current?.contains(e.relatedTarget as Node | null)) setBlurTick((n) => n + 1);
      }}
      className="rounded-md border border-[var(--border)] bg-[var(--surface)]"
    >
      <Toolbar
        editor={editor}
        name={v.name}
        indent={v.indent}
        toolbarRef={toolbarRef}
        link={{
          formId: `${ids}-link-form`,
          lineId: `${ids}-link-line`,
          open: linkForm !== null,
          toggle: toggleLinkForm,
        }}
      />
      <LinkLine editor={editor} id={`${ids}-link-line`} />
      {linkForm ? (
        <LinkForm
          key={linkForm.key}
          id={`${ids}-link-form`}
          initialText={linkForm.text}
          initialAddress={linkForm.address}
          editing={linkForm.editing}
          focus={linkForm.focus}
          blurTick={blurTick}
          onApply={applyLink}
          onCancel={() => closeLinkForm(selectionAt.current ?? undefined)}
          onRemove={removeLink}
        />
      ) : null}
      <p
        id={`${ids}-tip`}
        className="border-b border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)]"
      >
        Tip: paste from Word or Google Docs with Ctrl+V (⌘V on Mac) — bold,
        italic, lists and links are kept, other formatting is tidied away.
      </p>
      <span id={`${ids}-keys`} className="sr-only">
        Tab and Shift+Tab move a list point in and out. Ctrl+K (⌘K on Mac)
        adds a link. Press Escape for the formatting toolbar.
      </span>
      <div className={v.box}>
        <EditorContent editor={editor} />
      </div>
      {problem ? (
        <p
          role="alert"
          className="flex items-start gap-1.5 border-t border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--danger)]"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          {problem}
        </p>
      ) : null}
      {/* Always there, so screen readers hear it when it fills. */}
      <p
        role="status"
        className="border-t border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] empty:border-0 empty:p-0"
      >
        {status || null}
      </p>
    </div>
  );
}

/** What the Link form opened with (see LinkForm). */
interface LinkFormState {
  /** A new form each time it opens. */
  key: number;
  text: string;
  address: string;
  editing: boolean;
  focus: "text" | "address";
}

/** Why Link can't be used on the selection: the status line's words for Ctrl+K, the Link button's tooltip. */
const CANT_LINK = "Select words in one paragraph to link them.";

/** The first link problem, as the editor says it ("The link “…” can't be used. …"), or null. */
function firstLinkProblem(problems: readonly LinkProblem[]): string | null {
  return problems.length ? linkProblemMessage(problems[0]) : null;
}

/**
 * The problem line of a `variant`'s editor for its text (as sanitized, or
 * as it opened): why the text can't be saved, with what to do about it as
 * that text allows (VARIANT's advice); else the first link a save would
 * refuse; else null.
 */
export function problemLine(
  variant: RichTextEditorProps["variant"],
  text: { issues: readonly RtIssue[]; hasLinks: boolean; linkProblems: readonly LinkProblem[] }
): string | null {
  const v = VARIANT[variant];
  return richTextProblem(text.issues, v.subject, text.hasLinks, v.advice) ?? firstLinkProblem(text.linkProblems);
}

/** Whether the selection lies within one paragraph or list point: only then can it be linked. */
function canLinkSelection(editor: Editor): boolean {
  const { $from, $to } = editor.state.selection;
  return $from.sameParent($to) && $from.parent.isTextblock;
}

/** The address of the first link in `range`, or null. */
function firstLinkHref(editor: Editor, range: { from: number; to: number }): string | null {
  let href: string | null = null;
  const type = editor.state.schema.marks.link;
  const check = (marks: readonly { type: unknown; attrs: Record<string, unknown> }[]) => {
    const mark = marks.find((m) => m.type === type);
    if (href === null && mark && typeof mark.attrs.href === "string") href = mark.attrs.href;
  };
  if (range.from === range.to) check(editor.state.selection.$from.marks());
  editor.state.doc.nodesBetween(range.from, range.to, (node) => {
    if (href !== null) return false;
    if (node.isText) check(node.marks);
    return true;
  });
  return href;
}

/**
 * While the cursor is in a link: "Link: https://example.org/guide" (an
 * email link's bare address), so authors can check where it goes without
 * opening the form. Plain text, not a live region; the Link button points
 * at it (aria-describedby).
 */
function LinkLine({ editor, id }: { editor: Editor; id: string }) {
  const href = useEditorState({
    editor,
    selector: ({ editor: e }) => (e.isActive("link") ? ((e.getAttributes("link").href as unknown) ?? null) : null),
  });
  if (href === null) return null;
  const checked = newLinkHref(href);
  return (
    <p
      id={id}
      className="break-all border-b border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-foreground)]"
    >
      {checked === null ? "Link: this address can't be used" : `Link: ${shownAddress(checked)}`}
    </p>
  );
}

/**
 * What the editor opens: the stored doc, sanitized (the schema would throw
 * on anything unknown). One over a limit — a block copied or put back while
 * the author was still shortening it — opens as it is, with its problem
 * shown, rather than empty; unless it holds a link (D104), whose address
 * nothing would have checked: it opens as its plain text instead, with the
 * problem. Anything else opens the plain text by Round 1's rules.
 * (The link mark checks every address it draws too, link-extension.ts.)
 *
 * `linkProblems`: links it keeps that a save would refuse (our own files),
 * named at once; `removedLinks`: links it left out (removedLinksNote).
 * With `indent: false` (VARIANT) its paragraphs open without indent steps.
 */
export function openingDoc(rich: unknown, text: string | undefined, { indent = true }: { indent?: boolean } = {}): OpeningDoc {
  const opened = openingDocAsStored(rich, text);
  return indent ? opened : { ...opened, doc: withoutIndent(opened.doc) };
}

/** A doc's paragraphs without indent steps (only top-level paragraphs have one). */
function withoutIndent(doc: JSONContent): JSONContent {
  return {
    ...doc,
    content: doc.content?.map((block) => {
      if (block.type !== "paragraph" || block.attrs?.indent === undefined) return block;
      const copy: JSONContent = { ...block, attrs: { ...block.attrs } };
      delete copy.attrs!.indent;
      if (!Object.keys(copy.attrs!).length) delete copy.attrs;
      return copy;
    }),
  };
}

/** What the editor opens with (openingDoc). */
interface OpeningDoc {
  doc: JSONContent;
  issues: RtIssue[];
  hasLinks: boolean;
  linkProblems: LinkProblem[];
  removedLinks: LinkProblem[];
}

function openingDocAsStored(rich: unknown, text: string | undefined): OpeningDoc {
  const { value, issues, hasLinks, linkProblems } = sanitizeRichText(rich);
  if (value) {
    const ownFile = linkProblems.filter((problem) => problem.reason === "own-file");
    const removed = linkProblems.filter((problem) => problem.reason !== "own-file");
    return { doc: value.doc, issues: [], hasLinks, linkProblems: ownFile, removedLinks: removed };
  }
  if (!issues.includes("bad-envelope")) {
    // Past the envelope check, so `rich` is { v: 1 or 2, doc: { type: "doc", … } }.
    const doc = (rich as { doc: JSONContent }).doc;
    if (mayHoldLink(doc)) return { doc: legacyTextToDoc(text), issues, hasLinks: true, linkProblems: [], removedLinks: [] };
    return { doc, issues, hasLinks, linkProblems: [], removedLinks: [] };
  }
  return { doc: legacyTextToDoc(text), issues: [], hasLinks: false, linkProblems: [], removedLinks: [] };
}

/**
 * The status line's note for stored links the editor left out when it
 * opened (openingDoc's removedLinks), naming the first; null for none. The
 * next save stores the text without them, so the author is told once.
 */
export function removedLinksNote(removed: readonly LinkProblem[]): string | null {
  if (!removed.length) return null;
  if (removed.length === 1) {
    return `The link “${removed[0].text}” can't be used and was removed. Add it again with the Link button.`;
  }
  return `Links that can't be used were removed, the first “${removed[0].text}”. Add them again with the Link button.`;
}

/**
 * What the editor hands up after an edit (`doc`: the editor's JSON;
 * `sanitized`: it through the sanitizer): text that can be saved as it is,
 * with its plain text; otherwise the text as the author sees it, so Save
 * names what it can't store rather than quietly storing an older version,
 * or the text without its link. Its plain text still carries the words (a
 * version-2 envelope beside them is what an older save keeps, as the
 * paragraph's text): through the sanitizer when it read the text, or else
 * (text over a limit) from the doc as it is, by `fallback` if that fails.
 * As plain JSON: ProseMirror's attribute objects have no prototype, and a
 * server action would receive them as opaque references, unreadable.
 */
export function editorChange(
  doc: JSONContent,
  sanitized: RtSanitized,
  fallback: () => string = () => ""
): { rich: RichText; text: string } {
  const { value, linkProblems, hasLinks } = sanitized;
  if (value && linkProblems.length === 0) return { rich: value, text: docToPlainText(value.doc) };
  const rich = { v: hasLinks ? 2 : 1, doc: JSON.parse(JSON.stringify(doc)) } as RichText;
  if (value) return { rich, text: docToPlainText(value.doc) };
  try {
    return { rich, text: docToPlainText(doc as RtDoc) };
  } catch {
    return { rich, text: fallback() };
  }
}

/**
 * Whether a doc holds a link mark, looking at no more than four times the
 * node limit of nodes and marks; running out counts as finding one. A work
 * stack, never recursion; anything that isn't a node is skipped.
 */
function mayHoldLink(doc: unknown): boolean {
  let budget = 4 * RT_LIMITS.maxNodes;
  const stack: unknown[] = [doc];
  try {
    while (stack.length) {
      if (--budget < 0) return true;
      const node = stack.pop();
      if (typeof node !== "object" || node === null) continue;
      const { marks, content } = node as { marks?: unknown; content?: unknown };
      if (Array.isArray(marks)) {
        for (const mark of marks) {
          if (--budget < 0) return true;
          if (typeof mark === "object" && mark !== null && (mark as { type?: unknown }).type === "link") return true;
        }
      }
      if (Array.isArray(content)) {
        if (content.length > budget) return true;
        for (let i = content.length - 1; i >= 0; i--) stack.push(content[i]);
      }
    }
  } catch {
    // A throwing getter: nothing here can be trusted.
    return true;
  }
  return false;
}

/** While the editor starts: LazyRichTextEditor's box, an empty editor's size. */
function EditorLoading() {
  return (
    <div
      aria-busy="true"
      lang="en"
      className="min-h-[8.5rem] animate-pulse rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--muted-foreground)]"
    >
      Opening the text editor…
    </div>
  );
}

/**
 * A paste of plain text only: with line breaks, by the rules learners know
 * (plainTextSlice). HTML — Word, Google Docs, web pages — goes through
 * cleanPastedHtml and the schema instead, and a single line is pasted as it
 * is. Handled here, ahead of the numbered-list extension's own plain-text
 * paste, so there is one set of rules.
 */
function pastePlainText(view: EditorView, event: ClipboardEvent): boolean {
  const data = event.clipboardData;
  if (!data || data.getData("text/html").trim()) return false;
  try {
    const slice = plainTextSlice(view.state.schema, data.getData("text/plain"));
    if (!slice) return false;
    view.dispatch(
      view.state.tr
        .replaceSelection(slice)
        .scrollIntoView()
        .setMeta("paste", true)
        .setMeta("uiEvent", "paste")
    );
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------- Toolbar -------------------------------- */

interface ToolState {
  bold: boolean;
  italic: boolean;
  /** The cursor is in a link (or the selection starts in one). */
  inLink: boolean;
  /** The selection lies within one paragraph or list point. */
  canLink: boolean;
  /** The list the cursor is in (the innermost one). */
  list: "bulletList" | "orderedList" | null;
  canIndent: boolean;
  canOutdent: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

interface Tool {
  /** Stable, for React. */
  id: string;
  label: string | ((s: ToolState) => string);
  icon: LucideIcon;
  /** aria-keyshortcuts. */
  keys: string;
  /** The shortcut as shown in the tooltip, [Windows/Linux, Mac]. */
  hint: [string, string];
  /** Why it can't be used now, as its tooltip. */
  disabledHint?: string;
  pressed?: (s: ToolState) => boolean;
  enabled?: (s: ToolState) => boolean;
  /** An editor command; or "link", which opens and closes the Link form. */
  run: ((chain: ChainedCommands) => ChainedCommands) | "link";
  /** Starts a new group (a divider before it). */
  group?: boolean;
}

const TOOLS: readonly Tool[] = [
  {
    id: "bold",
    label: "Bold",
    icon: Bold,
    keys: "Control+B Meta+B",
    hint: ["Ctrl+B", "⌘B"],
    pressed: (s) => s.bold,
    run: (c) => c.toggleBold(),
  },
  {
    id: "italic",
    label: "Italic",
    icon: Italic,
    keys: "Control+I Meta+I",
    hint: ["Ctrl+I", "⌘I"],
    pressed: (s) => s.italic,
    run: (c) => c.toggleItalic(),
  },
  {
    // Opens a form rather than toggling: aria-expanded, no aria-pressed.
    id: "link",
    label: (s) => (s.inLink ? "Edit link" : "Link"),
    icon: Link2,
    keys: "Control+K Meta+K",
    hint: ["Ctrl+K", "⌘K"],
    disabledHint: CANT_LINK,
    enabled: (s) => s.canLink,
    run: "link",
  },
  {
    id: "unlink",
    label: "Remove link",
    icon: Unlink2,
    keys: "",
    hint: ["", ""],
    enabled: (s) => s.inLink,
    run: (c) => c.unsetLessonLink(),
  },
  {
    id: "bullets",
    label: "Bulleted list",
    icon: List,
    keys: "Control+Shift+8 Meta+Shift+8",
    hint: ["Ctrl+Shift+8", "⇧⌘8"],
    pressed: (s) => s.list === "bulletList",
    run: (c) => c.toggleBulletList(),
    group: true,
  },
  {
    id: "numbers",
    label: "Numbered list",
    icon: ListOrdered,
    keys: "Control+Shift+7 Meta+Shift+7",
    hint: ["Ctrl+Shift+7", "⇧⌘7"],
    pressed: (s) => s.list === "orderedList",
    run: (c) => c.toggleOrderedList(),
  },
  {
    id: "outdent",
    label: "Decrease indent",
    icon: ListIndentDecrease,
    keys: "Control+[ Meta+[",
    hint: ["Ctrl+[", "⌘["],
    enabled: (s) => s.canOutdent,
    run: (c) => c.outdent(),
    group: true,
  },
  {
    id: "indent",
    label: "Increase indent",
    icon: ListIndentIncrease,
    keys: "Control+] Meta+]",
    hint: ["Ctrl+]", "⌘]"],
    enabled: (s) => s.canIndent,
    run: (c) => c.indent(),
  },
  {
    id: "undo",
    label: "Undo",
    icon: Undo2,
    keys: "Control+Z Meta+Z",
    hint: ["Ctrl+Z", "⌘Z"],
    enabled: (s) => s.canUndo,
    run: (c) => c.undo(),
    group: true,
  },
  {
    id: "redo",
    label: "Redo",
    icon: Redo2,
    keys: "Control+Shift+Z Meta+Shift+Z",
    hint: ["Ctrl+Shift+Z", "⇧⌘Z"],
    enabled: (s) => s.canRedo,
    run: (c) => c.redo(),
  },
];

/**
 * The toolbar's buttons: every tool, or (`indent` false: the references
 * list, whose entries all hang alike) every tool but the two Indent buttons.
 */
export function toolbarTools(indent: boolean): readonly Tool[] {
  return indent ? TOOLS : TOOLS.filter((tool) => tool.id !== "indent" && tool.id !== "outdent");
}

function innermostList(editor: Editor): ToolState["list"] {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === "bulletList" || name === "orderedList") return name;
  }
  return null;
}

const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);

/**
 * The formatting buttons: one Tab stop, arrow keys (and Home / End) move
 * between them (a roving tabindex, WAI-ARIA toolbar pattern). A mouse click
 * leaves the cursor where it was; from the keyboard a button acts, then
 * returns to the text. Link opens the Link form instead (focus goes to it).
 */
function Toolbar({
  editor,
  name,
  indent,
  toolbarRef,
  link,
}: {
  editor: Editor;
  name: string;
  /** Whether paragraphs take indent steps here (VARIANT): else no Indent buttons. */
  indent: boolean;
  toolbarRef: React.RefObject<HTMLDivElement | null>;
  link: {
    /** The Link form's id, while it is open (aria-controls). */
    formId: string;
    /** The "Link: …" line's id, while the cursor is in a link. */
    lineId: string;
    open: boolean;
    toggle: () => void;
  };
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }): ToolState => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      inLink: e.isActive("link"),
      canLink: canLinkSelection(e),
      list: innermostList(e),
      canIndent: e.can().indent(),
      canOutdent: e.can().outdent(),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const [mac] = React.useState(isMac);
  const buttons = React.useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = React.useState(0);

  const tools = toolbarTools(indent);
  const enabled = tools.map((t) => (t.enabled ? t.enabled(state) : true));
  // The one button Tab reaches: the last one used, while it can be used.
  const tabStop = enabled[active] ? active : enabled.indexOf(true);

  function move(e: React.KeyboardEvent) {
    const order = tools.map((_, i) => i).filter((i) => enabled[i]);
    const at = Math.max(0, order.indexOf(tabStop));
    const next =
      e.key === "ArrowRight"
        ? order[(at + 1) % order.length]
        : e.key === "ArrowLeft"
          ? order[(at - 1 + order.length) % order.length]
          : e.key === "Home"
            ? order[0]
            : e.key === "End"
              ? order[order.length - 1]
              : undefined;
    if (next === undefined) return;
    e.preventDefault();
    setActive(next);
    buttons.current[next]?.focus();
  }

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label={`${name} formatting`}
      onKeyDown={move}
      className="flex flex-wrap items-center gap-0.5 border-b border-[var(--border)] px-1 py-1"
    >
      {tools.map((tool, i) => {
        const Icon = tool.icon;
        const pressed = tool.pressed?.(state);
        const label = typeof tool.label === "function" ? tool.label(state) : tool.label;
        const isLink = tool.run === "link";
        const hint = tool.hint[mac ? 1 : 0];
        return (
          <React.Fragment key={tool.id}>
            {tool.group ? (
              <span
                aria-hidden
                className="mx-1 h-5 w-px bg-[var(--border)]"
              />
            ) : null}
            <button
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              tabIndex={i === tabStop ? 0 : -1}
              disabled={!enabled[i]}
              aria-label={label}
              aria-pressed={pressed}
              aria-keyshortcuts={tool.keys || undefined}
              aria-expanded={isLink ? link.open : undefined}
              aria-controls={isLink && link.open ? link.formId : undefined}
              aria-describedby={isLink && state.inLink ? link.lineId : undefined}
              title={
                !enabled[i] && tool.disabledHint
                  ? tool.disabledHint
                  : hint
                    ? `${label} (${hint})`
                    : label
              }
              // Keep the text's selection: the click acts on it.
              onMouseDown={(e) => e.preventDefault()}
              onFocus={() => setActive(i)}
              onClick={() => {
                if (tool.run === "link") link.toggle();
                else tool.run(editor.chain().focus()).run();
              }}
              className={cn(
                "rounded p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] disabled:opacity-30 disabled:hover:bg-transparent",
                pressed &&
                  "bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/15 hover:text-[var(--accent)]"
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

"use client";

import * as React from "react";
import {
  EditorContent,
  useEditor,
  useEditorState,
  type ChainedCommands,
  type Editor,
  type JSONContent,
} from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import {
  AlertTriangle,
  Bold,
  Italic,
  List,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  Redo2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { legacyTextToDoc } from "@/lib/rich-text/from-legacy";
import {
  richTextProblem,
  sanitizeRichText,
  type RtIssue,
} from "@/lib/rich-text/sanitize";
import { docToPlainText } from "@/lib/rich-text/to-plain";
import type { RichTextV1 } from "@/lib/rich-text/types";
import { editorExtensions, plainTextSlice } from "./editor-extensions";
import { cleanPastedHtml } from "./paste-cleanup";

export interface RichTextEditorProps {
  /** The block's stored rich text, as saved (it is sanitized before use). */
  rich?: unknown;
  /** The block's plain text: what the editor opens without a readable `rich`. */
  text?: string;
  /**
   * A paragraph, a key message or a reflection lesson's introduction: its
   * look (the learner's) and names.
   */
  variant: "paragraph" | "callout" | "reflection-intro";
  /**
   * The id of a visible label for the text, which then names it (instead of
   * the variant's own name), as a form field's label would.
   */
  labelledBy?: string;
  /** Put the cursor at the end of the text once the editor is ready. */
  autoFocus?: boolean;
  /**
   * After every edit: the new rich text and its plain text. When the text
   * can't be stored (too long, say) the editor says so, and still passes on
   * what the author sees — Save then names the block instead of quietly
   * storing an older version.
   */
  onChange: (rich: RichTextV1, text: string) => void;
}

/**
 * Per kind of text. `prose` holds the classes of the learner's element
 * (NarrativeStage, ReflectionIntro), so the text looks the same while it is
 * edited; editor-schema.test.ts checks they haven't drifted apart.
 */
export const VARIANT = {
  paragraph: {
    name: "Paragraph",
    subject: "This paragraph",
    label: "Paragraph text",
    placeholder: "Write the paragraph…",
    prose: "text-base leading-relaxed",
    box: "px-3 py-2",
  },
  callout: {
    name: "Key message",
    subject: "This key message",
    label: "Key message text",
    placeholder: "The one point learners should remember",
    prose: "seq-prose-compact font-medium text-[var(--accent)]",
    // The learner's highlighted box, at full width while editing.
    box: "m-2 rounded-lg border border-[var(--accent)]/20 bg-[var(--primary)]/10 px-4 py-3",
  },
  "reflection-intro": {
    name: "Introduction",
    subject: "This introduction",
    label: "Introduction",
    placeholder: "Write a short introduction…",
    prose: "text-sm text-[var(--muted-foreground)]",
    box: "px-3 py-2",
  },
} as const;

/**
 * The lesson text editor for one paragraph, key message or reflection
 * introduction (D36): bold, italic, bulleted and numbered lists, indent,
 * undo — the formatting learners see, drawn with the same .seq-prose
 * styles, and nothing else.
 *
 * - It opens `rich` when that reads as version 1, otherwise `text` by the
 *   rules learners already see (Round 1), so an old block shows the
 *   paragraphs and lists it had. It only becomes rich text once edited:
 *   Tiptap calls onUpdate for real edits only.
 * - Uncontrolled after it mounts: the parent remounts it (a new key) to
 *   start over, e.g. on "Discard changes" or another language.
 * - Pasting: Word and Google Docs HTML is tidied (paste-cleanup.ts) and read
 *   against the schema, which keeps only the formatting above; plain text
 *   with line breaks follows Round 1's rules ("•" and "1." lines are lists).
 * - Keyboard: the usual shortcuts; Tab and Shift+Tab move a list point in
 *   and out (and leave the editor at the deepest level or outside lists);
 *   Escape or Alt+F10 goes to the toolbar.
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
  onChange,
}: RichTextEditorProps) {
  const v = VARIANT[variant];
  const ids = React.useId();
  const toolbarRef = React.useRef<HTMLDivElement>(null);
  // Set once: the editor keeps its own state after it mounts.
  const [opening] = React.useState(() => openingDoc(rich, text));
  const [problem, setProblem] = React.useState(() =>
    richTextProblem(opening.issues, v.subject)
  );
  const [flattened, setFlattened] = React.useState(false);

  const [options] = React.useState(() => ({
    content: opening.doc,
    extensions: editorExtensions(v.placeholder),
    editorProps: {
      attributes: {
        // rt-editor (globals.css): the height, the empty editor's hint, and
        // no gap above a list point's first line — the editor holds it in a
        // <p>, learners see it right inside the <li>.
        class: cn("seq-prose rt-editor", v.prose),
        role: "textbox",
        "aria-multiline": "true",
        ...(labelledBy
          ? { "aria-labelledby": labelledBy }
          : { "aria-label": v.label }),
        "aria-describedby": `${ids}-tip ${ids}-keys`,
        // Where BlockEditor puts focus when it's asked to.
        "data-block-field": "",
      },
      transformPastedHTML: cleanPastedHtml,
      handlePaste: pastePlainText,
      handleKeyDown: (_view: EditorView, event: KeyboardEvent) => {
        if (event.isComposing) return false;
        if (event.key === "Escape" || (event.altKey && event.key === "F10")) {
          toolbarRef.current
            ?.querySelector<HTMLButtonElement>('button[tabindex="0"]')
            ?.focus();
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
      const { value, issues } = sanitizeRichText({ v: 1, doc });
      setProblem(richTextProblem(issues, v.subject));
      setFlattened(issues.includes("list-flattened"));
      if (value) onChange(value, docToPlainText(value.doc));
      else onChange({ v: 1, doc } as unknown as RichTextV1, "");
    },
  });

  // Once, when it's first on the page (Tiptap's own autofocus can run
  // before React has put the editor in place).
  const [focusOnMount] = React.useState(autoFocus);
  React.useEffect(() => {
    if (editor && focusOnMount) editor.commands.focus("end");
  }, [editor, focusOnMount]);

  if (!editor) return <EditorLoading />;

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)]">
      <Toolbar editor={editor} name={v.name} toolbarRef={toolbarRef} />
      <p
        id={`${ids}-tip`}
        className="border-b border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)]"
      >
        Tip: paste from Word or Google Docs with Ctrl+V (⌘V on Mac) — bold,
        italic and lists are kept, other formatting is tidied away.
      </p>
      <span id={`${ids}-keys`} className="sr-only">
        Tab and Shift+Tab move a list point in and out. Press Escape for the
        formatting toolbar.
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
        {flattened
          ? "Points nested more than 3 levels deep show at the third level for learners."
          : null}
      </p>
    </div>
  );
}

/**
 * What the editor opens: the stored doc, sanitized (the schema would throw
 * on anything unknown). One over a limit — a block copied or put back while
 * the author was still shortening it — opens as it is, with its problem
 * shown, rather than empty. Anything else opens the plain text by Round 1's
 * rules.
 */
function openingDoc(
  rich: unknown,
  text: string | undefined
): { doc: JSONContent; issues: RtIssue[] } {
  const { value, issues } = sanitizeRichText(rich);
  if (value) return { doc: value.doc, issues: [] };
  if (!issues.includes("bad-envelope")) {
    // Past the envelope check, so `rich` is { v: 1, doc: { type: "doc", … } }.
    return { doc: (rich as { doc: JSONContent }).doc, issues };
  }
  return { doc: legacyTextToDoc(text), issues: [] };
}

/** While the editor starts: LazyRichTextEditor's box, an empty editor's size. */
function EditorLoading() {
  return (
    <div
      aria-busy="true"
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
  /** The list the cursor is in (the innermost one). */
  list: "bulletList" | "orderedList" | null;
  canIndent: boolean;
  canOutdent: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

interface Tool {
  label: string;
  icon: LucideIcon;
  /** aria-keyshortcuts. */
  keys: string;
  /** The shortcut as shown in the tooltip, [Windows/Linux, Mac]. */
  hint: [string, string];
  pressed?: (s: ToolState) => boolean;
  enabled?: (s: ToolState) => boolean;
  run: (chain: ChainedCommands) => ChainedCommands;
  /** Starts a new group (a divider before it). */
  group?: boolean;
}

const TOOLS: readonly Tool[] = [
  {
    label: "Bold",
    icon: Bold,
    keys: "Control+B Meta+B",
    hint: ["Ctrl+B", "⌘B"],
    pressed: (s) => s.bold,
    run: (c) => c.toggleBold(),
  },
  {
    label: "Italic",
    icon: Italic,
    keys: "Control+I Meta+I",
    hint: ["Ctrl+I", "⌘I"],
    pressed: (s) => s.italic,
    run: (c) => c.toggleItalic(),
  },
  {
    label: "Bulleted list",
    icon: List,
    keys: "Control+Shift+8 Meta+Shift+8",
    hint: ["Ctrl+Shift+8", "⇧⌘8"],
    pressed: (s) => s.list === "bulletList",
    run: (c) => c.toggleBulletList(),
    group: true,
  },
  {
    label: "Numbered list",
    icon: ListOrdered,
    keys: "Control+Shift+7 Meta+Shift+7",
    hint: ["Ctrl+Shift+7", "⇧⌘7"],
    pressed: (s) => s.list === "orderedList",
    run: (c) => c.toggleOrderedList(),
  },
  {
    label: "Decrease indent",
    icon: ListIndentDecrease,
    keys: "Control+[ Meta+[",
    hint: ["Ctrl+[", "⌘["],
    enabled: (s) => s.canOutdent,
    run: (c) => c.outdent(),
    group: true,
  },
  {
    label: "Increase indent",
    icon: ListIndentIncrease,
    keys: "Control+] Meta+]",
    hint: ["Ctrl+]", "⌘]"],
    enabled: (s) => s.canIndent,
    run: (c) => c.indent(),
  },
  {
    label: "Undo",
    icon: Undo2,
    keys: "Control+Z Meta+Z",
    hint: ["Ctrl+Z", "⌘Z"],
    enabled: (s) => s.canUndo,
    run: (c) => c.undo(),
    group: true,
  },
  {
    label: "Redo",
    icon: Redo2,
    keys: "Control+Shift+Z Meta+Shift+Z",
    hint: ["Ctrl+Shift+Z", "⇧⌘Z"],
    enabled: (s) => s.canRedo,
    run: (c) => c.redo(),
  },
];

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
 * returns to the text.
 */
function Toolbar({
  editor,
  name,
  toolbarRef,
}: {
  editor: Editor;
  name: string;
  toolbarRef: React.RefObject<HTMLDivElement | null>;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }): ToolState => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
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

  const enabled = TOOLS.map((t) => (t.enabled ? t.enabled(state) : true));
  // The one button Tab reaches: the last one used, while it can be used.
  const tabStop = enabled[active] ? active : enabled.indexOf(true);

  function move(e: React.KeyboardEvent) {
    const order = TOOLS.map((_, i) => i).filter((i) => enabled[i]);
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
      {TOOLS.map((tool, i) => {
        const Icon = tool.icon;
        const pressed = tool.pressed?.(state);
        return (
          <React.Fragment key={tool.label}>
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
              aria-label={tool.label}
              aria-pressed={pressed}
              aria-keyshortcuts={tool.keys}
              title={`${tool.label} (${tool.hint[mac ? 1 : 0]})`}
              // Keep the text's selection: the click acts on it.
              onMouseDown={(e) => e.preventDefault()}
              onFocus={() => setActive(i)}
              onClick={() => tool.run(editor.chain().focus()).run()}
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

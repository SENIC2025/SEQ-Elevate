"use client";

import dynamic from "next/dynamic";
import type { RichTextEditorProps } from "./RichTextEditor";

/**
 * The lesson text editor, loaded only when an author opens a block: Tiptap
 * (about 100 KB) stays out of every page bundle, learner pages included
 * (the ESLint rule in eslint.config.mjs allows it only in the editor's own
 * files). Import this, never RichTextEditor itself.
 */

const load = () => import("./RichTextEditor");

/** Start fetching the editor early (a block is hovered or focused). */
export function preloadRichTextEditor() {
  void load().catch(() => {
    // The real load reports the failure where the editor would be.
  });
}

const Editor = dynamic<RichTextEditorProps>(
  () =>
    load().then(
      (m) => m.RichTextEditor,
      // Offline, or a deploy replaced the files: say so in place of the
      // editor rather than let the page's error screen take over.
      () => EditorUnavailable
    ),
  { ssr: false, loading: () => <EditorStarting /> }
);

export function LazyRichTextEditor(props: RichTextEditorProps) {
  return <Editor {...props} />;
}

/** The same box as RichTextEditor's own loading state. */
function EditorStarting() {
  return (
    <div
      aria-busy="true"
      className="min-h-[8.5rem] animate-pulse rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--muted-foreground)]"
    >
      Opening the text editor…
    </div>
  );
}

function EditorUnavailable() {
  return (
    <p
      role="alert"
      className="rounded-md border border-[var(--danger)] bg-[var(--danger)]/10 px-3 py-2 text-sm"
    >
      The text editor couldn&rsquo;t load. Check your connection, then reload
      the page — save any other changes first.
    </p>
  );
}

import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { parseLegalMarkdown, type Block, type Inline, type ListItem } from "@/lib/legal-markdown";

/**
 * A legal text (D94, spec 12.2), from its Markdown subset (legal-markdown.ts)
 * to React elements: React escapes every word, and no HTML string reaches
 * the page. Links to our own pages keep the page's language (the
 * navigation Link adds it).
 *
 * A wide table scrolls sideways in a region of its own, named by the
 * heading above it, so a keyboard reaches it and a screen reader says
 * what it is (WCAG 2.1.1, 4.1.2); a table is the one thing that may scroll
 * sideways on a narrow screen (WCAG 1.4.10).
 */
export function LegalBody({ source, label }: { source: string; label: string }) {
  const blocks = parseLegalMarkdown(source);
  return (
    <div className="mt-6 text-sm leading-relaxed text-[var(--foreground)]">
      {blocks.map((block, i) => renderBlock(block, i, nearestHeading(blocks, i) ?? label))}
    </div>
  );
}

/** The words of the last heading before block `index`, if any. */
function nearestHeading(blocks: Block[], index: number): string | null {
  for (let i = index - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.type === "heading") return plain(block.children) || null;
  }
  return null;
}

/** The words of inline content, without its marks. */
function plain(nodes: Inline[]): string {
  return nodes.map((n) => (n.type === "text" ? n.text : plain(n.children))).join("").trim();
}

function renderBlock(block: Block, key: number, near: string): ReactNode {
  switch (block.type) {
    case "heading":
      return block.level === 2 ? (
        <h2 key={key} className="mt-8 text-lg font-semibold">
          {inlines(block.children)}
        </h2>
      ) : (
        <h3 key={key} className="mt-6 text-base font-semibold">
          {inlines(block.children)}
        </h3>
      );
    case "paragraph":
      return (
        <p key={key} className="mt-3">
          {inlines(block.children)}
        </p>
      );
    case "list":
      return list(block.items, key, false);
    case "table":
      return (
        <div
          key={key}
          role="region"
          aria-label={near}
          tabIndex={0}
          className="mt-4 overflow-x-auto rounded-lg border border-[var(--border)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
        >
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-[var(--surface-muted)]">
              <tr>
                {block.head.map((cell, c) => (
                  <th key={c} scope="col" className="border-b border-[var(--border)] px-3 py-2 font-semibold align-top">
                    {inlines(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-b border-[var(--border)] last:border-b-0">
                  {row.map((cell, c) => (
                    <td key={c} className="px-3 py-2 align-top">
                      {inlines(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function list(items: ListItem[], key: number, nested: boolean): ReactNode {
  return (
    <ul key={key} className={nested ? "mt-1 ml-5 list-[circle] space-y-1" : "mt-3 ml-5 list-disc space-y-1"}>
      {items.map((item, i) => (
        <li key={i}>
          {inlines(item.children)}
          {item.items.length ? list(item.items, 0, true) : null}
        </li>
      ))}
    </ul>
  );
}

function inlines(nodes: Inline[]): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "strong":
        return <strong key={i}>{inlines(node.children)}</strong>;
      case "link":
        return node.href.kind === "internal" ? (
          <Link key={i} href={node.href.path} className="text-[var(--accent)] underline underline-offset-2">
            {inlines(node.children)}
          </Link>
        ) : (
          <a key={i} href={node.href.href} className="text-[var(--accent)] underline underline-offset-2">
            {inlines(node.children)}
          </a>
        );
    }
  });
}

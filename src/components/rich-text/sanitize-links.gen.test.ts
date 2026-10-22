import { describe, it, expect } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { checkLinkHref } from "@/lib/rich-text/link-url";
import { linkTextProblem } from "@/lib/rich-text/link-text";
import {
  CASES_PER_SEED,
  SEEDS,
  caseName,
  generatedAddress,
  generatedText,
  mulberry32,
  pick,
  type Random,
} from "@/lib/rich-text/link-gen";
import { sanitizeRichText } from "@/lib/rich-text/sanitize";
import type { RtBlock, RtInline } from "@/lib/rich-text/types";
import { RichTextView } from "./RichTextView";

/*
 * Release 4 spec 10.1 (U21): the sanitizer and the renderer on seeded
 * generated docs with links — addresses from a hostile alphabet, two links
 * on a text, extra attributes, addresses that aren't strings, touching
 * links, line breaks. Whatever is generated:
 * - the sanitized doc holds only bold, italic and link marks, a link with
 *   its address only, an address the check accepts as it is stored; it is
 *   version 2 exactly when it holds a link; no link's text, touching links
 *   and the words a link is in never read as another address; sanitizing
 *   it again changes nothing;
 * - the HTML drawn holds only p, ul, ol, li, br, strong, em, a and span,
 *   with only href, target, rel, class, lang, title, start and a
 *   paragraph's style, no link inside a link, and every href one the check
 *   accepts.
 */

type Json = Record<string, unknown>;

/** A link mark as a request or a stored row may carry it. */
function linkMark(random: Random): Json {
  const roll = random();
  if (roll < 0.05) return { type: "link" };
  if (roll < 0.1) return { type: "link", attrs: { href: pick(random, [42, null, {}, ["https://example.org/"]]) } };
  if (roll < 0.15) return { type: "link", attrs: { href: "https://example.org/x", target: "_self", onclick: "alert(1)" } };
  const href = random() < 0.4 ? pick(random, ["https://example.org/a", "https://evil.example/b", "mailto:help@example.org"]) : generatedAddress(random);
  return { type: "link", attrs: { href } };
}

function textNode(random: Random): Json {
  const marks: Json[] = [];
  if (random() < 0.3) marks.push({ type: "bold" });
  if (random() < 0.3) marks.push({ type: "italic" });
  if (random() < 0.6) marks.push(linkMark(random));
  if (random() < 0.05) marks.push(linkMark(random));
  if (random() < 0.03) marks.push({ type: "underline" });
  if (random() < 0.5) marks.reverse();
  return { type: "text", text: generatedText(random) || "x", marks };
}

function paragraph(random: Random): Json {
  const content: Json[] = [];
  const n = 1 + Math.floor(random() * 6);
  for (let i = 0; i < n; i++) content.push(random() < 0.12 ? { type: "hardBreak" } : textNode(random));
  return { type: "paragraph", content };
}

function generatedDoc(random: Random): Json {
  const content: Json[] = [paragraph(random)];
  if (random() < 0.4) {
    content.push({ type: "bulletList", content: [{ type: "listItem", content: [paragraph(random)] }] });
  }
  if (random() < 0.3) content.push(paragraph(random));
  return { v: random() < 0.5 ? 1 : 2, doc: { type: "doc", content } };
}

const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  timeZone: string;
  children?: ReactNode;
}>;
const draw = (rich: unknown, inertLinks = false) =>
  renderToStaticMarkup(
    createElement(IntlProvider, { locale: "en", messages: en, timeZone: "UTC" }, createElement(RichTextView, { rich, text: "", inertLinks }))
  );

const unescape = (value: string) =>
  value.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Every paragraph's inline content, lists included. */
function paragraphs(blocks: readonly RtBlock[]): RtInline[][] {
  return blocks.flatMap((block) =>
    block.type === "paragraph"
      ? [block.content ?? []]
      : block.content.flatMap((item) => paragraphs(item.content))
  );
}

/** Touching link runs of a paragraph: [joined text, each run's href]. */
function touchingGroups(content: readonly RtInline[]): { text: string; hrefs: string[] }[] {
  const groups: { text: string; hrefs: string[] }[] = [];
  let open: { text: string; hrefs: string[] } | null = null;
  for (const node of content) {
    const href = node.type === "text" ? node.marks?.find((m) => m.type === "link") : undefined;
    if (node.type !== "text" || !href || href.type !== "link") {
      open = null;
      continue;
    }
    if (!open) groups.push((open = { text: "", hrefs: [] }));
    open.text += node.text;
    if (open.hrefs[open.hrefs.length - 1] !== href.attrs.href) open.hrefs.push(href.attrs.href);
  }
  return groups;
}

/**
 * Each link run of a paragraph with the words it is in, as learners read
 * it: from the start of the word of its first visible character to the end
 * of the word of its last one (a line break ends a word).
 */
function linkWords(content: readonly RtInline[]): { own: string; words: string; href: string }[] {
  const text = content.map((node) => (node.type === "text" ? node.text : "\n")).join("");
  const out: { own: string; words: string; href: string }[] = [];
  let at = 0;
  let run: { from: number; to: number; href: string } | null = null;
  const close = () => {
    if (!run) return;
    let first = run.from;
    let last = run.to - 1;
    while (first < last && /\s/.test(text[first])) first++;
    while (last > first && /\s/.test(text[last])) last--;
    let from = first;
    while (from > 0 && !/\s/.test(text[from - 1])) from--;
    let to = last + 1;
    while (to < text.length && !/\s/.test(text[to])) to++;
    out.push({ own: text.slice(run.from, run.to), words: text.slice(from, to), href: run.href });
    run = null;
  };
  for (const node of content) {
    const length = node.type === "text" ? node.text.length : 1;
    const mark = node.type === "text" ? node.marks?.find((m) => m.type === "link") : undefined;
    const href = mark?.type === "link" ? mark.attrs.href : null;
    if (run && run.href !== href) close();
    if (href !== null) {
      if (run) run.to = at + length;
      else run = { from: at, to: at + length, href };
    }
    at += length;
  }
  close();
  return out;
}

for (const seed of SEEDS) {
  describe(`links in generated docs (seed ${seed})`, () => {
    const random = mulberry32(seed);
    const docs = Array.from({ length: CASES_PER_SEED }, () => generatedDoc(random));

    it("sanitize to bold, italic and checked links only, version 2 exactly with a link, idempotently", { timeout: 60_000 }, () => {
      docs.forEach((input, i) => {
        const name = caseName(seed, i, input);
        const { value } = sanitizeRichText(input);
        if (!value) return;
        let links = 0;
        for (const content of paragraphs(value.doc.content)) {
          for (const node of content) {
            for (const mark of node.type === "text" ? (node.marks ?? []) : []) {
              expect(["bold", "italic", "link"], name).toContain(mark.type);
              if (mark.type !== "link") {
                expect(Object.keys(mark), name).toEqual(["type"]);
                continue;
              }
              links++;
              expect(Object.keys(mark), name).toEqual(["type", "attrs"]);
              expect(Object.keys(mark.attrs), name).toEqual(["href"]);
              expect(checkLinkHref(mark.attrs.href), name).toMatchObject({ ok: true, href: mark.attrs.href });
            }
          }
          for (const group of touchingGroups(content)) {
            for (const href of group.hrefs) expect(linkTextProblem(group.text, href), name).not.toBe("misleading");
          }
          // Nor does a link's own text, or the words it is in (with the text touching it).
          for (const { own, words, href } of linkWords(content)) {
            expect(linkTextProblem(own, href), name).toBeNull();
            expect(linkTextProblem(words, href), name).not.toBe("misleading");
          }
        }
        expect(value.v, name).toBe(links ? 2 : 1);
        expect(sanitizeRichText(value).value, name).toEqual(value);
      });
    });

    // 4,000 renders a seed: given time on a busy machine.
    it("draw only whitelisted elements and attributes, no link in a link, every href accepted", { timeout: 120_000 }, () => {
      docs.forEach((input, i) => {
        const name = caseName(seed, i, input);
        for (const html of [draw(input), draw(input, true)]) {
          for (const tag of html.match(/<[a-z][^>]*>/gi) ?? []) {
            expect(tag, name).toMatch(/^<(?:div|p|ul|ol|li|br\/|strong|em|a|span)(?:\s|>|\/)/);
            for (const [, attribute] of tag.matchAll(/\s([a-z-]+)=/gi)) {
              expect(["href", "target", "rel", "class", "lang", "title", "start", "style"], name).toContain(attribute);
            }
            if (/\sstyle=/.test(tag)) expect(tag, name).toMatch(/^<p style="padding-inline-start:[\d.]+rem">$/);
          }
          expect(html, name).not.toMatch(/<a\b(?:(?!<\/a>)[\s\S])*<a\b/);
          for (const [, href] of html.matchAll(/\shref="([^"]*)"/g)) {
            const address = unescape(href);
            expect(address, name).toMatch(/^(?:https:\/\/|http:\/\/|mailto:)/);
            expect(checkLinkHref(address), name).toMatchObject({ ok: true, href: address });
          }
        }
      });
    });
  });
}

import type { LinkRefusal } from "@/lib/rich-text/link-url";

/**
 * Release 4 (spec 10.3): the hostile links every saving action and every
 * page is tried with, shared by the end-to-end specs of both parts.
 *
 * - HOSTILE_ADDRESSES: addresses that must never become a link, each with
 *   why the address check refuses it. Sent through saveLessonNarrative,
 *   savePartText and saveCourseReferences inside a link mark
 *   (linkedParagraph), and through addLessonLink and updateLessonLink as
 *   the address; written straight into the database as stored LessonLink
 *   addresses (STORED_LINK_URLS).
 * - HOSTILE_MARKS: link marks that are wrong in their shape rather than
 *   their address (two on one text, extra attributes, a misleading label,
 *   touching links that together show another address), as rich text.
 * - RENDER_ONLY_MARKS: shapes only a direct database write can make
 *   (nested objects, unknown mark types), for the pages that draw them.
 * - overLimitDoc: a version-2 block over the node limit holding hostile
 *   links, for the editors' opening path.
 * - MISLEADING_TITLES: further-reading titles that show another address.
 *
 * Every address here is refused by checkLinkHref on a server without
 * BLOB_PUBLIC_HOST (as the e2e servers run), where every Vercel Blob store
 * counts as ours; r4-hostile-links.test.ts checks the table against it.
 */

/** A file of our own store, as the e2e servers see it (BLOB_PUBLIC_HOST unset). */
export const OWN_FILE = "https://e2e-store.public.blob.vercel-storage.com/handout-r4.pdf";

/** Why a hostile address is refused: the address check's reason, or our own file store. */
export type HostileReason = LinkRefusal | "own-file";

export interface HostileAddress {
  /** What the row is, for a test's title. */
  name: string;
  /** The address as sent: not always a string. */
  href: unknown;
  reason: HostileReason;
}

const MILLION = "https://example.org/" + "a".repeat(1_000_000 - "https://example.org/".length);
const TOO_LONG = "https://example.org/" + "a".repeat(2_049 - "https://example.org/".length);

export const HOSTILE_ADDRESSES: readonly HostileAddress[] = [
  { name: "javascript:", href: "javascript:alert(1)", reason: "scheme" },
  { name: "javascript: in mixed case", href: "JaVaScRiPt:alert(1)", reason: "scheme" },
  { name: "javascript: after a space", href: " javascript:alert(1)", reason: "scheme" },
  { name: "javascript: with a tab inside", href: "java\tscript:alert(1)", reason: "characters" },
  { name: "javascript: with a NUL inside", href: "java\u0000script:alert(1)", reason: "characters" },
  { name: "data: HTML", href: "data:text/html,<script>alert(1)</script>", reason: "scheme" },
  { name: "vbscript:", href: "vbscript:msgbox(1)", reason: "scheme" },
  { name: "file:", href: "file:///C:/x", reason: "scheme" },
  { name: "a scheme-relative address", href: "//evil.example", reason: "scheme" },
  { name: "a relative path", href: "/relative", reason: "scheme" },
  { name: "a fragment", href: "#x", reason: "scheme" },
  { name: "https without slashes", href: "https:evil.example", reason: "scheme" },
  { name: "a user name and password", href: "https://user:pw@evil.example", reason: "credentials" },
  { name: "a host behind a user name", href: "https://bank.example@evil.example", reason: "credentials" },
  { name: "2,049 characters", href: TOO_LONG, reason: "too-long" },
  { name: "1,000,000 characters", href: MILLION, reason: "too-long" },
  { name: "a number", href: 42, reason: "empty" },
  { name: "an object", href: { href: "https://example.org/" }, reason: "empty" },
  { name: "an array", href: ["https://example.org/"], reason: "empty" },
  {
    name: "an Outlook safe link",
    href: "https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.org%2F&data=05%7C01%7Csomeone%40example.org",
    reason: "redirect",
  },
  { name: "our own file store", href: OWN_FILE, reason: "own-file" },
];

/** The stored LessonLink addresses a direct database write may leave: the string addresses above, and two more. */
export const STORED_LINK_URLS: readonly { name: string; url: string }[] = [
  ...HOSTILE_ADDRESSES.filter(
    (row): row is HostileAddress & { href: string } =>
      typeof row.href === "string" && row.reason !== "own-file" && row.name !== "1,000,000 characters"
  ).map((row) => ({ name: row.name, url: row.href })),
  { name: "a string that isn't an address", url: "not an address" },
  { name: "an empty string", url: "" },
];

/* ------------------------------------------------------------ rich text --- */

type Mark = Record<string, unknown>;
type Inline = { type: "text"; text: string; marks?: Mark[] } | { type: "hardBreak" };

/** A link mark as a request or a database row may carry it: `href` plus anything else. */
export const linkMark = (href: unknown, extra: Record<string, unknown> = {}): Mark => ({
  type: "link",
  attrs: { href, ...extra },
});

/** A version-2 envelope of one paragraph. */
export const paragraphDoc = (content: Inline[]) => ({
  v: 2 as const,
  doc: { type: "doc", content: [{ type: "paragraph", content }] },
});

/** "Read <label> today." with `label` linked to `href`. */
export const linkedParagraph = (href: unknown, label = "the guide", extra: Record<string, unknown> = {}) =>
  paragraphDoc([
    { type: "text", text: "Read " },
    { type: "text", text: label, marks: [linkMark(href, extra)] },
    { type: "text", text: " today." },
  ]);

/** A paragraph block of lesson text (Lesson.narrative, a text piece's blocks) holding `rich`. */
export const richBlock = (rich: unknown, text = "Read the guide today.") => ({ kind: "paragraph" as const, rich, text });

export interface HostileMarks {
  name: string;
  rich: ReturnType<typeof paragraphDoc>;
  /**
   * What a save does with it: "refused" (named in the answer, nothing
   * stored), or "attributes-dropped" (stored, the link with `href` only).
   */
  save: "refused" | "attributes-dropped";
}

export const HOSTILE_MARKS: readonly HostileMarks[] = [
  {
    name: "two link marks on one text",
    rich: paragraphDoc([
      { type: "text", text: "the guide", marks: [linkMark("https://example.org/a"), linkMark("https://example.org/b")] },
    ]),
    save: "refused",
  },
  {
    name: "a link mark with onclick, style, target, rel and class",
    rich: linkedParagraph("https://example.org/guide", "the guide", {
      onclick: "alert(1)",
      style: "position:fixed;inset:0",
      target: "_self",
      rel: "opener",
      class: "evil",
    }),
    save: "attributes-dropped",
  },
  {
    name: "a label that shows another address",
    rich: linkedParagraph("https://evil.example/login", "https://bank.example/login"),
    save: "refused",
  },
  {
    name: "a label that shows another address through a zero-width space",
    rich: linkedParagraph("https://evil.example/login", "https://bank\u200B.example/login"),
    save: "refused",
  },
  {
    name: "a label that shows another address after a user name",
    rich: linkedParagraph("https://evil.example/login", "https://login@bank.example/"),
    save: "refused",
  },
  {
    name: "two touching links that together show another address",
    rich: paragraphDoc([
      { type: "text", text: "Log in at " },
      { type: "text", text: "https://bank.", marks: [linkMark("https://evil.example/a")] },
      { type: "text", text: "example", marks: [linkMark("https://evil.example/b")] },
      { type: "text", text: " today." },
    ]),
    save: "refused",
  },
];

/** Link marks only a direct database write can make: each must be drawn as text, without a link. */
export const RENDER_ONLY_MARKS: readonly { name: string; rich: ReturnType<typeof paragraphDoc> }[] = [
  { name: "an href that is an object", rich: linkedParagraph({ toString: "javascript:alert(1)" }) },
  { name: "attrs that are a string", rich: paragraphDoc([{ type: "text", text: "the guide", marks: [{ type: "link", attrs: "javascript:alert(1)" }] }]) },
  { name: "attrs nested in attrs", rich: paragraphDoc([{ type: "text", text: "the guide", marks: [{ type: "link", attrs: { attrs: { href: "javascript:alert(1)" } } }] }]) },
  { name: "a mark of an unknown type with an href", rich: paragraphDoc([{ type: "text", text: "the guide", marks: [{ type: "anchor", attrs: { href: "javascript:alert(1)" } }] }]) },
  { name: "a mark whose type is not a string", rich: paragraphDoc([{ type: "text", text: "the guide", marks: [{ type: { link: true }, attrs: { href: "javascript:alert(1)" } }] }]) },
];

/**
 * A version-2 block over the node limit (RT_LIMITS.maxNodes, 1,500): `nodes`
 * text nodes, the first linked to a javascript: address and the second to a
 * data: address. Its `text` is what the editors open instead.
 */
export function overLimitDoc(nodes = 1_501) {
  const content: Inline[] = [
    { type: "text", text: "First ", marks: [linkMark("javascript:alert(1)")] },
    { type: "text", text: "second ", marks: [linkMark("data:text/html,<script>alert(1)</script>")] },
  ];
  for (let i = content.length; i < nodes; i++) content.push({ type: "text", text: `w${i} `, marks: [{ type: "italic" }] });
  return { rich: paragraphDoc(content), text: "An over-limit block, opened as its text." };
}

/** Further-reading titles that show another address than the link opens (the link: MISLEADING_TITLE_URL). */
export const MISLEADING_TITLE_URL = "https://evil.example/login";
export const MISLEADING_TITLES: readonly string[] = [
  "https://bank.example/login",
  "Log in at https://bank.example",
  "Write to help@bank.example",
  // Read as learners see them: characters that show nothing, and a one dot leader.
  "https://bank\u200B.example/login",
  "https:\u200B//bank.example",
  "https://bank.example\u2024login",
];

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StaffLessonLink } from "@/lib/cms/lesson-links";

/*
 * U19, the part of Part B's link manager (Release 4, spec 4.6): what an
 * editor sees of a lesson's further reading before acting. A stored
 * address that can't be used is text with what to do, never a link; the
 * form's own check says what the server would refuse, in words, the
 * misleading title included; the hints say what further reading does and
 * doesn't do.
 */

// The actions run on the server; these tests only render and check.
vi.mock("@/app/actions/lesson-reading", () => ({
  addLessonLink: vi.fn(),
  getLessonLinks: vi.fn(async () => ({ links: [] })),
  removeLessonLink: vi.fn(),
  setLessonLinkOrder: vi.fn(),
  setLessonLinkPublished: vi.fn(),
  updateLessonLink: vi.fn(),
}));

const { LessonLinkManager, LinkRow, arrowAfterMove, checkLinkForm, linkHints, movedNotice, refusalMessage } = await import("./LessonLinkManager");

beforeEach(() => {
  vi.stubEnv("BLOB_PUBLIC_HOST", "");
  vi.stubEnv("NEXT_PUBLIC_BLOB_PUBLIC_HOST", "");
});
afterAll(() => vi.unstubAllEnvs());

const LINKS: StaffLessonLink[] = [
  { id: "l1", title: "The guide", url: "https://example.org/guide", kind: "web", description: "", languages: [], published: true },
  { id: "l2", title: "Arbeitsblatt", url: "https://example.de/a", kind: "web", description: "", languages: ["de"], published: false },
  { id: "l3", title: "Broken", url: "javascript:alert(1)", kind: null, unusable: true, description: "", languages: [], published: true },
];

const render = (props: Partial<Parameters<typeof LessonLinkManager>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(LessonLinkManager, { courseSlug: "c", stageKey: "context", initialLinks: LINKS, ...props })
  );

describe("the list", () => {
  it("shows each link with where it goes, its languages and whether learners see it", () => {
    const html = render();
    expect(html).toContain('<a href="https://example.org/guide" target="_blank" rel="noopener noreferrer"');
    // A new tab, and screen readers hear so (as QuickLink says it).
    expect(html).toContain('class="font-medium hover:underline">The guide<span class="sr-only"> (opens in a new tab)</span></a>');
    expect(html).toContain(">example.org</p>");
    expect(html).toContain(">All languages</span>");
    expect(html).toContain(">German</span>");
    expect(html).toContain(">Published</span>");
    expect(html).toContain(">Draft — hidden from learners</span>");
    expect(html).toContain('aria-label="Show to learners: Arbeitsblatt"');
    expect(html).toContain('aria-label="Hide from learners: The guide"');
    expect(html).toContain('aria-label="Move “Arbeitsblatt” up"');
  });

  it("shows a stored address that can't be used as text with what to do, never as a link", () => {
    const html = render();
    expect(html).toContain("javascript:alert(1)</p>");
    expect(html).toContain("This address can&#x27;t be used. Edit it or remove the link.");
    expect(html).not.toContain('href="javascript:');
    expect([...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])).toEqual(["https://example.org/guide", "https://example.de/a"]);
  });

  it("says when there is none, and offers Add a link", () => {
    const html = render({ initialLinks: [] });
    expect(html).toContain("No further reading on this lesson yet.");
    expect(html).toContain(">Add a link</button>");
  });

  it("opens the form from outside, with its fields named and every language ticked", () => {
    const html = render({ adding: true, onAddingChange: () => {} });
    expect(html).toContain('role="group" aria-label="Add a link"');
    for (const label of ["Title", "Web address", "Short description (optional)"]) expect(html).toContain(`>${label}</label>`);
    expect(html).toContain("<legend");
    expect(html.match(/type="checkbox" checked=""/g)).toHaveLength(3);
    expect(html).toContain('type="url" inputMode="url" spellCheck="false" autoComplete="off"');
    // Not a <form>: no browser check blocks what the form completes.
    expect(html).not.toContain("<form");
    // The page's own button holds the form: no second one here.
    expect(html).not.toContain(">Add a link</button>");
  });
});

describe("a link's row", () => {
  const row = (props: Partial<Parameters<typeof LinkRow>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(LinkRow, {
        link: LINKS[0],
        index: 1,
        count: 3,
        busy: false,
        idOf: (what: string, id: string) => `m-${what}-${id}`,
        onMove: () => {},
        onEdit: () => {},
        onToggle: () => {},
        onRemove: () => {},
        ...props,
      })
    );
  const buttons = (html: string) => [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);

  it("keeps every button focusable while a change runs, and says it's unavailable", () => {
    const busy = buttons(row({ busy: true }));
    expect(busy).toHaveLength(5);
    for (const b of busy) {
      expect(b, b).not.toMatch(/ disabled=""/);
      expect(b, b).toContain('aria-disabled="true"');
    }
    for (const b of buttons(row())) expect(b, b).not.toMatch(/ (aria-)?disabled="/);
  });

  it("offers no move past either end", () => {
    const [up, down] = buttons(row({ index: 0 }));
    expect(up).toContain('id="m-up-l1"');
    expect(up).toContain(' disabled=""');
    expect(down).toContain('id="m-down-l1"');
    expect(down).not.toMatch(/ (aria-)?disabled="/);
    expect(buttons(row({ index: 2 }))[1]).toContain(' disabled=""');
  });

  it("gives each arrow a target of at least 24 by 24 pixels (WCAG 2.5.8)", () => {
    const [up, down] = buttons(row());
    for (const b of [up, down]) expect(b).toMatch(/class="[^"]*\bh-6 w-6\b/);
  });

  it("keeps focus on the moved link's arrow: the same one, or the other at either end", () => {
    expect(arrowAfterMove(1, 3, -1)).toBe("up");
    expect(arrowAfterMove(0, 3, -1)).toBe("down");
    expect(arrowAfterMove(1, 3, 1)).toBe("down");
    expect(arrowAfterMove(2, 3, 1)).toBe("up");
    expect(movedNotice("The guide", 1, 3)).toBe("Moved “The guide” to position 1 of 3.");
  });
});

describe("checkLinkForm", () => {
  const values = { title: "The guide", url: "https://example.org/guide", description: "", languages: ["en", "de", "el"] as ("en" | "de" | "el")[] };

  it("completes what an author types: a bare email address and a bare host", () => {
    expect(checkLinkForm({ ...values, title: "Write to us", url: "help@verein.de" })).toMatchObject({ problems: {}, href: "mailto:help@verein.de" });
    expect(checkLinkForm({ ...values, url: "www.bpb.de" })).toMatchObject({ problems: {}, href: "https://www.bpb.de/" });
  });

  it("refuses what the server refuses, in words", () => {
    expect(checkLinkForm({ ...values, url: "javascript:alert(1)" }).problems.url).toBe(
      "Use an address starting with https:// or http://, or an email address."
    );
    expect(checkLinkForm({ ...values, url: "https://user:pw@example.org" }).problems.url).toBe("Addresses can't contain a user name or password.");
    expect(checkLinkForm({ ...values, url: "https://store.public.blob.vercel-storage.com/a.pdf" }).problems.url).toBe(
      "This is a file uploaded to the platform. Upload it as a document instead."
    );
    expect(
      checkLinkForm({ ...values, url: "https://eur01.safelinks.protection.outlook.com/?url=javascript%3Aalert(1)&data=x" }).problems.url
    ).toMatch(/^This is an Outlook safe link/);
    expect(checkLinkForm({ ...values, title: "https://bank.example/login", url: "https://evil.example/" }).problems.title).toBe(
      "The title shows a different address than the link opens. Use the real address, or a few words."
    );
    expect(checkLinkForm({ ...values, title: " " }).problems.title).toBe("Give the link a title.");
    expect(checkLinkForm({ ...values, title: "x".repeat(201) }).problems.title).toMatch(/at most 200/);
    expect(checkLinkForm({ ...values, description: "x".repeat(301) }).problems.description).toMatch(/at most 300/);
    expect(checkLinkForm({ ...values, languages: [] }).problems.languages).toBe("Choose at least one language.");
  });

  it("refuses a title that shows another address however it is written, as the server does", () => {
    const MISLEADING = "The title shows a different address than the link opens. Use the real address, or a few words.";
    for (const title of ["https://bank\u200b.example/login", "https:\u200b//bank.example", "https://bank.example\u2024login", "www.bank.example/login"]) {
      expect(checkLinkForm({ ...values, title, url: "https://evil.example/" }).problems.title, JSON.stringify(title)).toBe(MISLEADING);
    }
    expect(checkLinkForm({ ...values, title: "www.bpb.de", url: "https://www.bpb.de/" }).problems).toEqual({});
  });

  it("names every title that shows another address one way, and keeps a file's name or a name in capitals (D104 as narrowed on 22 October 2026)", () => {
    const MISLEADING = "The title shows a different address than the link opens. Use the real address, or a few words.";
    for (const title of ["paypal.com", "paypal.соm", "Visit PayPal.com", "www.bank.example/login"]) {
      expect(checkLinkForm({ ...values, title, url: "https://example.org/files/x" }).problems.title, title).toBe(MISLEADING);
    }
    // No address by its look: learners see the link's site beside the title.
    for (const title of ["course-materials.zip", "intro.mov", "PAYPAL.COM", "Amazon.Co.UK"]) {
      expect(checkLinkForm({ ...values, title, url: "https://example.org/files/x" }).problems, title).toEqual({});
    }
    // The link's own site, by its registrable domain, and an abbreviation are fine.
    expect(checkLinkForm({ ...values, title: "europa.eu", url: "https://ec.europa.eu/info" }).problems).toEqual({});
    expect(checkLinkForm({ ...values, title: "M.Sc. Sustainable Entrepreneurship – programme page", url: "https://uni.example/msc" }).problems).toEqual({});
  });

  it("measures and empties a title and description as the server stores them", () => {
    // Spaces typed stay (the server keeps them), so 201 characters with a double space are too many.
    expect(checkLinkForm({ ...values, title: `${"x".repeat(100)}  ${"x".repeat(99)}` }).problems.title).toMatch(/at most 200/);
    expect(checkLinkForm({ ...values, description: `${"y".repeat(150)}  ${"y".repeat(149)}` }).problems.description).toMatch(/at most 300/);
    // Characters that show nothing make no title.
    expect(checkLinkForm({ ...values, title: "\u3164\u200b" }).problems.title).toBe("Give the link a title.");
  });

  it("unwraps an Outlook safe link whose target can be used", () => {
    const safe = `https://eur01.safelinks.protection.outlook.com/?url=${encodeURIComponent("https://example.org/real")}&data=someone%40example.org`;
    expect(checkLinkForm({ ...values, url: safe })).toMatchObject({ problems: {}, href: "https://example.org/real" });
  });

  it("warns about http without refusing it", () => {
    expect(checkLinkForm({ ...values, url: "http://example.org/" })).toMatchObject({ problems: {}, insecure: true });
    expect(checkLinkForm(values).insecure).toBe(false);
  });
});

describe("refusalMessage", () => {
  it("puts the server's refusal under its field: the misleading title under the title", () => {
    expect(refusalMessage({ ok: false, error: "invalid", field: "title", reason: "misleading" })).toEqual({
      field: "title",
      text: "The title shows a different address than the link opens. Use the real address, or a few words.",
    });
    expect(refusalMessage({ ok: false, error: "invalid", field: "url", reason: "redirect" }).field).toBe("url");
    expect(refusalMessage({ ok: false, error: "too-many" })).toEqual({ text: "A lesson can have at most 30 further-reading links." });
  });
});

describe("linkHints", () => {
  const doc = (languages?: ("en" | "de" | "el")[], published = true) => ({
    id: "d",
    name: "d.pdf",
    url: "https://x/d.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1,
    published,
    ...(languages ? { languages } : {}),
  });
  /** What the lesson shows besides its documents, the same in every language (null: no view of it). */
  const every = (value: boolean | null) => ({ en: value, de: value, el: value });
  const ALONE = "Further reading alone doesn't make a lesson appear for learners.";
  const NOT_NOW = "Learners don't get this lesson now, so they don't see its further reading.";
  const GERMAN_ONLY =
    "Every language gets this lesson: its only material is for German learners, so others see the German document, marked “In German”.";

  it("says further reading alone doesn't make a lesson appear, of a lesson learners don't get because nothing in it can be shown", () => {
    expect(linkHints({ live: false, notLive: "empty", ownContent: every(null), documents: [doc(undefined, false)] })).toEqual([ALONE]);
  });

  it("never says so of a lesson learners get: they get its further reading with it", () => {
    // The standard reflection lesson with nothing stored: its standard introduction and questions.
    expect(linkHints({ live: true, ownContent: every(true), documents: [] })).toEqual([]);
    // A standard text lesson nobody wrote is there for learners too.
    expect(linkHints({ live: true, ownContent: every(false), documents: [] })).toEqual([]);
  });

  it("says learners don't see the further reading of a lesson they don't get: hidden, or the Release 2 player switched off", () => {
    expect(linkHints({ live: false, ownContent: every(true), documents: [] })).toEqual([NOT_NOW]);
    expect(linkHints({ live: false, ownContent: every(null), documents: [] })).toEqual([NOT_NOW]);
    expect(linkHints({ live: false, notLive: "switched-off", ownContent: every(true), documents: [] })).toEqual([NOT_NOW]);
    // Nor does it say that every language gets it.
    expect(linkHints({ live: false, ownContent: every(false), documents: [doc(["de"])] })).toEqual([NOT_NOW]);
  });

  it("says a lesson whose only material is for one language reaches every language, with it", () => {
    expect(linkHints({ live: true, ownContent: every(false), documents: [doc(["de"])] })).toEqual([GERMAN_ONLY]);
    expect(linkHints({ live: true, ownContent: every(false), documents: [doc(["de"]), doc(["el"])] })).toEqual([
      "Every language gets this lesson: its only material is for German and Greek learners, so others see it too, marked with its language.",
    ]);
    // A draft isn't material: the published German document is the only one.
    expect(linkHints({ live: true, ownContent: every(false), documents: [doc(["de"]), doc(["en"], false)] })).toEqual([GERMAN_ONLY]);
    // A document for every language, or the three between them: no hint.
    expect(linkHints({ live: true, ownContent: every(false), documents: [doc(["de"]), doc()] })).toEqual([]);
    expect(linkHints({ live: true, ownContent: every(false), documents: [doc(["de"]), doc(["en", "el"])] })).toEqual([]);
  });

  it("doesn't say so of a lesson that shows something else: the others get the lesson without the document", () => {
    expect(linkHints({ live: true, ownContent: every(true), documents: [doc(["de"])] })).toEqual([]);
    expect(linkHints({ live: true, ownContent: every(true), documents: [doc(["de"]), doc(["el"])] })).toEqual([]);
  });

  it("promises nothing for a language the page has no view of", () => {
    expect(linkHints({ live: true, ownContent: { en: null, de: false, el: false }, documents: [doc(["de"])] })).toEqual([]);
  });
});

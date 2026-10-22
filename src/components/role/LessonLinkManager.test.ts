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

const { LessonLinkManager, checkLinkForm, linkHints, refusalMessage } = await import("./LessonLinkManager");

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

  it("says further reading alone doesn't make a lesson appear", () => {
    expect(linkHints({ live: false, otherContent: false, documents: [doc(undefined, false)] })).toEqual([
      "Further reading alone doesn't make a lesson appear for learners.",
    ]);
  });

  it("says learners don't see the further reading of a lesson they don't get", () => {
    expect(linkHints({ live: false, otherContent: true, documents: [] })).toEqual([
      "Learners don't get this lesson now, so they don't see its further reading.",
    ]);
    expect(linkHints({ live: true, otherContent: true, documents: [] })).toEqual([]);
  });

  it("says a lesson whose only material is for one language reaches every language", () => {
    expect(linkHints({ live: true, otherContent: false, documents: [doc(["de"])] })).toEqual([
      "Every language gets this lesson: its only material is for German learners, so others see the German document, marked “In German”.",
    ]);
    expect(linkHints({ live: true, otherContent: false, documents: [doc(["de"]), doc(["el"])] })).toEqual([
      "Every language gets this lesson: its only material is for German and Greek learners, so others see it too, marked with its language.",
    ]);
    // A document for every language, or the three between them: no hint.
    expect(linkHints({ live: true, otherContent: false, documents: [doc(["de"]), doc()] })).toEqual([]);
    expect(linkHints({ live: true, otherContent: false, documents: [doc(["de"]), doc(["en", "el"])] })).toEqual([]);
  });
});

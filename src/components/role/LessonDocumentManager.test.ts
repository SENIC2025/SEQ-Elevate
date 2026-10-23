import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StaffLessonLink } from "@/lib/cms/lesson-links";
import type { ItemLanguages } from "@/lib/cms/reading-types";
import type { LessonDocumentRef } from "@/lib/cms/types";

/*
 * Release 4, R2 (spec 4.6, D107, D108; U19's part for the document card):
 * a lesson's documents and further reading in one card, "Documents and
 * further reading". "Add a link" sits next to "Upload document" and opens
 * the link manager's form; the links follow the documents. A document gets
 * its languages at upload (three boxes, every language ticked, at least
 * one), and each row a "Languages" control and, when it isn't for every
 * language, a badge naming them. The card's own words are English (D106);
 * what is written in it carries its language: a document's name or a
 * link's title the one language it is for, else the page's (WCAG 3.1.2).
 */

vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-intl")>()),
  useLocale: () => "de",
}));
vi.mock("@/app/actions/lesson", () => ({
  addLessonDocument: vi.fn(),
  removeLessonDocument: vi.fn(),
  setLessonDocumentOrder: vi.fn(),
  setLessonDocumentPublished: vi.fn(),
  getLessonMedia: vi.fn(),
}));
vi.mock("@/app/actions/lesson-reading", () => ({
  addLessonLink: vi.fn(),
  getLessonLinks: vi.fn(async () => ({ links: [] })),
  removeLessonLink: vi.fn(),
  setLessonLinkOrder: vi.fn(),
  setLessonLinkPublished: vi.fn(),
  updateLessonLink: vi.fn(),
  setLessonDocumentLanguages: vi.fn(),
}));

const manager = await import("./LessonDocumentManager");
const { LessonDocumentManager } = manager;

beforeEach(() => {
  vi.stubEnv("BLOB_PUBLIC_HOST", "");
  vi.stubEnv("NEXT_PUBLIC_BLOB_PUBLIC_HOST", "");
});
afterAll(() => vi.unstubAllEnvs());

const doc = (id: string, name: string, languages?: ("en" | "de" | "el")[]): LessonDocumentRef & ItemLanguages => ({
  id,
  name,
  url: `https://x.public.blob.vercel-storage.com/${id}.pdf`,
  mimeType: "application/pdf",
  sizeBytes: 2048,
  published: true,
  ...(languages ? { languages } : {}),
});
const LINKS: StaffLessonLink[] = [
  { id: "l1", title: "The guide", url: "https://example.org/guide", kind: "web", description: "", languages: [], published: true },
  { id: "l2", title: "Lektüre", url: "https://example.de/a", kind: "web", description: "", languages: ["de"], published: false },
];

const render = (props: Partial<Parameters<typeof LessonDocumentManager>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(LessonDocumentManager, {
      courseSlug: "c",
      stageKey: "concept",
      initialDocuments: [doc("d1", "Handout.pdf"), doc("d2", "Arbeitsblatt.pdf", ["de"])],
      initialLinks: LINKS,
      ...props,
    })
  );

describe("the document card holds the lesson's documents and further reading (Release 4)", () => {
  it("is titled for both, with Add a link next to Upload document, and the links after the documents", () => {
    const html = render();
    expect(html).toMatch(/<h3[^>]*>Documents and further reading<\/h3>/);
    const upload = html.indexOf("Upload document");
    const add = html.indexOf(">Add a link</button>");
    const documents = html.indexOf("Handout.pdf");
    const links = html.indexOf(">Further reading</h4>");
    expect(upload).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(upload);
    expect(documents).toBeGreaterThan(add);
    expect(links).toBeGreaterThan(html.indexOf("Arbeitsblatt.pdf"));
    expect(html).toContain("The guide");
    // One "Add a link": the card's, not a second one in the list's heading.
    expect(html.match(/>Add a link<\/button>/g)).toHaveLength(1);
  });

  it("gives an upload its languages: three boxes, every language ticked", () => {
    const html = render();
    const legend = html.lastIndexOf("<legend", html.indexOf("Languages of the next document"));
    const boxes = html.slice(legend, html.indexOf("Upload document"));
    expect(boxes).toContain("<legend");
    expect(boxes.match(/type="checkbox" checked=""/g)).toHaveLength(3);
    for (const name of ["English", "German", "Greek"]) expect(boxes).toContain(`${name}</label>`);
  });

  it("names a document's languages when it isn't for every language, and offers Languages on each row", () => {
    const html = render();
    expect(html).toContain('aria-label="Languages: Handout.pdf"');
    expect(html).toContain('aria-label="Languages: Arbeitsblatt.pdf"');
    const row = html.slice(html.indexOf("Arbeitsblatt.pdf"), html.indexOf('aria-label="Remove Arbeitsblatt.pdf"'));
    expect(row).toContain(">German</span>");
    const first = html.slice(html.indexOf("Handout.pdf"), html.indexOf('aria-label="Remove Handout.pdf"'));
    expect(first).not.toMatch(/>(English|German|Greek|All languages)<\/span>/);
  });

  it("makes each document's arrows 24 × 24 pixel targets, as the link list's (WCAG 2.5.8)", () => {
    const html = render();
    const arrows = [...html.matchAll(/<button [^>]*aria-label="Move [^"]+ (up|down)"[^>]*>/g)].map((m) => m[0]);
    // Two documents and two links, two arrows each.
    expect(arrows).toHaveLength(8);
    for (const a of arrows) expect(a).toMatch(/class="[^"]*\bh-6 w-6\b/);
  });

  it("marks a name or title with the one language it is for, else the page's", () => {
    const html = render();
    expect(html).toMatch(/<a [^>]*lang="de"[^>]*>Arbeitsblatt\.pdf<\/a>/);
    expect(html).toMatch(/<a [^>]*lang="de"[^>]*>Handout\.pdf<\/a>/);
    expect(html).toMatch(/<a [^>]*lang="de"[^>]*>Lektüre<span/);
    expect(html).toMatch(/<a [^>]*lang="de"[^>]*>The guide<span/);
  });

  it("says what further reading does and doesn't do, from what the page knows", () => {
    const html = render({ linkHints: ["Further reading alone doesn't make a lesson appear for learners."] });
    expect(html).toContain("Further reading alone doesn&#x27;t make a lesson appear for learners.");
  });

  it("names the languages of an upload, and refuses none", () => {
    expect(manager.uploadLanguagesProblem(["en", "de", "el"])).toBeNull();
    expect(manager.uploadLanguagesProblem(["de"])).toBeNull();
    expect(manager.uploadLanguagesProblem([])).toBe("Choose at least one language.");
    expect(manager.documentLanguagesBadge([])).toBeNull();
    expect(manager.documentLanguagesBadge(undefined)).toBeNull();
    expect(manager.documentLanguagesBadge(["de"])).toBe("German");
    expect(manager.documentLanguagesBadge(["en", "el"])).toBe("English, Greek");
  });
});

/*
 * An upload with its languages (spec 4.6): the document is added for every
 * language (addLessonDocument, unchanged: D68), then, for a choice other
 * than every language, its languages are set. If that second step fails,
 * the document stays, a draft, for every language, and the card says to
 * set its languages again.
 */
describe("attachDocument: an upload's languages (Release 4)", () => {
  const PENDING = { name: "Arbeitsblatt.pdf", url: "https://x.public.blob.vercel-storage.com/a.pdf", mimeType: "application/pdf", sizeBytes: 10 };
  const actions = (o: { add?: unknown; set?: () => Promise<unknown> } = {}) => {
    const calls: unknown[][] = [];
    return {
      calls,
      addLessonDocument: async (...args: unknown[]) => {
        calls.push(["add", ...args]);
        return (o.add ?? { ok: true, id: "doc-9" }) as never;
      },
      setLessonDocumentLanguages: async (...args: unknown[]) => {
        calls.push(["languages", ...args]);
        return (o.set ? await o.set() : { ok: true }) as never;
      },
    };
  };

  it("adds a document for every language with one call", async () => {
    const a = actions();
    expect(await manager.attachDocument("c", "concept", PENDING, ["en", "de", "el"], a)).toEqual({ added: true, id: "doc-9", languages: "every" });
    expect(a.calls).toEqual([["add", "c", "concept", PENDING]]);
  });

  it("sets the languages of a document for some languages, once it is added", async () => {
    const a = actions();
    expect(await manager.attachDocument("c", "concept", PENDING, ["de"], a)).toEqual({ added: true, id: "doc-9", languages: "set" });
    expect(a.calls).toEqual([
      ["add", "c", "concept", PENDING],
      ["languages", "doc-9", ["de"]],
    ]);
  });

  it("keeps the document, for every language, when its languages can't be set, and says so", async () => {
    for (const set of [async () => ({ ok: false, error: "forbidden" }), async () => Promise.reject(new Error("offline"))]) {
      const a = actions({ set });
      expect(await manager.attachDocument("c", "concept", PENDING, ["de"], a)).toEqual({ added: true, id: "doc-9", languages: "failed" });
    }
    expect(manager.LANGUAGES_FAILED).toBe("Added for every language; set its languages again.");
  });

  it("sets nothing when the document wasn't added", async () => {
    const refused = { ok: false, error: "forbidden" };
    const a = actions({ add: refused });
    expect(await manager.attachDocument("c", "concept", PENDING, ["de"], a)).toEqual({ added: false, answer: refused });
    expect(a.calls).toHaveLength(1);
  });
});

import { describe, it, expect } from "vitest";
import { classifyPastedLink, pasteNotes } from "./paste-links";

/*
 * Release 4 spec 3.8 (U13): what happens to each link pasted from Word,
 * Google Docs or a web page, row by row of the spec's table. The text of an
 * anchor is always kept; only the link is kept or not.
 */

const kept = (href: string, http = false) => ({ keep: true, href, http });
const unwrapped = (counted: "not-kept" | "uploaded" | "misleading" | null) => ({ keep: false, counted });

const SAFE = (target: string) =>
  `https://eur01.safelinks.protection.outlook.com/?url=${encodeURIComponent(target)}&data=05%7C02%7Csomeone%40example.org%7C1234&sdata=abc&reserved=0`;
const GOOGLE = (target: string) =>
  `https://www.google.com/url?q=${encodeURIComponent(target)}&sa=D&source=editors&ust=1729000000000&usg=AOvVaw0abc`;

describe("classifyPastedLink", () => {
  it("unwraps an anchor without an address (Word bookmarks), without counting it", () => {
    expect(classifyPastedLink({ href: null, name: "_Toc123456", text: "Introduction" })).toEqual(unwrapped(null));
    expect(classifyPastedLink({ href: null, name: "_Hlk98765", text: "a phrase" })).toEqual(unwrapped(null));
    expect(classifyPastedLink({ href: "  ", name: null, text: "x" })).toEqual(unwrapped(null));
  });

  it("unwraps a link within the document (footnotes, a table of contents), without counting it", () => {
    for (const href of ["#_ftn1", "#_ftnref1", "#_Toc123456", "#top", " #x"]) {
      expect(classifyPastedLink({ href, name: "_ftnref1", text: "[1]" }), href).toEqual(unwrapped(null));
    }
  });

  it("keeps a web or email link, normalised, with nothing but its address", () => {
    expect(classifyPastedLink({ href: "https://www.bpb.de/themen", name: null, text: "the bpb's topics" })).toEqual(
      kept("https://www.bpb.de/themen")
    );
    expect(classifyPastedLink({ href: "HTTPS://Example.ORG", name: null, text: "Example" })).toEqual(kept("https://example.org/"));
    expect(classifyPastedLink({ href: "mailto:info@verein.de", name: null, text: "Schreib uns" })).toEqual(
      kept("mailto:info@verein.de")
    );
    expect(classifyPastedLink({ href: "https://ελληνικά.example/άρθρο", name: null, text: "Άρθρο" })).toEqual(
      kept("https://xn--hxargifdar.example/%CE%AC%CF%81%CE%B8%CF%81%CE%BF")
    );
  });

  it("keeps an http link, counted as http", () => {
    expect(classifyPastedLink({ href: "http://example.org/old", name: null, text: "the old site" })).toEqual(
      kept("http://example.org/old", true)
    );
  });

  it("unwraps an Outlook safe link or a Google redirect to its target, then judges the target", () => {
    expect(classifyPastedLink({ href: SAFE("https://example.org/guide"), name: null, text: "the guide" })).toEqual(
      kept("https://example.org/guide")
    );
    expect(classifyPastedLink({ href: GOOGLE("https://example.org/guide"), name: null, text: "the guide" })).toEqual(
      kept("https://example.org/guide")
    );
    expect(classifyPastedLink({ href: SAFE("http://example.org/old"), name: null, text: "old" })).toEqual(
      kept("http://example.org/old", true)
    );
    // The target is our own file, or shows another address: as for any link.
    expect(
      classifyPastedLink({ href: SAFE("https://e2e-store.public.blob.vercel-storage.com/x.pdf"), name: null, text: "handout" })
    ).toEqual(unwrapped("uploaded"));
    expect(classifyPastedLink({ href: SAFE("https://evil.example/"), name: null, text: "https://bank.example" })).toEqual(
      unwrapped("misleading")
    );
  });

  it("never keeps a safe link whose target can't be used: it carries the recipient's mailbox", () => {
    for (const target of ["file:///C:/Users/someone/handout.docx", "javascript:alert(1)", "not a link"]) {
      expect(classifyPastedLink({ href: SAFE(target), name: null, text: "handout" }), target).toEqual(unwrapped("not-kept"));
    }
    expect(classifyPastedLink({ href: "https://eur01.safelinks.protection.outlook.com/?data=x", name: null, text: "x" })).toEqual(
      unwrapped("not-kept")
    );
  });

  it("shows the original address instead of an Outlook safe link in an anchor's text, counted", () => {
    // Word's text for a link copied from Outlook is the safe link itself,
    // with the mailbox it was sent to: learners must never see that.
    const target = "https://example.org/guide";
    expect(classifyPastedLink({ href: SAFE(target), name: null, text: SAFE(target) })).toEqual({
      keep: true,
      href: target,
      http: false,
      text: target,
    });
    expect(classifyPastedLink({ href: SAFE(target), name: null, text: `See ${SAFE(target)}.` })).toEqual({
      keep: true,
      href: target,
      http: false,
      text: `See ${target}.`,
    });
    // A safe link whose target can't be a link: not kept, and its text shows the target, not the mailbox.
    const file = "file:///C:/Users/staff/handout.docx";
    expect(classifyPastedLink({ href: SAFE(file), name: null, text: SAFE(file) })).toEqual({
      keep: false,
      counted: "not-kept",
      text: file,
    });
    // One without a target shows only its host.
    const bare = "https://eur01.safelinks.protection.outlook.com/?data=05%7C02%7Csomeone%40example.org";
    expect(classifyPastedLink({ href: bare, name: null, text: bare })).toEqual({
      keep: false,
      counted: "not-kept",
      text: "https://eur01.safelinks.protection.outlook.com/",
    });
    for (const result of [
      classifyPastedLink({ href: SAFE(target), name: null, text: SAFE(target) }),
      classifyPastedLink({ href: SAFE(file), name: null, text: SAFE(file) }),
    ]) {
      expect(JSON.stringify(result)).not.toMatch(/safelinks|someone/);
    }
  });

  it("unwraps a link to our own file store, counted as an uploaded file", () => {
    expect(
      classifyPastedLink({ href: "https://e2e-store.public.blob.vercel-storage.com/handout.pdf", name: null, text: "handout" })
    ).toEqual(unwrapped("uploaded"));
  });

  it("unwraps a link whose text shows another address, counted", () => {
    expect(classifyPastedLink({ href: "https://evil.example/login", name: null, text: "https://bank.example/login" })).toEqual(
      unwrapped("misleading")
    );
    expect(classifyPastedLink({ href: "mailto:boss@example.org", name: null, text: "help@example.org" })).toEqual(
      unwrapped("misleading")
    );
    // Its own address (www. aside) is fine.
    expect(classifyPastedLink({ href: "https://bpb.de/x", name: null, text: "www.bpb.de" })).toEqual(kept("https://bpb.de/x"));
    // A host read as it shows: through a Roman numeral letter, a mark that follows no letter, a raised letter.
    for (const text of ["paypal.ⅽom", "www.paypal.̲com/login", "paypal.cᵒm"]) {
      expect(classifyPastedLink({ href: "https://evil.example/login", name: null, text }), text).toEqual(unwrapped("misleading"));
    }
    // An abbreviation, and a public suffix named by itself over a site under it.
    expect(classifyPastedLink({ href: "https://www.univie.ac.at/personen/huber", name: null, text: "Dr.in Maria Huber" })).toEqual(
      kept("https://www.univie.ac.at/personen/huber")
    );
    expect(classifyPastedLink({ href: "https://wallet.gov.gr/", name: null, text: "Gov.gr Wallet" })).toEqual(kept("https://wallet.gov.gr/"));
  });

  it("unwraps every other address, counted as not kept", () => {
    for (const href of [
      "file:///C:/Users/someone/handout.docx",
      "page.html",
      "../docs/x.pdf",
      "/relative",
      "//evil.example",
      "javascript:alert(1)",
      "tel:+3212345678",
      "https://user:pw@example.org/",
      "mailto:help@example.org?cc=boss@example.org",
      "https://localhost/x",
    ]) {
      expect(classifyPastedLink({ href, name: null, text: "a link" }), href).toEqual(unwrapped("not-kept"));
    }
  });

  it("unwraps a link with no text, without counting it", () => {
    expect(classifyPastedLink({ href: "https://example.org/", name: null, text: "  " })).toEqual(unwrapped(null));
  });
});

describe("pasteNotes", () => {
  it("says nothing when every link was kept, or there was none", () => {
    expect(pasteNotes({ notKept: 0, uploaded: 0, misleading: 0, http: 0, safeLinkText: 0 })).toEqual([]);
  });

  it("says when a link's text was an Outlook safe link", () => {
    expect(pasteNotes({ notKept: 0, uploaded: 0, misleading: 0, http: 0, safeLinkText: 1 })).toEqual([
      "1 link's text was an Outlook safe link, which carries the address of the mailbox it was sent to: it now shows the original address.",
    ]);
    expect(pasteNotes({ notKept: 0, uploaded: 0, misleading: 0, http: 0, safeLinkText: 2 })).toEqual([
      "2 links' text was an Outlook safe link, which carries the address of the mailbox it was sent to: they now show the original address.",
    ]);
  });

  it("gives one sentence per count, singular or plural", () => {
    expect(pasteNotes({ notKept: 2, uploaded: 1, misleading: 1, http: 1, safeLinkText: 0 })).toEqual([
      "2 links weren't kept: only web and email links can be used. Add them again with the Link button.",
      "1 link to a file uploaded to the platform wasn't kept. Add the file to the lesson as a document instead.",
      "1 link wasn't kept because its text shows a different address. Add it again with the Link button, using a few words.",
      "1 pasted link uses http://, which isn't secure. Change it to https:// if the site offers it.",
    ]);
    expect(pasteNotes({ notKept: 1, uploaded: 2, misleading: 3, http: 2, safeLinkText: 0 })).toEqual([
      "1 link wasn't kept: only web and email links can be used. Add it again with the Link button.",
      "2 links to files uploaded to the platform weren't kept. Add the files to the lesson as documents instead.",
      "3 links weren't kept because their text shows a different address. Add them again with the Link button, using a few words.",
      "2 pasted links use http://, which isn't secure. Change them to https:// if the sites offer it.",
    ]);
  });
});

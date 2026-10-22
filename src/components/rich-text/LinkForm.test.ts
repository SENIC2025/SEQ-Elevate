import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LinkForm, checkLinkForm } from "./LinkForm";

/*
 * Release 4 spec 3.7: the Link form's rules (checkLinkForm, pure) and its
 * markup (rendered to a string, as RichTextView.test.ts does). Focus,
 * Enter, Escape and the status line's timing are in e2e/r4-links.spec.ts.
 */

describe("checkLinkForm", () => {
  it("completes what an author types, and checks it", () => {
    expect(checkLinkForm({ text: "Schreib uns", address: "help@verein.de" })).toEqual({
      ok: true,
      href: "mailto:help@verein.de",
      text: "Schreib uns",
      warnings: [],
    });
    expect(checkLinkForm({ text: "the bpb", address: " www.bpb.de " })).toEqual({
      ok: true,
      href: "https://www.bpb.de/",
      text: "the bpb",
      warnings: [],
    });
    expect(
      checkLinkForm({
        text: "the guide",
        address: "https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.org%2Fguide&data=x",
      })
    ).toMatchObject({ ok: true, href: "https://example.org/guide" });
  });

  it("uses the address as the text when none is given", () => {
    expect(checkLinkForm({ text: "  ", address: "https://example.org/guide" })).toMatchObject({
      ok: true,
      text: "https://example.org/guide",
    });
    expect(checkLinkForm({ text: "", address: "mailto:help@example.org?subject=Hi" })).toMatchObject({
      ok: true,
      text: "help@example.org",
    });
  });

  it("refuses what can't be a link, saying why, under the address", () => {
    const cases: [string, string][] = [
      ["javascript:alert(1)", "Use an address starting with https:// or http://, or an email address."],
      ["file:///C:/x", "Use an address starting with https:// or http://, or an email address."],
      ["https://user:pw@example.org", "Addresses can't contain a user name or password."],
      [
        "https://e2e-store.public.blob.vercel-storage.com/handout.pdf",
        "This is a file uploaded to the platform. Add it to the lesson as a document instead.",
      ],
      [
        "https://eur01.safelinks.protection.outlook.com/?url=file%3A%2F%2F%2FC%3A%2Fx&data=x",
        "This is an Outlook safe link, which carries the address of the mailbox it was sent to. Use the original address instead.",
      ],
      ["https://example.org/" + "a".repeat(2_100), "This address is too long (at most 2,048 characters)."],
    ];
    for (const [address, message] of cases) {
      expect(checkLinkForm({ text: "x", address }), address.slice(0, 40)).toEqual({ ok: false, field: "address", message });
    }
  });

  it("says what is wrong with an address, one sentence for each problem", () => {
    const cases: [string, string][] = [
      ["", "Type the address the link should open."],
      ["https://example.org/my file.pdf", "Addresses can't contain spaces or invisible characters. Copy the address from the browser's address bar."],
      ["https://exa\u200Bmple.org/", "Addresses can't contain spaces or invisible characters. Copy the address from the browser's address bar."],
      ["https://intranet/x", "This address has no full site name (like example.org), or one that can't be used. Copy the address from the browser's address bar."],
      ["https://xn--a.example/", "This address has no full site name (like example.org), or one that can't be used. Copy the address from the browser's address bar."],
      ["mailto:help@example.org?cc=boss@example.org", "Email links can only carry a subject (no cc, bcc or message text)."],
      ["mailto:help@verein", "This email address isn't complete (like help@example.org)."],
      ["ftp://example.org/x", "Use an address starting with https:// or http://, or an email address."],
    ];
    const generic = "Use an address starting with https:// or http://, or an email address.";
    for (const [address, message] of cases) {
      const check = checkLinkForm({ text: "", address });
      expect(check, address).toEqual({ ok: false, field: "address", message });
      if (address.startsWith("https://") || address.startsWith("mailto:")) expect(message, address).not.toBe(generic);
    }
  });

  it("refuses text that shows another address through characters that show nothing, under the text", () => {
    expect(checkLinkForm({ text: "https://bank\u200B.example/login", address: "https://evil.example/login" })).toMatchObject({
      ok: false,
      field: "text",
    });
    // Text that shows nothing is no text: the link shows its address.
    expect(checkLinkForm({ text: "\u200B", address: "https://example.org/guide" })).toMatchObject({
      ok: true,
      text: "https://example.org/guide",
    });
  });

  it("refuses text that shows another address, under the text", () => {
    expect(checkLinkForm({ text: "https://bank.example", address: "https://evil.example/" })).toEqual({
      ok: false,
      field: "text",
      message: "The text shows a different address than the link opens. Show the real address, or use a few words.",
    });
  });

  it("says text of names that end in a top-level domain looks like a web address, a file's name too", () => {
    for (const text of ["course-materials.zip", "intro.mov", "paypal.com", "paypal.ⅽom", "paypal.cᵒm"]) {
      expect(checkLinkForm({ text, address: "https://example.org/files/x" }), text).toEqual({
        ok: false,
        field: "text",
        message: "The text looks like a web address, but the link opens another one. Use a few words instead, or show the real address.",
      });
    }
    // The link's own site, its registrable domain, and an abbreviation are fine.
    for (const [text, address] of [
      ["europa.eu", "https://ec.europa.eu/info"],
      ["M.Sc. programme", "https://uni.example/msc"],
      ["Dr.in Maria Huber", "https://www.univie.ac.at/personen/huber"],
      ["Gov.gr Wallet", "https://wallet.gov.gr/"],
    ]) {
      expect(checkLinkForm({ text, address }), text).toMatchObject({ ok: true, text });
    }
  });

  it("warns, without refusing, about http and about link text", () => {
    expect(checkLinkForm({ text: "the old site", address: "http://example.org" })).toMatchObject({
      ok: true,
      warnings: ["http"],
    });
    expect(checkLinkForm({ text: "Click here!", address: "https://example.org" })).toMatchObject({
      ok: true,
      warnings: ["vague"],
    });
    expect(checkLinkForm({ text: "κάντε κλικ εδώ", address: "http://example.org" })).toMatchObject({
      ok: true,
      warnings: ["http", "vague"],
    });
    expect(checkLinkForm({ text: "w".repeat(101), address: "https://example.org" })).toMatchObject({
      ok: true,
      warnings: ["long"],
    });
  });
});

describe("LinkForm markup", () => {
  const html = (props: Partial<Parameters<typeof LinkForm>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(LinkForm, {
        id: "lf",
        initialText: "the guide",
        initialAddress: "",
        editing: false,
        focus: "address",
        blurTick: 0,
        onApply: () => {},
        onCancel: () => {},
        onRemove: () => {},
        ...props,
      })
    );

  it("is a labelled group, never a form (no browser validation can block a bare address)", () => {
    const out = html();
    expect(out).toMatch(/^<div[^>]* role="group" aria-label="Link"/);
    expect(out).not.toMatch(/<form\b/);
  });

  it("has the text and address fields, Apply and Cancel", () => {
    const out = html();
    expect(out).toMatch(/<label for="lf-text"[^>]*>Text to show<\/label>/);
    expect(out).toMatch(/<input[^>]* id="lf-text"[^>]* type="text"[^>]* value="the guide"/);
    expect(out).toMatch(/<label for="lf-address"[^>]*>Address<\/label>/);
    const address = /<input[^>]* id="lf-address"[^>]*>/.exec(out)?.[0] ?? "";
    expect(address).toContain('type="url"');
    // HTML attribute names are case-insensitive; React writes them so.
    expect(address).toMatch(/spellcheck="false"/i);
    expect(address).toMatch(/autocomplete="off"/i);
    expect(address).toMatch(/inputmode="url"/i);
    expect(address).toContain('aria-describedby="lf-will-open"');
    expect(out).toMatch(/<button type="button"[^>]*>Apply<\/button>/);
    expect(out).toMatch(/<button type="button"[^>]*>Cancel<\/button>/);
    expect(out).not.toContain("Remove link");
  });

  it("offers Remove link when editing a link, and says where it will go (not a live region)", () => {
    const out = html({ editing: true, initialAddress: "https://example.org/guide" });
    expect(out).toMatch(/<button type="button"[^>]*>Remove link<\/button>/);
    expect(out).toMatch(/<p id="lf-will-open"[^>]*>Will open: https:\/\/example.org\/guide<\/p>/);
    expect(/<p id="lf-will-open"[^>]*>/.exec(out)?.[0]).not.toMatch(/aria-live|role=/);
  });

  it("keeps a polite status line for its warnings, empty at first", () => {
    expect(html({ initialAddress: "http://example.org" })).toMatch(/<p role="status"[^>]*><\/p>/);
  });
});

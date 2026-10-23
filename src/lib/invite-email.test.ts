import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  renderInviteEmail,
  renderSignInEmail,
  escapeHtml,
  emailLogoUrl,
  legalFooterLinks,
  EMAIL_LOGO,
  type InviteCopy,
} from "./invite-email";

const URL_WITH_QUERY =
  "https://seq-elevate.eu/api/auth/callback/invite?callbackUrl=%2Fen&token=abc&email=a%40b.eu";

function copy(overrides: Partial<InviteCopy> = {}): InviteCopy {
  return {
    lang: "en",
    subject: "You're invited to SEQ Elevate",
    preheader: "Join with one click.",
    greeting: "Hello Maria,",
    intro: "You've been invited to join SEQ Elevate.",
    invitedBy: "Invited by Stefan.",
    role: "Your role: Facilitator",
    capabilitiesTitle: "What you'll find:",
    capabilities: [
      { title: "Support learners", desc: "Follow each learner's progress." },
      { title: "Statistics", desc: "See how your cohorts are doing." },
    ],
    cta: "Join SEQ Elevate",
    howItWorks: "One click, no password. It works for 7 days.",
    expiredHelp: "If it has expired, go to seq-elevate.eu.",
    ignore: "Not expecting this? Ignore it.",
    footer: "Created and Powered by SENIC · senic.world",
    legalLinks: [{ label: "Privacy notice", path: "/en/legal/privacy" }],
    ...overrides,
  };
}

describe("escapeHtml", () => {
  it("neutralises markup characters", () => {
    expect(escapeHtml(`<b a="1">'&'</b>`)).toBe(
      "&lt;b a=&quot;1&quot;&gt;&#39;&amp;&#39;&lt;/b&gt;"
    );
  });
});

describe("emailLogoUrl", () => {
  it("points at the logo on the site the link belongs to", () => {
    expect(emailLogoUrl(URL_WITH_QUERY)).toBe(
      "https://seq-elevate.eu/brand/seq-elevate-email-2x.png"
    );
    expect(
      emailLogoUrl("http://localhost:3000/api/auth/callback/resend?token=x")
    ).toBe("http://localhost:3000/brand/seq-elevate-email-2x.png");
  });

  it("declares the logo at half the file's pixel size", () => {
    // PNG header: width and height are big-endian at bytes 16 and 20.
    const png = readFileSync(
      new URL(`../../public${EMAIL_LOGO.path}`, import.meta.url)
    );
    expect(png.readUInt32BE(16)).toBe(EMAIL_LOGO.width * 2);
    expect(png.readUInt32BE(20)).toBe(EMAIL_LOGO.height * 2);
  });
});

describe("renderInviteEmail", () => {
  it("opens with the logo, alt text standing in when images are blocked", () => {
    const { html } = renderInviteEmail({ url: URL_WITH_QUERY, copy: copy() });
    expect(html).toContain(
      '<img src="https://seq-elevate.eu/brand/seq-elevate-email-2x.png" width="200" height="107" alt="SEQ Elevate"'
    );
  });

  it("links the call to action to the join URL (attribute-escaped)", () => {
    const { html } = renderInviteEmail({ url: URL_WITH_QUERY, copy: copy() });
    expect(html).toContain(`href="${URL_WITH_QUERY.replace(/&/g, "&amp;")}"`);
    expect(html).toContain(">Join SEQ Elevate</a>");
  });

  it("never lets an admin-typed name inject markup", () => {
    const { html } = renderInviteEmail({
      url: URL_WITH_QUERY,
      copy: copy({
        greeting: `Hello <img src=x onerror=alert(1)>,`,
        invitedBy: `Invited by "><script>alert(2)</script>.`,
      }),
    });
    // The only image is the logo.
    expect(html.match(/<img/g)).toHaveLength(1);
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script");
    expect(html).toContain("Hello &lt;img src=x onerror=alert(1)&gt;,");
  });

  it("lists what the person will find, and drops the list when empty", () => {
    const withCaps = renderInviteEmail({ url: URL_WITH_QUERY, copy: copy() });
    expect(withCaps.html).toContain("Support learners");
    expect(withCaps.html).toContain("<ul");

    const without = renderInviteEmail({
      url: URL_WITH_QUERY,
      copy: copy({ capabilities: [] }),
    });
    expect(without.html).not.toContain("<ul");
    expect(without.text).not.toContain("What you'll find:");
  });

  it("sets the language and a plain-text alternative with the raw link", () => {
    const { html, text, subject } = renderInviteEmail({
      url: URL_WITH_QUERY,
      copy: copy({ lang: "de" }),
    });
    expect(subject).toBe("You're invited to SEQ Elevate");
    expect(html).toContain('<html lang="de">');
    expect(text).toContain(`Join SEQ Elevate: ${URL_WITH_QUERY}`);
    expect(text).toContain("- Support learners: Follow each learner's progress.");
  });
});

/*
 * Release 3 (spec 6.3, Art. 14 for invitees): the invitation's and the
 * sign-in email's footers link the privacy notice, in the email's
 * language, on the site the link belongs to; and the legal notice once
 * the site has one.
 */
describe("the emails' legal links", () => {
  it("are the privacy notice in the email's language, while there is no legal notice", () => {
    expect(legalFooterLinks("de")).toEqual([{ label: "Datenschutzhinweise", path: "/de/legal/privacy" }]);
    expect(legalFooterLinks("el")).toEqual([{ label: "Ενημέρωση για το απόρρητο", path: "/el/legal/privacy" }]);
  });

  it("add the legal notice once the site has one", () => {
    expect(legalFooterLinks("en", ["privacy", "terms", "notice"])).toEqual([
      { label: "Privacy notice", path: "/en/legal/privacy" },
      { label: "Legal notice", path: "/en/legal/notice" },
    ]);
  });

  it("sit in the invitation's footer, on the site the join link belongs to, and in its text", () => {
    const { html, text } = renderInviteEmail({
      url: URL_WITH_QUERY,
      copy: copy({ legalLinks: legalFooterLinks("en", ["privacy", "notice"]) }),
    });
    const footer = html.slice(html.indexOf("Created and Powered by SENIC"));
    expect(footer).toContain('<a href="https://seq-elevate.eu/en/legal/privacy"');
    expect(footer).toContain(">Privacy notice</a>");
    expect(footer).toContain('<a href="https://seq-elevate.eu/en/legal/notice"');
    expect(text).toContain("Privacy notice: https://seq-elevate.eu/en/legal/privacy");
    expect(text).toContain("Legal notice: https://seq-elevate.eu/en/legal/notice");
  });

  it("in the sign-in email, link the pages in the language the person signed in from, the label marked as such", () => {
    const from = (callbackUrl: string) =>
      renderSignInEmail(`http://localhost:3000/api/auth/callback/resend?callbackUrl=${encodeURIComponent(callbackUrl)}&token=x&email=a%40b.eu`);
    const el = from("/el/learner/course/x");
    expect(el.html).toContain('<a href="http://localhost:3000/el/legal/privacy"');
    expect(el.html).toContain('lang="el"');
    expect(el.html).toContain(">Ενημέρωση για το απόρρητο</a>");
    expect(el.text).toContain("http://localhost:3000/el/legal/privacy");
    // An absolute callback, as Auth.js may pass it, and the sign-in page's own default.
    expect(from("http://localhost:3000/de").html).toContain('href="http://localhost:3000/de/legal/privacy"');
    // Anything else: English, unmarked (the email's own language).
    for (const other of ["/fr/x", "", "https://elsewhere.example/el"]) {
      const { html } = from(other);
      expect(html, other).toContain('href="http://localhost:3000/en/legal/privacy"');
      expect(html, other).not.toMatch(/<a [^>]*lang=/);
    }
  });

  it("the sign-in email says who made the platform in the invitation's words", async () => {
    const en = (await import("@/messages/en.json")).default;
    expect(renderSignInEmail("http://localhost:3000/api/auth/callback/resend?token=x").html).toContain(`>${en.invite.footer}`);
  });

  it("sit in the sign-in email's footer too", () => {
    const signIn = "http://localhost:3000/api/auth/callback/resend?callbackUrl=%2Fen&token=x&email=a%40b.eu";
    const { html, text } = renderSignInEmail(signIn);
    expect(html).toContain('<a href="http://localhost:3000/en/legal/privacy"');
    expect(html).toContain(">Privacy notice</a>");
    expect(html).toContain(`href="${signIn.replace(/&/g, "&amp;")}"`);
    expect(text).toContain(`Sign in to SEQ Elevate: ${signIn}`);
    expect(text).toContain("Privacy notice: http://localhost:3000/en/legal/privacy");
  });
});

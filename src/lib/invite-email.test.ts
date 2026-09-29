import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  renderInviteEmail,
  escapeHtml,
  emailLogoUrl,
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

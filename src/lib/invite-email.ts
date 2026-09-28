/**
 * The invitation email (D27). Pure: takes the one-click join URL plus the
 * already-localised copy and returns subject / HTML / plain text. No I/O, so
 * it is unit-tested directly.
 *
 * Everything interpolated into the HTML is escaped — the copy carries values
 * an admin typed (the invitee's and inviter's names), and an invitation must
 * never become a way to inject markup into someone's inbox.
 */

export interface InviteCapability {
  title: string;
  desc: string;
}

/** Localised, fully-formatted copy for one invitation. */
export interface InviteCopy {
  /** BCP-47 language of the copy, for the <html lang> attribute. */
  lang: string;
  subject: string;
  /** Hidden inbox-preview line. */
  preheader: string;
  greeting: string;
  intro: string;
  invitedBy: string;
  role: string;
  capabilitiesTitle: string;
  capabilities: InviteCapability[];
  cta: string;
  howItWorks: string;
  expiredHelp: string;
  ignore: string;
  footer: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderInviteEmail({
  url,
  copy,
}: {
  url: string;
  copy: InviteCopy;
}): { subject: string; html: string; text: string } {
  const e = escapeHtml;
  const muted = "color: #4d4d66;";

  const capabilities = copy.capabilities.length
    ? `<p style="font-size: 14px; line-height: 1.6; margin: 16px 0 6px;">${e(copy.capabilitiesTitle)}</p>
    <ul style="font-size: 14px; line-height: 1.6; padding-left: 18px; margin: 0; ${muted}">${copy.capabilities
      .map(
        (c) =>
          `<li style="margin: 0 0 6px;"><strong style="color: #2e2e3d;">${e(c.title)}</strong> — ${e(c.desc)}</li>`
      )
      .join("")}</ul>`
    : "";

  const html = `<!doctype html>
<html lang="${e(copy.lang)}">
<body style="margin: 0;">
  <span style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${e(copy.preheader)}</span>
  <div style="font-family: Inter, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; color: #2e2e3d;">
    <div style="border-bottom: 3px solid #cad12c; padding-bottom: 12px; margin-bottom: 24px;">
      <p style="font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 700; color: #7467ae; margin: 0;">SEQ Elevate</p>
    </div>
    <p style="font-size: 14px; line-height: 1.6;">${e(copy.greeting)}</p>
    <p style="font-size: 14px; line-height: 1.6;">${e(copy.intro)}</p>
    <p style="font-size: 14px; line-height: 1.6; ${muted}">${e(copy.invitedBy)}</p>
    <p style="font-size: 14px; line-height: 1.6; font-weight: 600;">${e(copy.role)}</p>
    ${capabilities}
    <a href="${e(url)}" style="display: inline-block; margin: 24px 0 20px; background: #cad12c; color: #2e2e3d; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">${e(copy.cta)}</a>
    <p style="font-size: 12px; line-height: 1.6; ${muted}">${e(copy.howItWorks)} ${e(copy.expiredHelp)}</p>
    <p style="font-size: 12px; line-height: 1.6; ${muted}">${e(copy.ignore)}</p>
    <p style="font-size: 11px; ${muted} border-top: 1px solid #e4e4e8; padding-top: 16px; margin-top: 24px;">${e(copy.footer)}</p>
  </div>
</body>
</html>`;

  const text = [
    copy.greeting,
    "",
    copy.intro,
    copy.invitedBy,
    copy.role,
    ...(copy.capabilities.length
      ? [
          "",
          copy.capabilitiesTitle,
          ...copy.capabilities.map((c) => `- ${c.title}: ${c.desc}`),
        ]
      : []),
    "",
    `${copy.cta}: ${url}`,
    "",
    `${copy.howItWorks} ${copy.expiredHelp}`,
    copy.ignore,
    "",
    copy.footer,
  ].join("\n");

  return { subject: copy.subject, html, text };
}

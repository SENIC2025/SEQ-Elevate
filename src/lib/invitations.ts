/**
 * Sending invitation emails (D27).
 *
 * A plain server module — deliberately NOT "use server": every export of such
 * a module is a public HTTP endpoint, and this one sends email. It is reached
 * only through the ADMIN-gated actions in app/actions/admin.ts.
 *
 * How the link is made: we ask Auth.js to sign the invitee in with the
 * dedicated "invite" email provider. Auth.js creates a standard one-click
 * verification link (valid INVITE_VALID_DAYS) and hands it to the provider's
 * sendVerificationRequest in auth.ts, which renders it with the copy built
 * here. The whole call runs inside withInviteIntent(), which is what lets
 * auth.ts refuse anyone else who tries to use the provider.
 */

import { headers } from "next/headers";
import { createTranslator } from "next-intl";
import type { Role } from "@prisma/client";
import { signIn } from "@/auth";
import { checkRateLimit, hashKey } from "@/lib/rate-limit";
import {
  INVITE_PROVIDER,
  INVITE_VALID_DAYS,
  withInviteIntent,
} from "@/lib/invite-context";
import type { InviteCopy } from "@/lib/invite-email";
import { featuredWorkspaces, primaryRole } from "@/lib/workspaces";
import type { Locale } from "@/lib/cms/types";

export type InviteResult =
  | { ok: true }
  | { ok: false; error: "rate-limited" | "send-failed" };

/** What happened to someone's invitation, as reported to the admin UI. */
export type InviteOutcome =
  | "sent"
  | "already-joined"
  | "not-requested"
  | "rate-limited"
  | "send-failed";

// Bounded so a mistake — or a compromised admin account — can't turn this
// into a mass-mailer: a few resends per person, a busy afternoon per admin.
const PER_ADDRESS = { limit: 5, windowMs: 60 * 60 * 1000 };
const PER_ADMIN = { limit: 100, windowMs: 60 * 60 * 1000 };

const ROLE_KEY: Record<Role, string> = {
  ADMIN: "admin",
  CONTENT_EDITOR: "contentEditor",
  FACILITATOR: "facilitator",
  LEARNER: "learner",
};

export async function sendInvitation(opts: {
  email: string;
  name: string | null;
  roles: Role[];
  locale: Locale;
  inviter: { id: string; name: string | null; email: string };
}): Promise<InviteResult> {
  const email = opts.email.trim().toLowerCase();
  const [perAddress, perAdmin] = await Promise.all([
    checkRateLimit(hashKey("invite", email), PER_ADDRESS),
    checkRateLimit(`invite-by:${opts.inviter.id}`, PER_ADMIN),
  ]);
  if (!perAddress.ok || !perAdmin.ok) {
    return { ok: false, error: "rate-limited" };
  }

  try {
    const copy = await buildCopy(opts);
    await withInviteIntent({ email, copy }, () =>
      signIn(INVITE_PROVIDER, {
        email,
        redirect: false,
        // After joining they land on "Your workspaces", in their language.
        redirectTo: `/${opts.locale}`,
      })
    );
    return { ok: true };
  } catch (e) {
    console.error("[invite] sending failed", e);
    return { ok: false, error: "send-failed" };
  }
}

/**
 * Build the copy in the INVITEE's language. We translate with an explicit
 * locale rather than the request's, because the admin's screen may be in a
 * different language from the person they are inviting.
 */
async function buildCopy(opts: {
  name: string | null;
  roles: Role[];
  locale: Locale;
  inviter: { name: string | null; email: string };
}): Promise<InviteCopy> {
  const messages = (await import(`../messages/${opts.locale}.json`)).default;
  const t = createTranslator({ locale: opts.locale, messages, namespace: "invite" });
  const tRoles = createTranslator({ locale: opts.locale, messages, namespace: "roles" });
  const tHub = createTranslator({ locale: opts.locale, messages, namespace: "hub" });
  const name = opts.name?.trim();

  return {
    lang: opts.locale,
    subject: t("subject"),
    preheader: t("preheader"),
    greeting: name ? t("greetingNamed", { name }) : t("greeting"),
    intro: t("intro"),
    invitedBy: t("invitedBy", {
      inviter: opts.inviter.name?.trim() || opts.inviter.email,
    }),
    role: t("role", { role: tRoles(ROLE_KEY[primaryRole(opts.roles)]) }),
    capabilitiesTitle: t("capabilitiesTitle"),
    capabilities: featuredWorkspaces(opts.roles).map((w) => ({
      title: tHub(`${w.id}.title`),
      desc: tHub(`${w.id}.desc`),
    })),
    cta: t("cta"),
    howItWorks: t("howItWorks", { days: INVITE_VALID_DAYS }),
    expiredHelp: t("expiredHelp", { site: await siteHost() }),
    ignore: t("ignore"),
    footer: t("footer"),
  };
}

/** The public host people should type if their link has expired. */
async function siteHost(): Promise<string> {
  const configured = process.env.AUTH_URL;
  if (configured) {
    try {
      return new URL(configured).host;
    } catch {
      /* fall through to the request host */
    }
  }
  const h = await headers();
  return h.get("x-forwarded-host") ?? h.get("host") ?? "seq-elevate.eu";
}

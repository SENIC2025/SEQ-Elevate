/**
 * NextAuth.js v5 (Auth.js) configuration.
 *
 * Strategy: passwordless magic-link via email (Resend in production).
 * Database sessions via the Prisma adapter (required for the email
 * provider). Runs in the Node runtime — NOT used in middleware — so the
 * Prisma adapter works without edge-runtime gymnastics. Locale routing
 * stays in proxy.ts; auth gating happens in server components via the
 * helpers in src/lib/auth-helpers.ts.
 *
 * Dev without a Resend key: the magic link is logged to the server
 * console (look for "🔗 Magic link"). This makes auth fully testable
 * locally and on staging before the real RESEND_API_KEY is provisioned.
 */

import NextAuth from "next-auth";
import { headers } from "next/headers";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Resend from "next-auth/providers/resend";
import { prisma } from "@/lib/prisma";
import { DEMO_PROFILES } from "@/lib/demo-profiles";
import { demoLoginAllowed } from "@/lib/demo-gate";
import { refusingDemoSessions } from "@/lib/demo-session";
import { normalizeIdentifier } from "@/lib/signin-address";
import { checkSignInEmail } from "@/lib/signin-email-limits";
import { SIGN_IN_EMAIL_LIMITED } from "@/lib/signin-result";
import {
  BOOTSTRAP_PROJECT,
  BOOTSTRAP_ROLES,
  isBootstrapAdmin,
} from "@/lib/admin-bootstrap";
import { ensureProjectRoles } from "@/lib/role-grants";
import {
  INVITE_PROVIDER,
  INVITE_VALID_DAYS,
  currentInviteIntent,
} from "@/lib/invite-context";
import { renderInviteEmail, renderSignInEmail } from "@/lib/invite-email";
import type { Role } from "@prisma/client";

const SIGN_IN_PAGE = "/en/signin";

const EMAIL_FROM = process.env.EMAIL_FROM ?? "SEQ Elevate <no-reply@senic.world>";

const hasRealResendKey =
  !!process.env.RESEND_API_KEY &&
  process.env.RESEND_API_KEY.startsWith("re_") &&
  process.env.RESEND_API_KEY !== "re_placeholder";

// Without a real key, local dev / CI print links to the console instead of
// emailing them. The live site must never do that: it would silently send
// nothing AND put working sign-in links into the server logs.
const isLiveSite = process.env.VERCEL_ENV === "production";
const EMAIL_NOT_CONFIGURED =
  "Email sending is not set up on this site (RESEND_API_KEY is missing).";

/**
 * The request's x-forwarded-for header, for the per-client sign-in email
 * limit (D116). Auth.js runs inside a request (its route, or the sign-in
 * form's server action); outside one there is none, and the request counts
 * in the limit's fixed bucket.
 */
async function forwardedFor(): Promise<string | null> {
  try {
    return (await headers()).get("x-forwarded-for");
  } catch {
    return null;
  }
}

/**
 * Send one transactional email through Resend (sign-in links, invitations).
 * Logs Resend's verdict — the email id on success, Resend's own reason on
 * failure — with only the recipient's domain, never the full address.
 */
async function sendEmail(
  kind: "sign-in" | "invitation",
  mail: { to: string; subject: string; html: string; text: string }
) {
  const { Resend: ResendClient } = await import("resend");
  const client = new ResendClient(process.env.RESEND_API_KEY!);
  const { data, error } = await client.emails.send({ from: EMAIL_FROM, ...mail });
  const toDomain = mail.to.split("@")[1] ?? "?";
  if (error) {
    console.error(
      `[email] Resend refused the ${kind} email to …@${toDomain}: ${error.name} (${error.statusCode ?? "no status"}) — ${error.message}`
    );
    throw new Error(error.message || "The email service refused the email.");
  }
  console.info(
    `[email] Resend accepted the ${kind} email to …@${toDomain} (id ${data?.id ?? "unknown"})`
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // A demo sign-in's session ("demo-…") resolves to no one wherever demo
  // sign-in isn't allowed (SS6, D98; demo-session.ts): one left in a
  // database can never act on a deployment without demo sign-in.
  adapter: refusingDemoSessions(PrismaAdapter(prisma)),
  // Self-hosted (Hetzner) — not behind Vercel's host detection, so we
  // trust the configured host explicitly. AUTH_URL pins it in prod.
  trustHost: true,
  session: { strategy: "database" },
  pages: {
    signIn: SIGN_IN_PAGE,
    verifyRequest: "/en/signin/check-email",
  },
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY ?? "re_placeholder",
      from: EMAIL_FROM,
      // The sign-in address rule (D116): normalised, then checked; anything
      // else is refused before it is looked up, stored or mailed.
      normalizeIdentifier,
      // The sign-in email limits (per client, per address, per hour; D116)
      // are checked in the signIn callback below, before a link is made.
      async sendVerificationRequest({ identifier, url }) {
        // Dev / no-key fallback: log the magic link so auth is testable
        // without email delivery configured. Never on the live site.
        if (!hasRealResendKey) {
          if (isLiveSite) throw new Error(EMAIL_NOT_CONFIGURED);
          console.log("\n🔗 Magic link for", identifier);
          console.log("   ", url, "\n");
          return;
        }

        // Production: send via Resend.
        await sendEmail("sign-in", {
          to: identifier,
          subject: "Your SEQ Elevate sign-in link",
          ...renderSignInEmail(url),
        });
      },
    }),
    // Invitations (D27): a second email provider, so an invitation link can
    // stay valid for a week while ordinary sign-in links keep Auth.js's
    // 24 hours. Only ever used by an admin's invite action — the signIn
    // callback below refuses everything else.
    Resend({
      id: INVITE_PROVIDER,
      name: "Invitation",
      apiKey: process.env.RESEND_API_KEY ?? "re_placeholder",
      from: EMAIL_FROM,
      maxAge: INVITE_VALID_DAYS * 24 * 60 * 60,
      // The same address rule as sign-in (D116).
      normalizeIdentifier,
      async sendVerificationRequest({ identifier, url }) {
        const intent = currentInviteIntent();
        // Defence in depth: the signIn callback has already refused anything
        // that isn't an admin inviting exactly this address.
        if (!intent || intent.email !== identifier) {
          throw new Error("No invitation in progress for this address.");
        }
        try {
          const mail = renderInviteEmail({ url, copy: intent.copy });
          if (!hasRealResendKey) {
            if (isLiveSite) throw new Error(EMAIL_NOT_CONFIGURED);
            console.log("\n✉️  Invitation link for", identifier);
            console.log("   ", url, "\n");
            return;
          }
          await sendEmail("invitation", { to: identifier, ...mail });
        } catch (e) {
          // Auth.js swallows this error and reports only a generic failure;
          // record the real reason so the admin can be told what happened.
          intent.failure = e instanceof Error ? e.message : String(e);
          throw e;
        }
      },
    }),
  ],
  callbacks: {
    // Invitation gate (D27). Auth.js serves every provider publicly at
    // /api/auth/signin/<id>, and calls this BEFORE creating a link or sending
    // anything. For the invitation provider we allow the request only when an
    // admin's server action is inviting exactly this address in this very
    // async context (withInviteIntent). Clicking the link later is not a
    // verificationRequest, so joining still works.
    //
    // Sign-in emails (D116): the per-client, per-address and hourly limits,
    // checked here so that over any of them no link is made and nothing is
    // sent. The request is sent to the sign-in page with error=rate-limited,
    // which the sign-in form (and page) say in the reader's language. The
    // address is Auth.js's, already normalised by normalizeIdentifier.
    async signIn({ user, account, email }) {
      if (account?.provider === INVITE_PROVIDER && email?.verificationRequest) {
        const intent = currentInviteIntent();
        return !!intent && intent.email === user.email?.trim().toLowerCase();
      }
      if (account?.provider === "resend" && email?.verificationRequest) {
        const verdict = await checkSignInEmail({
          address: account.providerAccountId,
          forwardedFor: await forwardedFor(),
        });
        if (!verdict.ok) {
          console.warn(`[auth] sign-in email refused: over the ${verdict.limit} limit`);
          return `${SIGN_IN_PAGE}?error=${SIGN_IN_EMAIL_LIMITED}`;
        }
      }
      return true;
    },
    // What the session carries (D97): the user's id, email and name, and when
    // it expires. Nothing else of the user or session row (Auth.js passes
    // both whole), and never roles or an organisation: those are read from
    // the database on every request (auth-helpers.ts, scope.ts).
    async session({ session, user }) {
      return {
        user: { id: user.id, email: user.email, name: user.name ?? null },
        expires: session.expires,
      };
    },
  },
  events: {
    // Role bootstrap on sign-in. Two server-controlled sources — a signed-in
    // user can never choose their own role:
    //   1. ADMIN_EMAILS allow-list (production path) → ADMIN + CONTENT_EDITOR.
    //   2. Demo profiles → only where demo sign-in is allowed (demo-gate.ts:
    //      opt-in, never on production).
    // Everyone else signs in with no elevated role and is added via People.
    // (The allow-list is also re-applied on every page load — see
    // getMemberships — so this is the fast path, not the only one.)
    async signIn({ user }) {
      if (!user?.id || !user.email) return;
      const email = user.email.trim().toLowerCase();
      const rolesToGrant = new Set<Role>();

      // 1. Production admin allow-list.
      if (isBootstrapAdmin(email)) {
        for (const r of BOOTSTRAP_ROLES) rolesToGrant.add(r);
      }

      // 2. Demo profiles — only where demo sign-in is allowed (D98).
      if (demoLoginAllowed()) {
        const profile = DEMO_PROFILES.find((p) => p.email === email);
        if (profile) for (const r of profile.roles) rolesToGrant.add(r as Role);
      }

      // A failed grant must never block sign-in; the page-load path retries.
      try {
        await ensureProjectRoles(user.id, BOOTSTRAP_PROJECT, rolesToGrant);
      } catch (e) {
        console.error("[auth] role grant on sign-in failed", e);
      }
    },
  },
});

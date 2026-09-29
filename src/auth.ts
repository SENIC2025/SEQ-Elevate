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
import { PrismaAdapter } from "@auth/prisma-adapter";
import Resend from "next-auth/providers/resend";
import { prisma } from "@/lib/prisma";
import { DEMO_PROFILES } from "@/lib/demo-profiles";
import { checkRateLimit, hashKey } from "@/lib/rate-limit";
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
import {
  emailHeaderHtml,
  escapeHtml,
  renderInviteEmail,
} from "@/lib/invite-email";
import type { Role } from "@prisma/client";

// Cap magic-link requests per email so the endpoint can't be used to
// email-bomb a victim's inbox. Generous enough that a real user retrying
// never hits it; abuse does.
const MAGIC_LINK_LIMIT = 5;
const MAGIC_LINK_WINDOW_MS = 15 * 60 * 1000;

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
  adapter: PrismaAdapter(prisma),
  // Self-hosted (Hetzner) — not behind Vercel's host detection, so we
  // trust the configured host explicitly. AUTH_URL pins it in prod.
  trustHost: true,
  session: { strategy: "database" },
  pages: {
    signIn: "/en/signin",
    verifyRequest: "/en/signin/check-email",
  },
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY ?? "re_placeholder",
      from: EMAIL_FROM,
      async sendVerificationRequest({ identifier, url }) {
        // Abuse guard: cap how often a link can be requested for one email, so
        // the endpoint can't be turned into an inbox-flooding tool. Keyed by a
        // hash of the email — no address is stored in the limiter.
        const rl = await checkRateLimit(hashKey("magiclink", identifier), {
          limit: MAGIC_LINK_LIMIT,
          windowMs: MAGIC_LINK_WINDOW_MS,
        });
        if (!rl.ok) {
          throw new Error(
            "Too many sign-in link requests. Please wait a few minutes and try again."
          );
        }

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
          html: magicLinkEmail(url),
          text: `Sign in to SEQ Elevate: ${url}`,
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
    async signIn({ user, account, email }) {
      if (account?.provider === INVITE_PROVIDER && email?.verificationRequest) {
        const intent = currentInviteIntent();
        return !!intent && intent.email === user.email?.trim().toLowerCase();
      }
      return true;
    },
    async session({ session, user }) {
      // Surface the user id on the session for downstream queries.
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  events: {
    // Role bootstrap on sign-in. Two server-controlled sources — a signed-in
    // user can never choose their own role:
    //   1. ADMIN_EMAILS allow-list (production path) → ADMIN + CONTENT_EDITOR.
    //   2. Demo profiles → showcase only; skipped once demo login is disabled,
    //      so a hardcoded demo email never silently becomes admin on real prod.
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

      // 2. Demo profiles — only while demo login is enabled (showcase deploys).
      if (process.env.DEMO_LOGIN_DISABLED !== "true") {
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

function magicLinkEmail(url: string): string {
  return `
  <div style="font-family: Inter, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; color: #2e2e3d;">
    ${emailHeaderHtml(url)}
    <h1 style="font-size: 20px; margin: 0 0 12px;">Sign in to SEQ Elevate</h1>
    <p style="font-size: 14px; line-height: 1.6; color: #4d4d66;">Click the button below to sign in. This link works once and expires shortly.</p>
    <a href="${escapeHtml(url)}" style="display: inline-block; margin: 20px 0; background: #cad12c; color: #2e2e3d; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">Sign in</a>
    <p style="font-size: 12px; color: #4d4d66; line-height: 1.6;">If you didn't request this, you can safely ignore this email.</p>
    <p style="font-size: 11px; color: #4d4d66; border-top: 1px solid #e4e4e8; padding-top: 16px; margin-top: 24px;">Created and Powered by SENIC · senic.world</p>
  </div>`;
}

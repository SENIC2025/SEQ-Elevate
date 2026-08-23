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
import type { Role } from "@prisma/client";

// Cap magic-link requests per email so the endpoint can't be used to
// email-bomb a victim's inbox. Generous enough that a real user retrying
// never hits it; abuse does.
const MAGIC_LINK_LIMIT = 5;
const MAGIC_LINK_WINDOW_MS = 15 * 60 * 1000;

const hasRealResendKey =
  !!process.env.RESEND_API_KEY &&
  process.env.RESEND_API_KEY.startsWith("re_") &&
  process.env.RESEND_API_KEY !== "re_placeholder";

// Production admin bootstrap. Emails listed in ADMIN_EMAILS (comma / space /
// newline separated, case-insensitive) auto-receive ADMIN + CONTENT_EDITOR on
// sign-in, so the consortium's admins can manage people and author courses
// without anyone self-selecting a role. This is the only production path to the
// admin role; everyone else is added by an admin via Admin → People. Set it in
// Vercel and redeploy — read once at startup.
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS ?? "")
    .split(/[\s,]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

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
      from: process.env.EMAIL_FROM ?? "SEQ Elevate <no-reply@senic.world>",
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
        // without email delivery configured.
        if (!hasRealResendKey) {
          console.log("\n🔗 Magic link for", identifier);
          console.log("   ", url, "\n");
          return;
        }

        // Production: send via Resend.
        const { Resend: ResendClient } = await import("resend");
        const client = new ResendClient(process.env.RESEND_API_KEY!);
        const { error } = await client.emails.send({
          from: process.env.EMAIL_FROM ?? "SEQ Elevate <no-reply@senic.world>",
          to: identifier,
          subject: "Your SEQ Elevate sign-in link",
          html: magicLinkEmail(url),
          text: `Sign in to SEQ Elevate: ${url}`,
        });
        if (error) {
          throw new Error(`Resend error: ${JSON.stringify(error)}`);
        }
      },
    }),
  ],
  callbacks: {
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
    async signIn({ user }) {
      if (!user?.id || !user.email) return;
      const email = user.email.trim().toLowerCase();
      const rolesToGrant = new Set<Role>();

      // 1. Production admin allow-list.
      if (ADMIN_EMAILS.has(email)) {
        rolesToGrant.add("ADMIN");
        rolesToGrant.add("CONTENT_EDITOR");
      }

      // 2. Demo profiles — only while demo login is enabled (showcase deploys).
      if (process.env.DEMO_LOGIN_DISABLED !== "true") {
        const profile = DEMO_PROFILES.find((p) => p.email === email);
        if (profile) for (const r of profile.roles) rolesToGrant.add(r as Role);
      }

      for (const role of rolesToGrant) {
        await prisma.membership.upsert({
          where: {
            userId_projectId_role: {
              userId: user.id,
              projectId: "seq-elevate",
              role,
            },
          },
          create: { userId: user.id, projectId: "seq-elevate", role },
          update: {},
        });
      }
    },
  },
});

function magicLinkEmail(url: string): string {
  return `
  <div style="font-family: Inter, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; color: #2e2e3d;">
    <div style="border-bottom: 3px solid #cad12c; padding-bottom: 12px; margin-bottom: 24px;">
      <p style="font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 700; color: #7467ae; margin: 0;">SEQ Elevate</p>
    </div>
    <h1 style="font-size: 20px; margin: 0 0 12px;">Sign in to SEQ Elevate</h1>
    <p style="font-size: 14px; line-height: 1.6; color: #4d4d66;">Click the button below to sign in. This link works once and expires shortly.</p>
    <a href="${url}" style="display: inline-block; margin: 20px 0; background: #cad12c; color: #2e2e3d; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">Sign in</a>
    <p style="font-size: 12px; color: #4d4d66; line-height: 1.6;">If you didn't request this, you can safely ignore this email.</p>
    <p style="font-size: 11px; color: #4d4d66; border-top: 1px solid #e4e4e8; padding-top: 16px; margin-top: 24px;">Created and Powered by SENIC · senic.world</p>
  </div>`;
}

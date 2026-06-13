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

const hasRealResendKey =
  !!process.env.RESEND_API_KEY &&
  process.env.RESEND_API_KEY.startsWith("re_") &&
  process.env.RESEND_API_KEY !== "re_placeholder";

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

"use client";

import { SessionProvider } from "next-auth/react";

/**
 * Client wrapper for NextAuth's SessionProvider so client components can
 * read the auth state with useSession(). Authenticated users get
 * DB-backed state; guests fall back to localStorage (demo mode).
 */
export function SessionProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  // No background refetching — the session rarely changes mid-page and the
  // extra requests add load + test flakiness. Re-fetched on navigation.
  return (
    <SessionProvider refetchOnWindowFocus={false} refetchInterval={0}>
      {children}
    </SessionProvider>
  );
}

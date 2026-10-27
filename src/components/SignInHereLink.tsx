"use client";

import { usePathname } from "next/navigation";
import { LogIn } from "lucide-react";
import { signInHref } from "@/lib/sign-in-link";

/**
 * "Sign in", to the sign-in page in `locale` with this page's path as the
 * way back (signInHref). Only SignInPrompt draws it, and only for a visitor
 * who is signed out. `lang`: the link's language when it isn't the page's
 * (an English-only staff notice).
 */
export function SignInHereLink({ locale, label, lang }: { locale: string; label: string; lang?: string }) {
  const path = usePathname() ?? "";
  return (
    <a
      href={signInHref(locale, path)}
      lang={lang}
      className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
    >
      <LogIn className="h-4 w-4" aria-hidden />
      {label}
    </a>
  );
}

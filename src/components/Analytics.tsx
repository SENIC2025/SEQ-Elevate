import Script from "next/script";

/**
 * Plausible Analytics — cookieless, privacy-friendly, no PII, no cookie
 * banner needed (proposal §4 observability). Renders only when
 * NEXT_PUBLIC_PLAUSIBLE_DOMAIN is set, so dev/local stays clean.
 *
 * Self-hosted Plausible (on the same Hetzner box) or Plausible Cloud both
 * work; set NEXT_PUBLIC_PLAUSIBLE_SRC to the script URL if self-hosting.
 */
export function Analytics() {
  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  if (!domain) return null;

  const src =
    process.env.NEXT_PUBLIC_PLAUSIBLE_SRC ??
    "https://plausible.io/js/script.js";

  return (
    <Script
      defer
      data-domain={domain}
      src={src}
      strategy="afterInteractive"
    />
  );
}

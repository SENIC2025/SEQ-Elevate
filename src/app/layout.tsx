import type { Metadata } from "next";
import type { ReactNode } from "react";

// Site-wide metadata lives here, in the same segment as the file-based icons
// and link-preview images (favicon.ico, opengraph-image.png, …). Next merges
// those files only with config from their own segment: an `openGraph` object
// in a child layout would replace the preview image instead of adding to it.
export const metadata: Metadata = {
  // Canonical base for absolute OG/social URLs. AUTH_URL pins it in every real
  // environment (staging + production); the literal is only a build-time
  // fallback when AUTH_URL is unset. Production host is the apex seq-elevate.eu.
  metadataBase: new URL(
    process.env.AUTH_URL ?? "https://seq-elevate.eu"
  ),
  title: {
    default: "SEQ Elevate",
    template: "%s · SEQ Elevate",
  },
  description:
    "SEQ Elevate — a learning journey for skills that matter. Created and Powered by SENIC.",
  applicationName: "SEQ Elevate",
  appleWebApp: {
    capable: true,
    title: "SEQ Elevate",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "SEQ Elevate",
    description:
      "A learning journey for skills that matter — for life, work and what comes next.",
    siteName: "SEQ Elevate",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}

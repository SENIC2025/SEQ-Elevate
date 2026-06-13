import type { MetadataRoute } from "next";

/**
 * PWA manifest. Makes the platform installable / mobile-first per the
 * proposal (PWA shell, low-bandwidth). Icons reference the SVG app icon;
 * when the consortium supplies brand logo PNGs (192/512 maskable), add
 * them here for full install-icon support across platforms.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SEQ Elevate",
    short_name: "SEQ Elevate",
    description:
      "A learning journey for skills that matter — for life, work and what comes next.",
    start_url: "/en",
    display: "standalone",
    background_color: "#fcfdf4",
    theme_color: "#cad12c",
    lang: "en",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}

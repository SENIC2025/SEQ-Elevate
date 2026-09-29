import type { MetadataRoute } from "next";

/**
 * PWA manifest. Makes the platform installable / mobile-first per the
 * proposal (PWA shell, low-bandwidth). Icons are the official logo mark,
 * generated into public/brand by scripts/brand-assets.py: transparent
 * "any" icons, plus white "maskable" ones with the mark inside the safe
 * zone so Android launchers can crop them to their own shape.
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
        src: "/brand/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/brand/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

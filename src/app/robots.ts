import type { MetadataRoute } from "next";

/**
 * Staging is not for public indexing (it serves placeholder content and a
 * vulnerable target group). Disallow crawling until production go-live;
 * flip to allow + a real sitemap host then.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}

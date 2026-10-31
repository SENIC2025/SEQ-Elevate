import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { securityHeaders } from "./src/lib/security-headers";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Standalone output bundles a minimal server for Docker — small image,
  // no need to ship node_modules. Used by deploy/Dockerfile.
  output: "standalone",
  turbopack: {
    root: __dirname,
  },
  // Release 4 (spec 3.2): the browser's own-file host is the server's BLOB_PUBLIC_HOST, mapped at build time (src/lib/rich-text/own-file-host.ts reads it).
  env: { NEXT_PUBLIC_BLOB_PUBLIC_HOST: process.env.BLOB_PUBLIC_HOST ?? "" },
  // Release 3 (D95, spec 13.7): the security headers, on every response,
  // from this one place (src/lib/security-headers.ts says what each allows).
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders() }];
  },
};

export default withNextIntl(nextConfig);

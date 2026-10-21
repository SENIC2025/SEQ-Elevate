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
  // Release 3 (D95, spec 13.7): the security headers, on every response,
  // from this one place (src/lib/security-headers.ts says what each allows).
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders() }];
  },
};

export default withNextIntl(nextConfig);

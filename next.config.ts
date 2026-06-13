import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Standalone output bundles a minimal server for Docker — small image,
  // no need to ship node_modules. Used by deploy/Dockerfile.
  output: "standalone",
  turbopack: {
    root: __dirname,
  },
};

export default withNextIntl(nextConfig);

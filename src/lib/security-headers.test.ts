import { describe, it, expect, vi } from "vitest";
import {
  BLOB_WILDCARD_HOST,
  contentSecurityPolicy,
  cspReportOnly,
  PERMISSIONS_POLICY,
  securityHeaders,
} from "./security-headers";
import { cspReportOnly as switchesCspReportOnly } from "./r3-switches";

/*
 * Release 3 (D95, spec 13.7; UF3): the security headers. Every third-party
 * host is named on purpose: YouTube's script and the nocookie player frame,
 * the Blob store (exact, or every store while BLOB_PUBLIC_HOST is unset),
 * Vercel's upload API, and Plausible and Sentry only when they are
 * switched on. 'unsafe-eval' only for a development server; R3_CSP turns
 * the policy into a report.
 */

const quiet = () => {};
const policy = (env: Record<string, string | undefined>, dev = false) =>
  contentSecurityPolicy(env, { dev, warn: quiet });
/** The directive `name`'s sources, or null when the policy has no such directive. */
const directive = (csp: string, name: string): string[] | null => {
  const found = csp
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .find(([n]) => n === name);
  return found ? found.slice(1) : null;
};

const BLOB = "abc123xyz.public.blob.vercel-storage.com";

describe("contentSecurityPolicy", () => {
  it("is the policy of spec 13.7 for a production build with the Blob host set", () => {
    expect(policy({ BLOB_PUBLIC_HOST: BLOB })).toBe(
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://www.youtube.com",
        "style-src 'self' 'unsafe-inline'",
        `img-src 'self' data: blob: https://${BLOB}`,
        `media-src 'self' blob: https://${BLOB}`,
        "font-src 'self'",
        "connect-src 'self' https://vercel.com",
        `frame-src https://${BLOB} https://www.youtube-nocookie.com`,
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests",
      ].join("; ")
    );
  });

  it("allows 'unsafe-eval' on a development server only", () => {
    expect(directive(policy({ BLOB_PUBLIC_HOST: BLOB }, true), "script-src")).toContain("'unsafe-eval'");
    expect(policy({ BLOB_PUBLIC_HOST: BLOB }, false)).not.toContain("unsafe-eval");
    // Without an explicit choice, NODE_ENV decides.
    expect(contentSecurityPolicy({ NODE_ENV: "development" }, { warn: quiet })).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy({ NODE_ENV: "production" }, { warn: quiet })).not.toContain("'unsafe-eval'");
  });

  it("loads YouTube's player frame only from the nocookie domain, and its script from www.youtube.com", () => {
    const csp = policy({ BLOB_PUBLIC_HOST: BLOB });
    expect(directive(csp, "frame-src")).toEqual([`https://${BLOB}`, "https://www.youtube-nocookie.com"]);
    expect(directive(csp, "script-src")).toContain("https://www.youtube.com");
    expect(directive(csp, "frame-src")).not.toContain("https://www.youtube.com");
    expect(csp).not.toMatch(/ytimg|googlevideo/);
  });

  it("names the exact Blob host when it is set, on production too, and nothing else of Blob", () => {
    const warn = vi.fn();
    for (const env of [{}, { VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }]) {
      const exact = contentSecurityPolicy({ ...env, BLOB_PUBLIC_HOST: ` ${BLOB.toUpperCase()} ` }, { warn });
      for (const name of ["img-src", "media-src", "frame-src"]) expect(directive(exact, name)).toContain(`https://${BLOB}`);
      expect(exact).not.toContain(BLOB_WILDCARD_HOST);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("admits every Blob store while BLOB_PUBLIC_HOST is unset outside production (previews, local builds)", () => {
    for (const env of [{}, { BLOB_PUBLIC_HOST: "" }, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development", BLOB_PUBLIC_HOST: " " }]) {
      const csp = policy(env);
      for (const name of ["img-src", "media-src", "frame-src"]) {
        expect(directive(csp, name), JSON.stringify(env)).toContain("https://*.public.blob.vercel-storage.com");
      }
    }
  });

  it("admits no Blob store on production while BLOB_PUBLIC_HOST is unset: no upload can be saved there either (spec 10.3)", () => {
    for (const value of [undefined, "", "  "]) {
      const csp = policy({ VERCEL_ENV: "production", BLOB_PUBLIC_HOST: value });
      expect(csp, String(value)).not.toContain("blob.vercel-storage.com");
      expect(directive(csp, "img-src")).toEqual(["'self'", "data:", "blob:"]);
      expect(directive(csp, "media-src")).toEqual(["'self'", "blob:"]);
      expect(directive(csp, "frame-src")).toEqual(["https://www.youtube-nocookie.com"]);
      expect(csp.split(";")).toHaveLength(14);
    }
  });

  it("admits no Blob store when BLOB_PUBLIC_HOST names no single host, in any environment: no upload matches it", () => {
    // The media check (media-url.ts, spec 10.3) compares an upload's host
    // with the setting as written, so a URL or a path there matches no
    // upload; the policy admits none either, rather than every store.
    for (const value of [
      "https://abc123xyz.public.blob.vercel-storage.com",
      "abc123xyz.public.blob.vercel-storage.com/",
      "abc123xyz.public.blob.vercel-storage.com:443",
      "*.public.blob.vercel-storage.com",
    ]) {
      for (const env of [{}, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "production" }]) {
        const csp = policy({ ...env, BLOB_PUBLIC_HOST: value });
        expect(csp, `${value} ${JSON.stringify(env)}`).not.toContain("blob.vercel-storage.com");
        expect(directive(csp, "frame-src")).toEqual(["https://www.youtube-nocookie.com"]);
      }
    }
  });

  it("says once in the build log what it admits, without the value it couldn't read", async () => {
    vi.resetModules();
    const fresh = await import("./security-headers");
    const logged = vi.fn();
    fresh.blobHost({}, logged);
    fresh.blobHost({ BLOB_PUBLIC_HOST: "" }, logged);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0][0]).toMatch(/BLOB_PUBLIC_HOST is not set.*every Vercel Blob store/);
    fresh.blobHost({ BLOB_PUBLIC_HOST: "not a host" }, logged);
    expect(logged).toHaveBeenCalledTimes(2);
    expect(logged.mock.calls[1][0]).toMatch(/not one host name.*no Blob store/);
    expect(logged.mock.calls[1][0]).not.toContain("not a host");
    fresh.blobHost({ VERCEL_ENV: "production" }, logged);
    expect(logged).toHaveBeenCalledTimes(3);
    expect(logged.mock.calls[2][0]).toMatch(/BLOB_PUBLIC_HOST is not set on production.*no Blob store/);
  });

  it("never lets a setting add a directive or a source of its own", () => {
    for (const value of [
      "x.public.blob.vercel-storage.com; script-src *",
      "https://x.public.blob.vercel-storage.com",
      "x.public.blob.vercel-storage.com/path",
      "*.example.org",
      "'unsafe-eval'",
      "localhost",
    ]) {
      const csp = policy({ BLOB_PUBLIC_HOST: value });
      expect(directive(csp, "img-src"), value).toEqual(["'self'", "data:", "blob:"]);
      expect(csp.split(";")).toHaveLength(14);
    }
    // Only an https origin is taken from a script address or a DSN.
    const injected = policy({
      BLOB_PUBLIC_HOST: BLOB,
      NEXT_PUBLIC_PLAUSIBLE_DOMAIN: "seq-elevate.eu",
      NEXT_PUBLIC_PLAUSIBLE_SRC: "https://stats.example.org/js/script.js; script-src *",
    });
    expect(directive(injected, "script-src")).toEqual([
      "'self'",
      "'unsafe-inline'",
      "https://www.youtube.com",
      "https://stats.example.org",
    ]);
    expect(injected.split(";")).toHaveLength(14);
    const plain = policy({
      BLOB_PUBLIC_HOST: BLOB,
      NEXT_PUBLIC_PLAUSIBLE_DOMAIN: "seq-elevate.eu",
      NEXT_PUBLIC_PLAUSIBLE_SRC: "http://stats.example.org/js/script.js",
      NEXT_PUBLIC_SENTRY_DSN: "http://key@o1.ingest.sentry.io/2",
    });
    expect(directive(plain, "script-src")).toEqual(["'self'", "'unsafe-inline'", "https://www.youtube.com"]);
    expect(directive(plain, "connect-src")).toEqual(["'self'", "https://vercel.com"]);
  });

  it("names Plausible only when it is switched on: plausible.io, or the host of a self-hosted script", () => {
    expect(policy({ BLOB_PUBLIC_HOST: BLOB, NEXT_PUBLIC_PLAUSIBLE_SRC: "https://stats.example.org/js/script.js" })).not.toMatch(
      /plausible|stats\.example/
    );
    const cloud = policy({ BLOB_PUBLIC_HOST: BLOB, NEXT_PUBLIC_PLAUSIBLE_DOMAIN: "seq-elevate.eu" });
    expect(directive(cloud, "script-src")).toContain("https://plausible.io");
    expect(directive(cloud, "connect-src")).toContain("https://plausible.io");
    const own = policy({
      BLOB_PUBLIC_HOST: BLOB,
      NEXT_PUBLIC_PLAUSIBLE_DOMAIN: "seq-elevate.eu",
      NEXT_PUBLIC_PLAUSIBLE_SRC: "https://stats.example.org/js/script.js",
    });
    expect(directive(own, "script-src")).toContain("https://stats.example.org");
    expect(directive(own, "connect-src")).toContain("https://stats.example.org");
    expect(own).not.toContain("plausible.io");
  });

  it("names Sentry's ingest host only when the browser's DSN is set", () => {
    expect(policy({ BLOB_PUBLIC_HOST: BLOB, SENTRY_DSN: "https://key@o1.ingest.sentry.io/2" })).not.toContain("sentry");
    const csp = policy({ BLOB_PUBLIC_HOST: BLOB, NEXT_PUBLIC_SENTRY_DSN: "https://key@o1.ingest.de.sentry.io/2" });
    expect(directive(csp, "connect-src")).toEqual(["'self'", "https://vercel.com", "https://o1.ingest.de.sentry.io"]);
    expect(directive(csp, "script-src")).not.toContain("https://o1.ingest.de.sentry.io");
    // The DSN's key never reaches the header.
    expect(csp).not.toContain("key@");
  });
});

describe("securityHeaders", () => {
  const byKey = (env: Record<string, string | undefined>) =>
    Object.fromEntries(securityHeaders(env, { warn: quiet }).map((h) => [h.key, h.value]));

  it("sends the policy and the four other headers", () => {
    const headers = byKey({ BLOB_PUBLIC_HOST: BLOB });
    expect(Object.keys(headers)).toEqual([
      "Content-Security-Policy",
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]);
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toBe(PERMISSIONS_POLICY);
  });

  it("switches the policy to a report with R3_CSP=report-only, and keeps the other headers", () => {
    const headers = byKey({ BLOB_PUBLIC_HOST: BLOB, R3_CSP: " Report-Only " });
    expect(headers["Content-Security-Policy"]).toBeUndefined();
    expect(headers["Content-Security-Policy-Report-Only"]).toBe(policy({ BLOB_PUBLIC_HOST: BLOB }));
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Permissions-Policy"]).toBe(PERMISSIONS_POLICY);
    for (const value of [undefined, "", "off", "report", "enforce"]) {
      expect(byKey({ BLOB_PUBLIC_HOST: BLOB, R3_CSP: value })["Content-Security-Policy"], String(value)).toBeTruthy();
    }
  });

  it("reads R3_CSP as r3-switches.ts does", () => {
    for (const value of [undefined, "", "report-only", " REPORT-ONLY ", "report_only", "off", "on"]) {
      expect(cspReportOnly({ R3_CSP: value }), String(value)).toBe(switchesCspReportOnly({ R3_CSP: value }));
    }
  });

  it("turns off the browser features no page uses, and lets only the YouTube player frame play full screen and on its own", () => {
    const parts = PERMISSIONS_POLICY.split(", ");
    for (const off of ["camera", "microphone", "geolocation", "payment", "usb", "browsing-topics"]) {
      expect(parts).toContain(`${off}=()`);
    }
    for (const player of ["fullscreen", "autoplay", "encrypted-media", "picture-in-picture"]) {
      expect(parts).toContain(`${player}=(self "https://www.youtube-nocookie.com")`);
    }
  });
});

describe("next.config.ts", () => {
  it("sends the headers on every path, from this module", async () => {
    const config = (await import("../../next.config")).default;
    const routes = await config.headers!();
    expect(routes).toEqual([{ source: "/(.*)", headers: securityHeaders(process.env, { warn: quiet }) }]);
  });
});

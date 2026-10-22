import { MAX_HREF_CHARS } from "./link-url";

/**
 * Test data for the link tests of lesson text (Release 4, spec 10.1: U3,
 * U8, U21): addresses of every kind the address check (link-url.ts) has a
 * rule for, accepted and refused, as a link mark could carry them. The
 * tests take checkLinkHref's answer as the expectation, so a row needs no
 * expected value: what the check accepts must be kept, normalised, and
 * nothing else.
 *
 * Not imported by the app.
 */

const base = "https://example.org/";

export const LINK_INPUTS: readonly unknown[] = [
  // Accepted.
  "https://example.org/guide",
  "http://example.org",
  "HTTPS://Example.ORG/Path",
  "HtTp://example.org/x",
  "  https://example.org/x \t\n",
  "https://example.org/a/b?x=1&y=2#top",
  "https://192.0.2.1/x",
  "https://example.org./x",
  "https://bücher.example/straße",
  "https://ελληνικά.example/άρθρο",
  "https://example.org:8443/x",
  base + "a".repeat(MAX_HREF_CHARS - base.length),
  "mailto:help@example.org",
  "MAILTO:HELP@example.org",
  "mailto:help@example.org?subject=Course%20question",
  "mailto:info@bücher.example",
  "https://other999.public.blob.vercel-storage.com/handout.pdf",
  // Refused.
  42,
  { href: "https://example.org" },
  ["https://example.org"],
  null,
  undefined,
  "",
  "   \t ",
  base + "a".repeat(MAX_HREF_CHARS - base.length + 1),
  "java\tscript:alert(1)",
  "https://exa\tmple.org",
  "https://example.org/a b",
  "https://example.org/\u00a0",
  "https://example.org/\u202Egpj.exe",
  "https://exa\u200Bmple.org",
  "\uFEFFhttps://example.org",
  "https://example.org/\u0000",
  "https://example.org/\u0085",
  "https://example.org/\u007F",
  "https://example.org/\u2066x",
  "mailto:help@example.org?subject=\uD800",
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  " javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "file:///C:/x",
  "tel:+3212345678",
  "https:evil.example",
  "https:/evil.example",
  "https:\\\\evil.example",
  "//evil.example",
  "/x",
  "#x",
  "www.example.org",
  "help@example.org",
  "ftp://example.org/x",
  "https://user:pw@evil.example",
  "https://bank.example@evil.example",
  "https://localhost/x",
  "https://example..org/x",
  "https://./x",
  "https://[2001:db8::1]/x",
  "https://example.org:99999/x",
  "https://",
  "https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.org&data=someone%40example.org",
  "https://eur01.safelinks.protection.outlook.com./?url=https%3A%2F%2Fexample.org",
  "https://SafeLinks.Protection.Outlook.com/?url=x",
  "mailto:help@example.org?cc=someone@example.org",
  "mailto:help@example.org?bcc=someone@example.org",
  "mailto:help@example.org?body=Hello",
  "mailto:help@example.org?subject=Hi&cc=someone@example.org",
  "mailto:help@example.org?subject=Hi%0D%0Abcc:someone@example.org",
  "mailto:help@example.org?",
  "mailto:",
  "mailto:a@example.org,b@example.org",
  "mailto:help@localhost",
  "mailto:javascript:alert(1)",
];

/**
 * Seeded generated inputs for the link tests (Release 4, spec 10.1, U21):
 * addresses and texts built from a hostile alphabet, so the address check,
 * the sanitizer, the renderer and paste are tried on far more shapes than a
 * table holds. Seeded, so a failure names a seed and a case that can be run
 * again (the generator of sections.golden.test.ts).
 *
 * Not imported by the app.
 */

/** The seeds every generated test runs, and the cases per seed. */
export const SEEDS = [20261104, 7, 104729] as const;
export const CASES_PER_SEED = 2_000;

/** A seeded generator of numbers in [0, 1). */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Random = () => number;

export const pick = <T>(random: Random, items: readonly T[]): T => items[Math.floor(random() * items.length)];

/** Scheme fragments, in mixed case; what starts an address, or pretends to. */
const STARTS = [
  "https://", "http://", "mailto:", "HTTPS://", "HtTp://", "MailTo:", "https:", "http:/", "//", "/",
  "javascript:", "JaVaScRiPt:", "java\tscript:", "data:", "vbscript:", "file:", "file:///", "tel:", "#",
  "https:\\\\", " https://", "\u0000https://", "﻿https://", "", "www.",
];

/** Hosts and labels: ordinary, look-alike, international, punycode, wrappers, our file store. */
const HOSTS = [
  "example.org", "evil.example", "bank.example", "www.example.org", "localhost", "192.0.2.1", "[2001:db8::1]",
  "bücher.example", "xn--bcher-kva.example", "ελληνικά.example", "ex​ample.org", "example..org", ".", "a",
  "eur01.safelinks.protection.outlook.com", "safelinks.protection.outlook.com.evil.example",
  "e2e-store.public.blob.vercel-storage.com", "www.google.com", "example.org:8443", "example.org:99999",
  "user:pw@example.org", "bank.example@evil.example",
];

/** Everything else: separators, escapes, controls, invisible marks, queries. */
const PIECES = [
  ":", "/", "\\", "@", "%", "%0D%0A", "%2F", "%00", "#", "?", "&", "=", ".", "-", "_", "~", "'", '"', "<", ">", "`",
  "(", ")", "[", "]", " ", "\t", "\n", "\u0007", "\u007F", "\u0085", "‮", "⁦", "​", "‏", "﻿",
  "\uD800", "😊", "a", "Z", "0", "9", "ä", "ß", "ά", "path", "x.pdf", "?subject=Hi", "?cc=a@b.org", "&body=x",
  "?url=https%3A%2F%2Fexample.org%2Fx", "?url=javascript%3Aalert(1)", "?q=https%3A%2F%2Fevil.example%2F", "/url",
  "help@example.org", "info@bücher.example", "@evil.example", "alert(1)",
];

/** A generated address: a start, often a host, then a few pieces. */
export function generatedAddress(random: Random): string {
  let out = pick(random, STARTS);
  if (random() < 0.8) out += pick(random, HOSTS);
  const pieces = Math.floor(random() * 8);
  for (let i = 0; i < pieces; i++) out += pick(random, random() < 0.25 ? HOSTS : PIECES);
  if (random() < 0.02) out += "a".repeat(2_040 + Math.floor(random() * 20));
  return out;
}

/** Words for link text: plain, vague, or showing an address. */
const WORDS = [
  "the guide", "Read more", "click here", "hier", "εδώ", " ", "", "https://bank.", "example", "https://bank.example",
  "www.example.org", "help@example.org", "Kontakt: info@verein.de", "<script>alert(1)</script>", "a\u0000b", "😊",
];

/** Generated link text, sometimes an address itself. */
export function generatedText(random: Random): string {
  return random() < 0.3 ? generatedAddress(random) : pick(random, WORDS);
}

/** "seed 7, case 12: …" — names a generated case in a failure. */
export const caseName = (seed: number, i: number, value: unknown) =>
  `seed ${seed}, case ${i}: ${JSON.stringify(value)?.slice(0, 200)}`;

/**
 * What the quick-link reading (src/lib/rich-text/linkify.ts) costs, against
 * its budget: 10 ms per 10,000 characters of a block, the most a lesson
 * text block holds (RT_LIMITS.maxTextChars).
 *
 *   npx tsx scripts/linkify-cost.ts
 *
 * Measures, on this machine, the best of 15 runs of findLinks on blocks of
 * ordinary lesson text and on blocks built to be expensive: hosts of
 * thousands of different letters (which the URL parser would convert to
 * their ASCII form at a cost growing with the square of their length), and
 * the worst cases the unit tests time. Prints each, per 10,000 characters.
 * Exit code 0 when every one is within the budget, 1 otherwise. Run it on
 * a quiet machine: the unit test (linkify.test.ts) checks the same
 * hostile blocks against ordinary text by ratio, which holds under load;
 * this checks the absolute budget, which doesn't.
 */

import { findLinks } from "../src/lib/rich-text/linkify";

const BUDGET_MS_PER_10K = 10;

const letters = (from: number, n: number) => Array.from({ length: n }, (_, i) => String.fromCodePoint(from + i)).join("");
const paragraphs = [
  "Read more at https://www.bpb.de/themen/ or write to help@example.org before Friday.",
  "Μάθε περισσότερα στο https://παράδειγμα.ελ/σελίδα και γράψε στο info@example.gr.",
  "Mehr dazu unter https://www.bundesregierung.de/breg-de/themen (Stand: 2026).",
  "Pause before you answer. Ask why: who benefits, and who is left out?",
  "See (https://en.wikipedia.org/wiki/Social_enterprise) and mailto:team@example.org?subject=Hi.",
];
let ordinary = "";
for (let i = 0; ordinary.length < 9_900; i++) ordinary += `${paragraphs[i % paragraphs.length]} `;

const BLOCKS: [string, string][] = [
  ["ordinary text with addresses", ordinary],
  ["one host of 9,980 different letters", `https://${letters(0x4e00, 9_980)}.com`],
  ["four hosts of 2,490 different letters", Array.from({ length: 4 }, (_, k) => `https://${letters(0x4e00 + k * 2_490, 2_490)}.com`).join(" ")],
  ["38 hosts at the limit: 253 characters, labels of 63 different letters", Array.from({ length: 38 }, (_, k) => `https://${[0, 1, 2, 3].map((j) => letters(0x4e00 + (k * 4 + j) * 63, j === 3 ? 61 : 63)).join(".")}/`).join(" ")],
  ["a mailto: address of 9,970 different letters", `mailto:help@${letters(0x4e00, 9_970)}.com`],
  ["an email address of 9,980 different letters", `help@${letters(0x4e00, 9_980)}.com`],
  ["10,000 letters", "a".repeat(10_000)],
  ["10,000 @", "@".repeat(10_000)],
  ["a@ 5,000 times", "a@".repeat(5_000)],
  ["9,000 closing brackets", `https://example.org/${")".repeat(9_000)}`],
  ["4,990 one-letter labels", `https://${"a.".repeat(4_990)}`],
  ["https:// 1,200 times", "https://".repeat(1_200)],
  ["mailto: 1,400 times", "mailto:".repeat(1_400)],
];

let over = 0;
for (const [name, text] of BLOCKS) {
  let best = Infinity;
  for (let run = 0; run < 15; run++) {
    const started = performance.now();
    findLinks(text);
    best = Math.min(best, performance.now() - started);
  }
  const per10k = (best * 10_000) / text.length;
  const ok = per10k <= BUDGET_MS_PER_10K;
  if (!ok) over++;
  console.log(`${ok ? "ok  " : "OVER"} ${per10k.toFixed(2).padStart(7)} ms per 10,000 characters  ${name} (${text.length} characters)`);
}
console.log(over ? `${over} over the budget of ${BUDGET_MS_PER_10K} ms per 10,000 characters` : `all within ${BUDGET_MS_PER_10K} ms per 10,000 characters`);
process.exitCode = over ? 1 : 0;

/**
 * The code points the running JavaScript engine's Unicode leaves unassigned,
 * for src/lib/rich-text/unassigned.ts (D104): what link text reads alike in
 * the browser and on the server, whatever Unicode the browser has.
 *
 *   npx tsx scripts/unassigned-code-points.ts
 *
 * prints RANGES for unassigned.ts, with the Unicode version it comes from
 * (Node 22: Unicode 16.0). A code point invisible by default
 * (Default_Ignorable_Code_Point) is left out: link text reads it as nothing
 * in every version. unassigned.test.ts checks the file against this
 * script's output while the runtime's Unicode is 16.0.
 */

const UNASSIGNED = /^\p{Cn}$/u;
const SHOWS_NOTHING = /^\p{Default_Ignorable_Code_Point}$/u;

/** The runtime's unassigned code points that show something, as [first, last] ranges. */
export function unassignedRanges(): [number, number][] {
  const ranges: [number, number][] = [];
  let from = -1;
  for (let cp = 0; cp <= 0x110000; cp++) {
    const char = cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    const unassigned = char !== "" && UNASSIGNED.test(char) && !SHOWS_NOTHING.test(char);
    if (unassigned && from < 0) from = cp;
    if (!unassigned && from >= 0) {
      ranges.push([from, cp - 1]);
      from = -1;
    }
  }
  return ranges;
}

/** The ranges as unassigned.ts writes them: the first code point in base 36 and, for more than one, "-" and the count after it. */
export function rangesText(ranges: readonly [number, number][]): string {
  return ranges.map(([first, last]) => (first === last ? first.toString(36) : `${first.toString(36)}-${(last - first).toString(36)}`)).join(" ");
}

if (process.argv[1] && /unassigned-code-points\.ts$/.test(process.argv[1])) {
  const ranges = unassignedRanges();
  const words = rangesText(ranges).split(" ");
  console.log(`// Unicode ${process.versions.unicode} (Node ${process.versions.node}): ${ranges.length} ranges.`);
  console.log("const RANGES = `");
  for (let i = 0; i < words.length; i += 16) console.log(words.slice(i, i + 16).join(" "));
  console.log("`;");
}

/**
 * The public suffixes of more than one label that link text is compared by
 * (src/lib/rich-text/top-level-domains.ts, D104): the ICANN section of the
 * Public Suffix List as tldts-icann carries it. lighthouse, a development
 * dependency, brings tldts-icann; nothing of it reaches the app.
 *
 *   npx tsx scripts/public-suffixes.ts
 *
 * prints MULTI_LABEL and NOT_LISTED for top-level-domains.ts, with the
 * version they come from. A top-level domain's rules are listed all or not
 * at all: those with more than MAX_RULES_PER_DOMAIN (lists of towns,
 * regions and states) are named in NOT_LISTED instead, and a name under
 * them is compared by its exact host. top-level-domains.test.ts checks the
 * file against this script's output while tldts-icann 7.4.2 is installed.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { domainToASCII } from "node:url";

/** A top-level domain with more rules than this is left out (NOT_LISTED). */
export const MAX_RULES_PER_DOMAIN = 200;

/** The tldts-icann the script reads, through lighthouse (a development dependency). */
export function tldtsIcann(): { version: string; root: string; require: NodeJS.Require } {
  const fromLighthouse = createRequire(createRequire(import.meta.url).resolve("lighthouse"));
  const manifest = fromLighthouse.resolve("tldts-icann/package.json");
  const { version } = JSON.parse(readFileSync(manifest, "utf8")) as { version: string };
  return { version, root: dirname(manifest), require: createRequire(manifest) };
}

/** A typed array or string constant of tldts-icann's flat trie (src/data/trie.ts). */
function constant(source: string, name: string): string {
  const found = source.match(new RegExp(`export const ${name} = (?:/\\*#__PURE__\\*/ )?(new \\w+Array\\(\\[[^\\]]*\\]\\)|"(?:[^"\\\\]|\\\\.)*"|\\d+);`));
  if (!found) throw new Error(`tldts-icann's trie has no ${name}`);
  return found[1];
}

const numbers = (literal: string) => literal.slice(literal.indexOf("[") + 1, literal.lastIndexOf("]")).split(",").map(Number);

/** Every rule of the trie, as the Public Suffix List writes it ("co.uk", "*.ck", "!www.ck"), its labels in Unicode. */
export function trieRules(source: string): string[] {
  const nodeFlags = numbers(constant(source, "nodeFlags"));
  const edgeStart = numbers(constant(source, "edgeStart"));
  const edgeLength = numbers(constant(source, "edgeLength"));
  const edgeChild = numbers(constant(source, "edgeChild"));
  const labelText = JSON.parse(constant(source, "labelText")) as string;
  const rulesRoot = Number(constant(source, "rulesRoot"));
  const exceptionsRoot = Number(constant(source, "exceptionsRoot"));
  const edgeOffset: number[] = [];
  for (let node = 0, offset = 0; node < nodeFlags.length; node++) {
    for (let edge = edgeStart[node]; edge < edgeStart[node + 1]; edge++) {
      edgeOffset[edge] = offset;
      offset += edgeLength[edge];
    }
  }
  const rules: string[] = [];
  const walk = (node: number, labels: string[], prefix: string) => {
    if (nodeFlags[node] & 1 && labels.length) rules.push(prefix + [...labels].reverse().join("."));
    for (let edge = edgeStart[node]; edge < edgeStart[node + 1]; edge++) {
      const label = labelText.slice(edgeOffset[edge], edgeOffset[edge] + edgeLength[edge]);
      walk(edgeChild[edge], [...labels, label], prefix);
    }
  };
  walk(rulesRoot, [], "");
  walk(exceptionsRoot, [], "!");
  return rules;
}

/** A rule with its labels in ASCII, as the URL parser gives hostnames ("*" and "!" kept). */
function asciiRule(rule: string): string {
  const exception = rule.startsWith("!");
  const labels = (exception ? rule.slice(1) : rule).split(".").map((label) => {
    if (label === "*" || /^[a-z0-9-]+$/.test(label)) return label;
    const ascii = domainToASCII(label);
    if (!ascii) throw new Error(`no ASCII form for ${label}`);
    return ascii;
  });
  return (exception ? "!" : "") + labels.join(".");
}

export interface SuffixTable {
  /** The tldts-icann version read. */
  version: string;
  /** One line per top-level domain listed: the domain, then the labels before it of each of its rules. */
  lines: string[];
  /** The top-level domains whose rules of more than one label aren't listed. */
  notListed: string[];
}

/** The table, from the trie source of tldts-icann (its src/data/trie.ts). */
export function suffixTable(source: string, version: string): SuffixTable {
  const byDomain = new Map<string, string[]>();
  for (const rule of trieRules(source).map(asciiRule)) {
    const bare = rule.replace(/^!/, "");
    if (!bare.includes(".")) continue;
    const domain = bare.slice(bare.lastIndexOf(".") + 1);
    const before = rule.slice(0, rule.length - domain.length - 1);
    // tldts-icann holds an international rule in both its forms: one here.
    const known = byDomain.get(domain) ?? [];
    if (!known.includes(before)) byDomain.set(domain, [...known, before]);
  }
  const domains = [...byDomain.keys()].sort();
  const lines = domains
    .filter((domain) => byDomain.get(domain)!.length <= MAX_RULES_PER_DOMAIN)
    .map((domain) => [domain, ...byDomain.get(domain)!.sort()].join(" "));
  const notListed = domains.filter((domain) => byDomain.get(domain)!.length > MAX_RULES_PER_DOMAIN);
  return { version, lines, notListed };
}

/** The table from the installed tldts-icann. */
export function installedSuffixTable(): SuffixTable {
  const { version, root } = tldtsIcann();
  return suffixTable(readFileSync(join(root, "src", "data", "trie.ts"), "utf8"), version);
}

if (process.argv[1] && /public-suffixes\.ts$/.test(process.argv[1])) {
  const table = installedSuffixTable();
  const wrap = (words: string[], width = 100) => {
    const out: string[] = [];
    let line = "";
    for (const word of words) {
      if (line && line.length + 1 + word.length > width) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) out.push(line);
    return out;
  };
  console.log(`// tldts-icann ${table.version}: ${table.lines.length} top-level domains listed, ${table.notListed.length} not.`);
  console.log("const MULTI_LABEL = `");
  for (const line of table.lines) {
    const [first, ...rest] = wrap(line.split(" "));
    console.log(first);
    for (const more of rest) console.log(`  ${more}`);
  }
  console.log("`;");
  console.log(`const NOT_LISTED = ${JSON.stringify(table.notListed).replace(/,/g, ", ")};`);
}

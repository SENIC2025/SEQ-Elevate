import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";

/**
 * Guard: the three message files must stay in step. next-intl doesn't
 * type-check keys, so a key missing in German or Greek only shows up at
 * runtime — as a raw key path on the page, or in an invitation email. The
 * same goes for a placeholder or tag a translation dropped or renamed:
 * "{count} enrolled" rendering without the count.
 */

const FILES = { en, de, el } as const;

/** Every string in a messages file, keyed by its dotted path. */
function flatten(node: unknown, prefix = "", out = new Map<string, string>()) {
  if (typeof node === "string") {
    out.set(prefix, node);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else {
    out.set(prefix, `<${typeof node}>`);
  }
  return out;
}

/**
 * The argument names and rich-text tags an ICU message uses, e.g.
 * "{count, plural, one {# lesson} other {# lessons}} in <b>{title}</b>" →
 * ["<b>", "count", "title"]. Plural/select branch labels ("one", "=0") and
 * the words inside branches are text, not arguments.
 */
function placeholders(message: string): string[] {
  const found = new Set<string>();
  let i = 0;

  const readUntil = (stops: string) => {
    const start = i;
    while (i < message.length && !stops.includes(message[i])) i++;
    return message.slice(start, i).trim();
  };

  // Message text up to the "}" that closes it (or the end).
  const text = () => {
    while (i < message.length && message[i] !== "}") {
      if (message[i] === "{") {
        i++;
        argument();
      } else {
        const tag = /^<\/?([a-zA-Z][\w-]*)>/.exec(message.slice(i));
        if (tag) {
          found.add(`<${tag[1]}>`);
          i += tag[0].length;
        } else {
          i++;
        }
      }
    }
  };

  // After "{": name, then "}" or ", type[, style]" or ", plural, sel {…} …}".
  const argument = () => {
    found.add(readUntil(",}"));
    if (message[i] === "}") {
      i++;
      return;
    }
    i++; // ","
    const type = readUntil(",}");
    if (message[i] === ",") i++;
    if (type === "plural" || type === "select" || type === "selectordinal") {
      while (i < message.length && message[i] !== "}") {
        readUntil("{}"); // a branch label such as "one" or "=0"
        if (message[i] === "{") {
          i++;
          text();
          i++; // the branch's "}"
        }
      }
    } else {
      readUntil("}"); // a number/date style
    }
    i++; // the argument's "}"
  };

  text();
  return [...found].sort();
}

describe("placeholders", () => {
  it("finds arguments, plural arguments and tags", () => {
    expect(placeholders("Edited {when}")).toEqual(["when"]);
    expect(
      placeholders("{count, plural, =0 {Nobody} one {# lesson} other {# lessons}} in {title}")
    ).toEqual(["count", "title"]);
    expect(placeholders("<b>Preview.</b> Nothing is saved.")).toEqual(["<b>"]);
    expect(placeholders("No placeholders, just text.")).toEqual([]);
  });

  it("finds arguments nested inside plural branches", () => {
    expect(
      placeholders("{count, plural, one {# of {total}} other {# of {total}}}")
    ).toEqual(["count", "total"]);
  });
});

describe("message files", () => {
  const flat = Object.fromEntries(
    Object.entries(FILES).map(([locale, messages]) => [locale, flatten(messages)])
  ) as Record<keyof typeof FILES, Map<string, string>>;

  it("have the same keys in English, German and Greek", () => {
    const keys = [...flat.en.keys()].sort();
    expect([...flat.de.keys()].sort()).toEqual(keys);
    expect([...flat.el.keys()].sort()).toEqual(keys);
  });

  it("use the same placeholders and tags in every translation", () => {
    const mismatches: string[] = [];
    for (const [key, message] of flat.en) {
      const expected = placeholders(message).join(" ");
      for (const locale of ["de", "el"] as const) {
        const other = flat[locale].get(key);
        if (other === undefined) continue; // reported by the key test
        const actual = placeholders(other).join(" ");
        if (actual !== expected) {
          mismatches.push(`${locale} ${key}: [${actual}] vs en [${expected}]`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("have no empty strings", () => {
    const empty = Object.entries(flat).flatMap(([locale, map]) =>
      [...map].filter(([, v]) => !v.trim()).map(([k]) => `${locale} ${k}`)
    );
    expect(empty).toEqual([]);
  });
});

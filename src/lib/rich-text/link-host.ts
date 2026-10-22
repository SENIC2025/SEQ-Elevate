/**
 * The host rule of the address check (link-url.ts, D103): a web address's
 * host is accepted only when every browser and the server read it alike,
 * so the Link form, a save, the server's page and the learner's browser
 * always agree on whether an address is a link, and where it goes.
 *
 * The URL parser of each JavaScript engine turns an international host into
 * punycode by its own tables, so the engines differ at the edges. A host is
 * accepted only inside the part they share:
 * - as typed: ASCII letters, digits, "-", "_" and dots (the ideographic and
 *   fullwidth full stops count as dots), and other letters, combining marks
 *   and digits written as every engine keeps them (keptAlike: in lower case
 *   and normal form, of the Basic Multilingual Plane, not of Unicode's
 *   newest versions); never a character that is invisible by default (a
 *   soft hyphen, a Hangul filler), punctuation, a symbol or a percent sign;
 * - as parsed: every punycode label ("xn--…") decodes, and encodes back to
 *   itself, to such characters and "-" (at least one outside ASCII), not
 *   starting with a mark;
 * - right-to-left hosts follow the Bidi Rule (RFC 5893): Hebrew and
 *   Arabic-script letters (not the tatweel) and the two Arabic sets of
 *   digits, each label starting with a letter and, in a right-to-left label,
 *   ending with a letter or a digit; modifier letters and other numbers only
 *   in left-to-right hosts; other right-to-left scripts aren't accepted in a
 *   host.
 *
 * Pure, like link-url.ts: no DOM, no server imports.
 */

/** Characters a host may hold as typed, besides letters, marks and digits. */
const TYPED_ASCII = /^[A-Za-z0-9_.-]$/;
/** The full stops the URL parser reads as dots: ideographic, fullwidth, halfwidth ideographic. */
const TYPED_DOTS = new Set(["\u3002", "\uFF0E", "\uFF61"]);
const LETTER_MARK_DIGIT = /^[\p{L}\p{M}\p{N}]$/u;
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/u;

/** A web address's authority as typed: after "https:" or "http:" and the slashes, up to the path, query or fragment. */
function typedAuthority(address: string): string {
  const colon = address.indexOf(":");
  let from = colon + 1;
  while (from < address.length && (address[from] === "/" || address[from] === "\\")) from++;
  let to = from;
  while (to < address.length && !"/\\?#".includes(address[to])) to++;
  return address.slice(from, to);
}

/**
 * The host of a web address as typed: after "https:" or "http:" and the
 * slashes, up to the path, query or fragment, without a port. Null when it
 * holds a user name (an "@").
 */
export function typedHost(address: string): string | null {
  const authority = typedAuthority(address);
  if (authority.includes("@")) return null;
  return authority.replace(/:\d*$/, "");
}

/** The host the URL parser reads in a web address as typed: as typedHost, after a user name if it holds one. */
export function hostAfterUser(address: string): string {
  const authority = typedAuthority(address);
  return authority.slice(authority.lastIndexOf("@") + 1).replace(/:\d*$/, "");
}

/** DNS's limits (RFC 1035): a label of at most 63 characters, a host of at most 253 (without a final dot), as DNS writes them (in punycode). */
export const MAX_LABEL_CHARS = 63;
export const MAX_HOST_CHARS = 253;

/** Is `char` a full stop the URL parser reads as a dot? */
const isFullStop = (char: string) => char === "." || TYPED_DOTS.has(char);

/**
 * Does a host, as written, hold more than DNS can (RFC 1035): a label of
 * more than MAX_LABEL_CHARS characters, or more than MAX_HOST_CHARS in all
 * with its dots? Every character between full stops is counted, a letter,
 * a digit, a mark, a symbol or punctuation alike: as DNS writes the host
 * (in punycode) it is no shorter (the URL parser drops only characters the
 * address check refuses anyway: invisible ones and escapes), so such a host
 * is no host. Read once, without parsing, and only up to the first label
 * too long.
 */
export function beyondDns(host: string): boolean {
  let label = 0;
  let chars = 0;
  let stops = 0;
  let endsWithStop = false;
  for (const char of host) {
    endsWithStop = isFullStop(char);
    if (endsWithStop) {
      stops++;
      label = 0;
    } else if (++label > MAX_LABEL_CHARS || ++chars > MAX_HOST_CHARS) {
      return true;
    }
  }
  return chars + stops - (endsWithStop ? 1 : 0) > MAX_HOST_CHARS;
}

/** Letters whose lower case is their own, kept as they are by every engine (ß, final ς, dotless ı). */
const KEPT_SPECIAL = new Set(["\u00DF", "\u03C2", "\u0131"]);
/** Cherokee, whose letters the engines fold to upper case. */
const isCherokee = (cp: number) => (cp >= 0x13a0 && cp <= 0x13ff) || (cp >= 0xab70 && cp <= 0xabbf);
/**
 * Where the Basic Multilingual Plane gained letters and marks in Unicode 14
 * and later: Arabic Extended-B and the end of Extended-A, a Telugu and a Lao
 * mark, the end of the Combining Diacritical Marks Extended, Cyrillic
 * Extended-C's end, a combining mark, and the end of Latin Extended-D.
 */
const NEWER: readonly [number, number][] = [
  [0x0870, 0x089f],
  [0x08b5, 0x08b5],
  [0x08c8, 0x08d2],
  [0x0c3c, 0x0c3c],
  [0x0ece, 0x0ece],
  [0x1ac1, 0x1aff],
  [0x1c89, 0x1c8f],
  [0x1dfa, 0x1dfa],
  [0xa7c0, 0xa7ff],
];
const isNewer = (cp: number) => NEWER.some(([from, to]) => cp >= from && cp <= to);

/**
 * A host character outside ASCII that every engine keeps as it is: a
 * letter, mark or digit of the Basic Multilingual Plane (the engines' tables
 * differ on characters added to Unicode lately: those beyond it, and NEWER),
 * not Cherokee, not invisible, unchanged by compatibility normalisation, in
 * lower case and back to itself through upper case ("é", not "É", "ẞ" or
 * "ᾳ"; ß, ς and ı are kept as they are).
 */
function keptAlike(char: string): boolean {
  const cp = char.codePointAt(0) as number;
  if (cp > 0xffff || isCherokee(cp) || isNewer(cp)) return false;
  if (!LETTER_MARK_DIGIT.test(char) || INVISIBLE.test(char) || char.normalize("NFKC") !== char) return false;
  if (KEPT_SPECIAL.has(char)) return true;
  return char.toLowerCase() === char && char.toUpperCase().toLowerCase() === char;
}

/** Is every character of a host, as typed, one the rule allows? */
function typedHostOk(host: string): boolean {
  for (const char of host) {
    if (TYPED_ASCII.test(char) || TYPED_DOTS.has(char)) continue;
    if (char.charCodeAt(0) < 0x80 || !keptAlike(char)) return false;
  }
  return true;
}

/* ------------------------------ Punycode (RFC 3492) ------------------------------ */

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const MAX_INT = 0x7fffffff;

function adapt(delta: number, points: number, first: boolean): number {
  let d = first ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / points);
  let k = 0;
  while (d > ((BASE - T_MIN) * T_MAX) >> 1) {
    d = Math.floor(d / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW));
}

const threshold = (k: number, bias: number) => (k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias);

function digitValue(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 22;
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61;
  return BASE;
}

const digitChar = (d: number) => String.fromCharCode(d < 26 ? d + 0x61 : d + 22);

/** A punycode label's characters (without "xn--"), or null when it isn't one. */
export function punycodeDecode(input: string): string | null {
  const output: number[] = [];
  const delimiter = input.lastIndexOf("-");
  const basic = delimiter < 0 ? 0 : delimiter;
  for (let j = 0; j < basic; j++) {
    const code = input.charCodeAt(j);
    if (code >= 0x80) return null;
    output.push(code);
  }
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  for (let index = basic > 0 ? basic + 1 : 0; index < input.length; ) {
    const old = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (index >= input.length) return null;
      const digit = digitValue(input.charCodeAt(index++));
      if (digit >= BASE || digit > Math.floor((MAX_INT - i) / w)) return null;
      i += digit * w;
      const t = threshold(k, bias);
      if (digit < t) break;
      if (w > Math.floor(MAX_INT / (BASE - t))) return null;
      w *= BASE - t;
    }
    const length = output.length + 1;
    bias = adapt(i - old, length, old === 0);
    if (Math.floor(i / length) > MAX_INT - n) return null;
    n += Math.floor(i / length);
    i %= length;
    if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return null;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

/** A label's characters as punycode (without "xn--"). */
export function punycodeEncode(input: string): string {
  const points = Array.from(input, (char) => char.codePointAt(0) as number);
  let output = "";
  for (const point of points) if (point < 0x80) output += String.fromCharCode(point);
  const basic = output.length;
  let handled = basic;
  if (basic) output += "-";
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  while (handled < points.length) {
    let m = Infinity;
    for (const point of points) if (point >= n && point < m) m = point;
    delta += (m - n) * (handled + 1);
    n = m;
    for (const point of points) {
      if (point < n) delta++;
      if (point !== n) continue;
      let q = delta;
      for (let k = BASE; ; k += BASE) {
        const t = threshold(k, bias);
        if (q < t) break;
        output += digitChar(t + ((q - t) % (BASE - t)));
        q = Math.floor((q - t) / (BASE - t));
      }
      output += digitChar(q);
      bias = adapt(delta, handled + 1, handled === basic);
      delta = 0;
      handled++;
    }
    delta++;
    n++;
  }
  return output;
}

/**
 * A label of a parsed host in its own characters: an ASCII label as it is,
 * a punycode label decoded. Null when a punycode label doesn't decode to a
 * label that encodes back to it, of letters, marks, digits and "-" kept
 * alike (keptAlike, in lower case), in normal form, not starting with a mark.
 */
function labelChars(label: string): string | null {
  if (!label.startsWith("xn--")) return label;
  const encoded = label.slice(4);
  const decoded = punycodeDecode(encoded);
  if (decoded === null || !/[^\u0000-\u007f]/.test(decoded)) return null;
  if (punycodeEncode(decoded) !== encoded) return null;
  if (decoded !== decoded.normalize("NFC") || /^\p{M}/u.test(decoded)) return null;
  for (const char of decoded) {
    if (/^[a-z0-9-]$/.test(char)) continue;
    if (char.charCodeAt(0) < 0x80 || !keptAlike(char)) return null;
  }
  return decoded;
}

/* ------------------------------ Bidi Rule (RFC 5893) ------------------------------ */

/** "ON": allowed only in a left-to-right host ("_"); "X": never in a host. */
type Bidi = "L" | "R" | "AL" | "AN" | "EN" | "ES" | "NSM" | "ON" | "X";

const NONSPACING = /^[\p{Mn}\p{Me}]$/u;
const LETTER = /^\p{L}$/u;
const MODIFIER_OR_OTHER_NUMBER = /^[\p{Lm}\p{Nl}\p{No}]$/u;

/** Arabic, Syriac, Arabic Supplement, Thaana, Arabic Extended-B and -A: letters are AL. */
const isArabicScript = (cp: number) =>
  (cp >= 0x0600 && cp <= 0x07bf) || (cp >= 0x0870 && cp <= 0x08ff);
/** Every other right-to-left block: N'Ko to Syriac Supplement, presentation forms, and the supplementary planes' right-to-left blocks. */
const isOtherRightToLeft = (cp: number) =>
  (cp >= 0x07c0 && cp <= 0x086f) ||
  (cp >= 0xfb1d && cp <= 0xfdff) ||
  (cp >= 0xfe70 && cp <= 0xfeff) ||
  (cp >= 0x10800 && cp <= 0x10fff) ||
  (cp >= 0x1e800 && cp <= 0x1efff);

/** A host character's bidirectional class, as far as this rule needs it. */
function bidiClass(char: string): Bidi {
  const cp = char.codePointAt(0) as number;
  if (cp >= 0x30 && cp <= 0x39) return "EN";
  if (cp === 0x2d) return "ES";
  if (cp < 0x80) return /[a-z]/i.test(char) ? "L" : "ON";
  if (cp >= 0x0660 && cp <= 0x0669) return "AN";
  if (cp >= 0x06f0 && cp <= 0x06f9) return "EN";
  if (NONSPACING.test(char)) return "NSM";
  // The tatweel only stretches the letters beside it; the engines differ on it.
  if (cp === 0x0640) return "X";
  if (cp >= 0x0590 && cp <= 0x05ff) return LETTER.test(char) ? "R" : "X";
  if (isArabicScript(cp)) return LETTER.test(char) ? "AL" : "X";
  if (isOtherRightToLeft(cp)) return "X";
  // Modifier letters and digits other than decimal ones are neutral (or
  // European numbers) to the Bidi Rule: only in a left-to-right host.
  if (MODIFIER_OR_OTHER_NUMBER.test(char)) return "ON";
  return "L";
}

/** Do a host's labels (in their own characters) follow the Bidi Rule? */
function bidiRuleOk(labels: readonly string[]): boolean {
  const classes = labels.map((label) => Array.from(label, bidiClass));
  if (classes.some((label) => label.includes("X"))) return false;
  const rightToLeft = classes.some((label) => label.some((c) => c === "R" || c === "AL" || c === "AN"));
  // A host without either reads alike everywhere ("_" included).
  if (!rightToLeft) return true;
  for (const label of classes) {
    if (!label.length) continue;
    const first = label[0];
    let end = label.length - 1;
    while (end > 0 && label[end] === "NSM") end--;
    const last = label[end];
    if (first === "L") {
      if (label.some((c) => c !== "L" && c !== "EN" && c !== "ES" && c !== "NSM")) return false;
      if (last !== "L" && last !== "EN") return false;
    } else if (first === "R" || first === "AL") {
      if (label.some((c) => c === "L" || c === "ON")) return false;
      if (last !== "R" && last !== "AL" && last !== "EN" && last !== "AN") return false;
      if (label.includes("EN") && label.includes("AN")) return false;
    } else {
      return false;
    }
  }
  return true;
}

/**
 * Is a web address's host one every engine reads alike? `address` as typed
 * (it starts with "https://" or "http://"), `hostname` as the URL parser
 * gave it (lower case, punycode), without a trailing dot.
 */
export function hostReadAlike(address: string, hostname: string): boolean {
  const typed = typedHost(address);
  if (typed === null || !typedHostOk(typed)) return false;
  const labels: string[] = [];
  for (const label of hostname.split(".")) {
    const chars = labelChars(label);
    if (chars === null) return false;
    labels.push(chars);
  }
  // A host that holds a right-to-left letter or an Arabic-Indic digit
  // follows the Bidi Rule in every label.
  return bidiRuleOk(labels);
}

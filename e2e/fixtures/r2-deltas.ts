/**
 * Release 2: the closed list of differences a learner sees on a standard
 * created course and on the built-in course (spec 5.12). The recorded walk
 * (e2e/r2-learner-walk.spec.ts) compares each step with
 * applyR2Deltas(Release 1's recording) — e2e/fixtures/r1-learner-baseline.json
 * — and any other difference fails.
 *
 *   D1  The open snapshots of practice, scenario and quick check gain
 *       button "Continue": after the hint for practice and scenario, after
 *       button "Check answers" for the quick check — in all three, the
 *       last button of the lesson, just before Back.
 *   D2  A done step's button "<name>" becomes "<name>, done".
 *   D3  A reflection textbox is named by its question label. A box that
 *       was named by its placeholder (the built-in course) keeps it, which
 *       Playwright now prints as the box's /placeholder.
 *   D4  Practice options expose their pressed state: [pressed] on the
 *       chosen one, wherever they appear.
 *   D5  (phase 2 only) Renamed steps show their names in the step bar, the
 *       Back button and the counter. Lesson titles don't change.
 *
 * The snapshot is Playwright's ariaSnapshot of the page's main landmark,
 * one node per line ("  - button \"Context\"").
 */

export type Locale = "en" | "de";

export interface Captured {
  aria: string;
  counter: string | null;
}

const WORDS: Record<Locale, { continue: string; done: string; nav: string }> = {
  en: { continue: "Continue", done: ", done", nav: "Course stages" },
  de: { continue: "Weiter", done: ", erledigt", nav: "Kursschritte" },
};

const COUNTER = /^(\s*)- paragraph: (\d+) \/ (\d+) · (.*)$/;
const BUTTON = /^(\s*)- button "((?:[^"\\]|\\.)*)"(.*)$/;

/**
 * A text as ariaSnapshot writes a property's value: plain, or quoted when
 * YAML needs it (empty, or with characters YAML would read otherwise).
 * `escaped` is the text as it was inside a node's quoted name.
 */
function yamlValue(escaped: string): string {
  const text = escaped.replace(/\\(.)/g, "$1");
  return text === "" || /^[\s\-?:,[\]{}#&*!|>'"%@`]|: |\s#|\s$/.test(text) ? `"${escaped}"` : text;
}

/** The step's name inside a step-bar button's name ("4 Guided practice" → "Guided practice"). */
const numbered = /^(\d+) (.*)$/;

export function applyR2Deltas(
  key: string,
  captured: Captured,
  opts: { names?: Record<string, string> } = {}
): Captured {
  const locale = key.split(":")[1] as Locale;
  const words = WORDS[locale];
  const rename = (name: string) => opts.names?.[name] ?? name;
  const lines = captured.aria.split("\n");
  const out: string[] = [];

  // Where the step bar is: its buttons, indented under the navigation.
  const navAt = lines.findIndex((l) => l.trim() === `- navigation "${words.nav}":`);
  const navIndent = navAt === -1 ? -1 : lines[navAt].search(/\S/);
  const inNav = (i: number) => {
    if (navAt === -1 || i <= navAt) return false;
    for (let j = navAt + 1; j <= i; j++) {
      if (lines[j].search(/\S/) <= navIndent) return false;
    }
    return true;
  };
  const counterAt = lines.findIndex((l) => COUNTER.test(l));
  // Back is the button just before the counter.
  const backAt = counterAt > 0 && BUTTON.test(lines[counterAt - 1]) ? counterAt - 1 : -1;

  const step = key.split(":")[2];
  const isOpenExercise = step === "4-simulation" || step === "5-scenario" || step === "7-assessment";

  // D4: the chosen practice option — the one left enabled among the
  // options just above the feedback.
  const pressedAt = new Set<number>();
  if (step === "4-simulation-answered") {
    const statusAt = lines.findIndex((l) => l.trim() === "- status:");
    for (let j = statusAt - 1; j >= 0 && BUTTON.test(lines[j]); j--) {
      if (!lines[j].includes("[disabled]")) pressedAt.add(j);
    }
  }

  lines.forEach((line, i) => {
    let l = line;
    if (inNav(i)) {
      const m = BUTTON.exec(l);
      if (m) {
        const [, indent, name, rest] = m;
        const num = numbered.exec(name);
        // D2: a done step shows a tick, not its number.
        const renamed = num ? `${num[1]} ${rename(num[2])}` : `${rename(name)}${words.done}`;
        l = `${indent}- button "${renamed}"${rest}`;
      }
    }
    if (i === backAt) {
      const [, indent, name, rest] = BUTTON.exec(l)!;
      // D1: Continue, the last button of an open practice, scenario or quick check.
      if (isOpenExercise) out.push(`${indent}- button "${words.continue}"`);
      l = `${indent}- button "${rename(name)}"${rest}`;
    }
    if (i === counterAt) {
      const [, indent, n, total, name] = COUNTER.exec(l)!;
      l = `${indent}- paragraph: ${n} / ${total} · ${rename(name)}`;
    }
    if (pressedAt.has(i)) l = `${l} [pressed]`;
    // D3: a reflection box named by the question just above it.
    const box = /^(\s*)- textbox(?: "((?:[^"\\]|\\.)*)")?$/.exec(l);
    if (step === "6-reflection" && box) {
      const label = /^\s*- text: (.*)$/.exec(lines[i - 1] ?? "");
      if (label) {
        const [, indent, placeholder] = box;
        if (placeholder === undefined) l = `${indent}- textbox "${label[1]}"`;
        else {
          out.push(`${indent}- textbox "${label[1]}":`);
          l = `${indent}  - /placeholder: ${yamlValue(placeholder)}`;
        }
      }
    }
    out.push(l);
  });

  let counter = captured.counter;
  if (counter) {
    const m = /^(\d+) \/ (\d+) · (.*)$/.exec(counter);
    if (m) counter = `${m[1]} / ${m[2]} · ${rename(m[3])}`;
  }
  return { aria: out.join("\n"), counter };
}

/**
 * Step names in a given language for the server's loaders (D58, spec 2.5):
 * the course page, the grid card and the sectioned preview name a lesson in
 * the CONTENT language, not the menu language of the request, so the
 * standard names come from that language's messages directly.
 *
 * The rules are sectionLabel's (label.ts); this only hands it the
 * translators. Learners keep the standard names until Release 2.
 */

import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";
import type { Locale, StageKey } from "../types";
import type { LabelSource, NewSectionTemplate, StoredSection } from "./contract";
import { sectionLabel } from "./label";

const MESSAGES = { en, de, el } as const;

function translators(locale: Locale) {
  const messages = MESSAGES[locale] ?? MESSAGES.en;
  return {
    stage: createTranslator({ locale, messages, namespace: "course.stageLabel" }),
    template: createTranslator({ locale, messages, namespace: "course.sectionTemplate" }),
    course: createTranslator({ locale, messages, namespace: "course" }),
  };
}

const cache = new Map<Locale, ReturnType<typeof translators>>();
const t = (locale: Locale) => {
  let found = cache.get(locale);
  if (!found) {
    found = translators(locale);
    cache.set(locale, found);
  }
  return found;
};

/** A standard lesson's standard name in `locale` ("Guided practice"). */
export function standardName(key: StageKey, locale: Locale): string {
  return t(locale).stage(key);
}

/**
 * A lesson's step name in `locale`: its own, else the standard one, else
 * another language's, its title, its template's name, or "Lesson n".
 */
export function nameSection(
  section: Pick<StoredSection, "id" | "template" | "label">,
  locale: Locale,
  opts: { title?: string | null; n: number }
): { text: string; source: LabelSource } {
  const tr = t(locale);
  return sectionLabel(section, locale, {
    standardName: (k: StageKey) => tr.stage(k),
    templateName: (tpl: NewSectionTemplate) => tr.template(tpl),
    title: opts.title ?? null,
    generic: () => tr.course("sectionNumbered", { n: opts.n }),
  });
}

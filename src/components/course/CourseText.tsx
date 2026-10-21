"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "@/lib/cms/types";

/**
 * Release 3 (D90, spec 9.3; WCAG 3.1.2): the language of the course's own
 * text, when it isn't the page's. A learner using German or Greek gets a
 * created course whose language isn't switched on yet in English, while
 * the page's own words (buttons, notes, labels) stay in their language. So
 * the lesson area is never marked as a whole: each element that renders
 * course text (titles, narrative, prompts, options, feedback, reflection
 * questions) carries the course's language, and interface strings carry
 * nothing and read in the page's.
 *
 * The player provides the value ("en", or nothing when the course is in
 * the page's language). With nothing, every element renders exactly as
 * before: no attribute, no extra element.
 */
export const ContentLangContext = createContext<Locale | undefined>(undefined);

/** The course text's language when it isn't the page's, else undefined. */
export function useContentLang(): Locale | undefined {
  return useContext(ContentLangContext);
}

/**
 * Course text inside an element that also holds interface text: a span
 * marked with the course's language, or the text alone when the course is
 * in the page's language.
 */
export function CourseText({ children }: { children: ReactNode }) {
  const lang = useContentLang();
  return lang ? <span lang={lang}>{children}</span> : <>{children}</>;
}

/** Stands in for a value while the sentence around it is formatted. */
const marker = (i: number) => `⁣${i}⁣`;

/**
 * A sentence of the page's language with course text in it ("From
 * {min} to {max}"): `format` builds the sentence from the values, and each
 * value is marked with the course's language when that isn't the page's.
 * Otherwise the sentence as it always was.
 */
export function CourseTextIn({
  format,
  values,
}: {
  format: (values: Record<string, string>) => string;
  values: Record<string, string>;
}) {
  const lang = useContentLang();
  if (!lang) return <>{format(values)}</>;
  const keys = Object.keys(values);
  const parts = format(Object.fromEntries(keys.map((k, i) => [k, marker(i)]))).split(/⁣(\d+)⁣/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 0 ? (
          part
        ) : (
          <span key={i} lang={lang}>
            {values[keys[Number(part)]]}
          </span>
        )
      )}
    </>
  );
}

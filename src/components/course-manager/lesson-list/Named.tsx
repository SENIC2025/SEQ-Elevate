import * as React from "react";
import type { Locale } from "@/lib/cms/types";
import { aroundName } from "./list-model";

/**
 * A sentence in the menu language around a name in the content language
 * ("Delete “Πλαίσιο” in all languages?"): the name carries `lang`, so a
 * screen reader reads it with the right voice (WCAG 3.1.2). Without a
 * `lang`, or when the sentence has no place for the name, the plain text.
 */
export function Named({
  format,
  name,
  lang,
}: {
  /** The sentence for a given name. */
  format: (name: string) => string;
  name: string;
  lang?: Locale;
}) {
  const parts = lang && name ? aroundName(format) : null;
  if (!parts) return <>{format(name)}</>;
  return (
    <>
      {parts.before}
      <span lang={lang}>{name}</span>
      {parts.after}
    </>
  );
}

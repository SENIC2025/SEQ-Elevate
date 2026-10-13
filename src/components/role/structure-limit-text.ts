/**
 * What the exercise editor says when a save is refused for size
 * (sanitizeStructure's "too-large"), and which box it points to. Pure, so
 * the wording is tested against the real message files.
 */

import { fieldKey } from "@/lib/cms/structure";
import type { StructureLimitBreach } from "@/lib/cms/structure-sanitize";
import type { Locale } from "@/lib/cms/types";

/** next-intl's `t` for the exerciseEditor messages. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * The refusal in the menu language: the box as the "Not ready to save"
 * reasons name it, the language its text is in and the limit; or the list,
 * how long it is and the limit; or the whole stage.
 */
export function limitText(
  at: StructureLimitBreach,
  t: Translate,
  languageName: (locale: Locale) => string
): string {
  if (at.limit === "text") {
    return t("limits.text", {
      box: t(`limits.boxes.${at.field}`, { ...at.params }),
      language: languageName(at.locale),
      max: at.max,
    });
  }
  if (at.limit === "list") {
    return t(`limits.lists.${at.list}`, { ...at.params, count: at.count, max: at.max });
  }
  return t("limits.total", { max: at.max });
}

/**
 * The text box a refusal is about, by the key the editor gives that box
 * (fieldKey) — or null when it is about a list or the whole stage.
 */
export function limitField(at: StructureLimitBreach): string | null {
  return at.limit === "text" ? fieldKey(at.field, at.params) : null;
}

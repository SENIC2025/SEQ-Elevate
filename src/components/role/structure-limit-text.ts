/**
 * What the exercise editor says when a save is refused for size
 * (sanitizeStructure's "too-large"), and which box it points to. Pure, so
 * the wording is tested against the real message files.
 *
 * The flexible editor's own question kinds (sanitizeExercise: reflection
 * questions, the 1–5 self-assessment) are refused the same way, so a
 * refusal names any box or list of either; a Release 0 box keeps exactly
 * the key it had (partFieldKey).
 */

import { partFieldKey } from "@/lib/cms/sections/part-kinds";
import type { PartLimitBreach } from "@/lib/cms/sections/contract";
import type { Locale } from "@/lib/cms/types";

/** next-intl's `t` for the exerciseEditor messages. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * The refusal in the menu language: the box as the "Not ready to save"
 * reasons name it, the language its text is in and the limit; or the list,
 * how long it is and the limit; or the whole stage.
 */
export function limitText(
  at: PartLimitBreach,
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
 * (partFieldKey, which is fieldKey for a Release 0 box) — or null when it is
 * about a list or the whole stage.
 */
export function limitField(at: PartLimitBreach): string | null {
  return at.limit === "text" ? partFieldKey(at.field, at.params) : null;
}

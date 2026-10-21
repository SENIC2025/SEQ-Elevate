import type { Locale } from "@/lib/cms/types";
import type { LegalDocId, LegalText } from "@/data/legal";

/**
 * Counsel's final legal texts (D94, spec 12.2), one file per document per
 * language: src/content/legal/<en|de|el>/<privacy|terms|cookies|
 * accessibility|notice>.ts, each `export default { title, version,
 * lastUpdated, body } satisfies LegalText`, `body` in the Markdown subset of
 * src/lib/legal-markdown.ts. Only final text is committed: drafts never
 * enter this repository, which is public.
 *
 * Each file is registered below, one import per file (plain .ts imports:
 * a runtime file read might not reach the standalone build).
 * src/data/legal.test.ts fails on a file that isn't registered, an entry
 * with no file, a placeholder in a text, and a German or Greek text whose
 * English one is missing. docs/legal-texts.md says how to drop one in.
 */

export const FINAL_TEXTS: Record<Locale, Partial<Record<LegalDocId, LegalText>>> = {
  en: {},
  de: {},
  el: {},
};

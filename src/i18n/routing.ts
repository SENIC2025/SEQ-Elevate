import { hasLocale } from "next-intl";
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "de", "el"],
  defaultLocale: "en",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];

/**
 * `locale` when it is one of the site's, else the default. Every redirect
 * the server builds from the address's locale goes through it, so a
 * redirect only ever leads to one of the site's own paths, whatever the
 * address held (the locale layout answers 404 for an unknown locale too).
 */
export function siteLocale(locale: string): Locale {
  return hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
}

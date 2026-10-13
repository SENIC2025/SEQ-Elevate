/** Static rendering of the sectioned preview's components, in a language. */
import { createElement, type FC, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";

const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  timeZone: string;
  children?: ReactNode;
}>;

const MESSAGES = { en, de, el } as const;

export function renderIn(element: ReactElement, locale: keyof typeof MESSAGES = "en"): string {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale, messages: MESSAGES[locale] as typeof en, timeZone: "UTC" },
      element
    )
  );
}

/** The text of a piece of markup, tags dropped and entities decoded. */
export function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Every element `tag` with its attributes and inner markup (non-nested tags only). */
export function elements(html: string, tag: string) {
  const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  return [...html.matchAll(re)].map((m) => ({ attrs: m[1] ?? "", inner: m[2] }));
}

/** An attribute's value in a run of attributes. */
export function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1];
}

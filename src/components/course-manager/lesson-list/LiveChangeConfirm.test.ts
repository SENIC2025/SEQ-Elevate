import { describe, it, expect } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";
import { LiveChangeConfirm, liveChangeKeys, type LiveChange } from "./LiveChangeConfirm";

/*
 * Found at integration review (finding 6): removing a lesson's only
 * content (allowed with a confirmation, spec 7.2) takes the lesson out of
 * what learners get, yet the confirmation said "others see the change when
 * they reach it" (effect.part). It now says the lesson leaves their course.
 */

const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  timeZone: string;
  children?: ReactNode;
}>;

const render = (change: LiveChange, messages: typeof en = en, locale = "en") =>
  renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale, messages, timeZone: "UTC" },
      createElement(LiveChangeConfirm, {
        change,
        learners: 2,
        finished: 1,
        busy: false,
        onConfirm: () => {},
        onCancel: () => {},
      })
    )
  ).replace(/<[^>]+>/g, " ");

describe("LiveChangeConfirm: removing content", () => {
  it("says others see the change when they reach it, while the lesson keeps other content", () => {
    expect(liveChangeKeys({ kind: "removePart", name: "Warm-up", text: true }).effect).toBe("effect.part");
    expect(render({ kind: "removePart", name: "Warm-up", text: true })).toContain("others see the change when they reach it");
  });

  it("says the lesson leaves learners' course when it is all they get of it", () => {
    const change: LiveChange = { kind: "removePart", name: "Warm-up", text: true, empties: true };
    expect(liveChangeKeys(change)).toEqual({ title: "title.removeText", effect: "effect.partEmpties", confirm: "confirm.remove" });
    const text = render(change);
    expect(text).not.toContain("others see the change when they reach it");
    expect(text).toContain("so the lesson leaves their course");
    // In German and Greek too, never the key.
    for (const [messages, locale] of [[de, "de"], [el, "el"]] as const) {
      const other = render(change, messages as typeof en, locale);
      expect(other).not.toContain("effect.partEmpties");
      expect(other).not.toContain(messages.liveChanges.effect.part);
    }
  });
});

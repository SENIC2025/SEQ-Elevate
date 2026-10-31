/**
 * The legal pages' texts (acceptance item O7; D94, spec 12.2).
 *
 * Counsel's final texts are files under src/content/legal/<locale>/, one per
 * document per language (src/content/legal/index.ts registers them;
 * docs/legal-texts.md says how one is dropped in). Until a document's
 * English file exists, the page shows the text written before counsel's
 * (LEGACY below, English only): every statement in it is a plain fact about
 * how the platform works, and each choice only the programme's data
 * controller can make is a highlighted `needs` box, never a guess. The
 * commit that adds the last English file also deletes the legacy texts and
 * the `needs` boxes from the type, this file and the page, so no code path
 * can draw a placeholder (spec 12.5; legal.test.ts checks it).
 *
 * getLegal(doc, locale): the final text in that language, else the English
 * final text, else the legacy text. Every result carries its version (what
 * a profile records for the English Terms, profile.ts) and the date it last
 * changed. A document is listed (LEGAL_DOCS: footer, static pages, email
 * footers) only once it has a text: the legal notice from the commit that
 * adds its English file.
 */

import type { Locale } from "@/lib/cms/types";
import { FINAL_TEXTS } from "@/content/legal";

export type LegalDocId = "privacy" | "terms" | "cookies" | "accessibility" | "notice";

/** Every document the platform can show, in the footer's order. */
export const ALL_LEGAL_DOCS: readonly LegalDocId[] = ["privacy", "terms", "cookies", "accessibility", "notice"];

/** One of counsel's final texts: a file of src/content/legal/. */
export interface LegalText {
  title: string;
  /** Changes with every new wording; a profile records the English Terms' version. */
  version: string;
  /** When the text last changed, YYYY-MM-DD. */
  lastUpdated: string;
  /** The text, in the Markdown subset of src/lib/legal-markdown.ts. */
  body: string;
}

/** The version of every text written before counsel's (spec 12.2). */
export const LEGACY_VERSION = "pre-counsel";
/** When the legacy texts were last made true to the platform. */
const LEGACY_UPDATED = "2026-10-31";

/** A section of a legacy text. */
export interface LegalSection {
  heading: string;
  body?: string[];
  list?: string[];
  /** What the programme's data controller must still decide: a highlighted box. */
  needs?: string;
}

interface LegacyText {
  title: string;
  intro?: string;
  sections: LegalSection[];
}

interface LegalDocBase {
  slug: LegalDocId;
  title: string;
  version: string;
  lastUpdated: string;
  /** The language the text is written in: English where the page's own isn't there yet. */
  lang: Locale;
}

export type LegalDoc =
  | (LegalDocBase & { kind: "final"; body: string })
  | (LegalDocBase & { kind: "legacy"; intro?: string; sections: LegalSection[] });

const NEEDS = (what: string) => what;

const LEGACY: Partial<Record<LegalDocId, LegacyText>> = {
  cookies: {
    title: "Cookies",
    intro:
      "SEQ Elevate is built to need as little of your data as possible. This page lists what the platform stores in your browser, why, and for how long.",
    sections: [
      {
        heading: "Cookies we set",
        body: [
          "We set only the cookies the platform needs to work. None of them is used for tracking or advertising.",
        ],
        list: [
          "Your sign-in (__Secure-authjs.session-token): keeps you signed in after you use your one-time email link. It lasts 30 days from your last visit, renewed as you use the platform, and is removed when you sign out or delete your account.",
          "Sign-in protection (__Host-authjs.csrf-token): protects signing in and signing out. Removed when you close the browser.",
          "Where you were (__Secure-authjs.callback-url): brings you back to your page after you sign in. Removed when you close the browser.",
          "Your language (NEXT_LOCALE): remembers the language you chose. Removed when you close the browser.",
        ],
      },
      {
        heading: "No advertising or tracking cookies",
        body: [
          "We set no advertising or tracking cookies and use no social-media pixels. Nothing you do here is sold or shared with advertisers.",
          "A YouTube video in a lesson loads only after you press its play button. YouTube (Google) then receives your IP address and browser details and may set its own cookies. Our fonts come from our own servers.",
        ],
      },
      {
        heading: "Counting visits",
        body: [
          "Visits are counted with Plausible Analytics only if we switch it on. When it is on, it sets no cookies and stores no IP address.",
        ],
      },
      {
        heading: "Saved in your browser",
        body: [
          "Your browser also keeps a few things for the platform, on your device. Some of them reach your account: your guest work when you add it, your reading help, and answers waiting to be saved.",
        ],
        list: [
          "Your work as a guest (seq-elevate-demo-state-v1): your progress, answers, reflections and Comp Card when you use a course without signing in. It stays in this browser until you add it to your account after signing in, remove it, or clear this site's data. On a shared computer, sign in first, or remove your work before you leave.",
          "Your reading help (seq-elevate-a11y-v1): text size, easy-read font and contrast. While you are signed in, they are also saved in your account, so they follow you to your other devices. Settings you chose before signing in move into your account if it still has the standard settings. This browser's copy stays after you sign out, until you clear this site's data.",
          "The programme you use (seq-elevate-project-v1), until you clear this site's data.",
          "Answers waiting to be saved (seq-elevate-outbox-v1): if the site is updated while you are signed in, answers it couldn't save yet are kept for that browser tab until they are sent to us and saved, and removed when you close the tab.",
        ],
      },
    ],
  },
  accessibility: {
    title: "Accessibility statement",
    intro:
      "SEQ Elevate is designed for young people with a wide range of needs. Accessibility is a core requirement, not an afterthought.",
    sections: [
      {
        heading: "Conformance",
        body: [
          "The platform is built and tested to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at Level AA. Automated accessibility checks run against every change before it ships.",
        ],
      },
      {
        heading: "Built-in reading help",
        list: [
          "Adjustable text size, including an extra-large setting.",
          "An easy-read (dyslexia-friendlier) font option.",
          "Full keyboard navigation and a skip-to-content link.",
          "Captions on lesson videos, where the course provides them.",
          "Colour contrast that meets AA, in light and dark themes.",
          "Motion is reduced automatically if your device asks for it.",
        ],
      },
      {
        heading: "No time pressure, no grades on show",
        body: [
          "You can pause any time; there are no leaderboards and no public scores. Facilitators don't read what you write in a course's reflections.",
        ],
      },
      {
        heading: "Found a barrier?",
        body: ["If anything is hard to use, we want to fix it."],
        needs: NEEDS("Consortium to add the accessibility contact address and the target response time."),
      },
    ],
  },
  privacy: {
    title: "Privacy policy",
    intro:
      "This page describes how your personal data is handled on SEQ Elevate. The facts below are accurate for the platform; the parts in the highlighted boxes must be completed by the programme's data controller before launch.",
    sections: [
      {
        heading: "Who is responsible for your data",
        body: [
          "The organisation responsible for deciding how and why your data is used (the 'data controller') is named here.",
        ],
        needs: NEEDS(
          "Consortium to provide: the data controller's legal name, address, and the Data Protection Officer / contact for privacy questions."
        ),
      },
      {
        heading: "What we collect",
        list: [
          "Your email address. We send your one-time sign-in links to it (there is no password), and the staff who support you see it beside your progress.",
          "What you tell us the first time you sign in: your full name, the country you take part from, when you accepted the Terms of use, and your confirmation of the age rule.",
          "Your course progress: the lessons you finished, your answers in exercises and quizzes, and what you write in reflections.",
          "Your Comp Card. It is private to you ('Only me') unless you choose to share it with the facilitators at your organisation, and you can switch back to 'Only me' at any time.",
          "Your reading help: the text size, easy-read font and contrast your account keeps, so they follow you to your other devices. They include settings you chose before signing in, if your account still had the standard settings. They are in your data download.",
          "Activity records: when you open a course, how long you spend on each lesson, and your answers to questions in videos. They are used to support your learning.",
          "Notes that the staff who support you write about your learning. They are in your data download.",
        ],
      },
      {
        heading: "Who can see it",
        body: [
          "The facilitators at your organisation, and the DIESIS and SENIC staff who run the platform, see your name and email, your country, your progress, your last activity, the time you spend on each lesson, your quiz and video-question results, the choices you make in exercises, and whether a parent's or guardian's permission is recorded for you. Your Comp Card is seen only if you share it, and then only by the facilitators at your organisation. Facilitators don't read what you write in a course's reflections.",
        ],
      },
      {
        heading: "Where your data is stored",
        body: [
          "Your data is stored in a database hosted within the European Union. Visits are counted with Plausible Analytics only if we switch it on, and it then stores no personal data.",
        ],
        needs: NEEDS(
          "Consortium to confirm the final hosting region and list any processors (e.g. email delivery, file storage) with their data-processing agreements."
        ),
      },
      {
        heading: "Legal basis and how long we keep it",
        body: [
          "The legal basis for processing and the retention period are set by the data controller.",
        ],
        needs: NEEDS(
          "Consortium to provide: the lawful basis for each use of the data, the retention period for learner data, and the deletion schedule after the programme ends."
        ),
      },
      {
        heading: "Your rights",
        body: [
          "You can access, export, or delete your own data at any time from your account page — the platform provides these as self-service. You also have the right to complain to a data protection authority.",
        ],
        needs: NEEDS("Consortium to name the relevant supervisory authority and the complaint route."),
      },
      {
        heading: "Young people",
        body: [
          "This programme is designed for young people. The first time you sign in, you confirm that you are old enough to join on your own, or that a partner organisation invited you with your parent's or guardian's permission. If you need help, the help page linked at the foot of every page lists who you can contact in your country, and 112 in an emergency.",
        ],
        needs: NEEDS(
          "Consortium to reference the safeguarding policy and the age / consent approach agreed for the pilot."
        ),
      },
    ],
  },
  terms: {
    title: "Terms of use",
    intro:
      "These terms cover using the SEQ Elevate learning platform. The final wording is provided by the programme's legal counsel.",
    sections: [
      {
        heading: "Using the platform",
        body: [
          "SEQ Elevate is a learning tool provided as part of the programme. You agree to use it for its intended purpose and not to disrupt it or misuse other people's data.",
        ],
      },
      {
        heading: "Your account",
        body: [
          "You sign in with a one-time link sent to your email. Keep access to your email secure, as anyone with your inbox could request a sign-in link.",
        ],
      },
      {
        heading: "Content and ownership",
        body: [
          "Course content belongs to the programme and its partners. Reflections and work you create remain yours.",
        ],
        needs: NEEDS(
          "Consortium to provide: content licensing terms, acceptable-use specifics, liability and governing-law clauses."
        ),
      },
    ],
  },
};

const finalDoc = (slug: LegalDocId, text: LegalText, lang: Locale): LegalDoc => ({
  kind: "final",
  slug,
  title: text.title,
  version: text.version,
  lastUpdated: text.lastUpdated,
  body: text.body,
  lang,
});

/** The documents that have a text, in the footer's order. */
export const LEGAL_DOCS: LegalDocId[] = ALL_LEGAL_DOCS.filter((doc) => Boolean(FINAL_TEXTS.en[doc] ?? LEGACY[doc]));

/**
 * A legal document for a locale: its final text in that language, else the
 * English final text, else the legacy (English) text; null for a document
 * with none.
 */
export function getLegal(doc: LegalDocId, locale: Locale): LegalDoc | null {
  const own = FINAL_TEXTS[locale]?.[doc];
  if (own) return finalDoc(doc, own, locale);
  const english = FINAL_TEXTS.en[doc];
  if (english) return finalDoc(doc, english, "en");
  const legacy = LEGACY[doc];
  if (!legacy) return null;
  return { kind: "legacy", slug: doc, ...legacy, version: LEGACY_VERSION, lastUpdated: LEGACY_UPDATED, lang: "en" };
}

/** Whether the document is there in the locale's own language. */
export function hasLegalTranslation(doc: LegalDocId, locale: Locale): boolean {
  return getLegal(doc, locale)?.lang === locale;
}

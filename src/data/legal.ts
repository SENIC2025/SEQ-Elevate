/**
 * Legal / policy content — the render surface SENIC delivers (acceptance
 * item O7). Two of the four documents are FACTUAL statements about how the
 * platform actually works (cookies, accessibility) and are written in full.
 * The other two (privacy, terms) are legal instruments the consortium's
 * counsel owns: we render a structured scaffold pre-filled with the technical
 * facts and mark every consortium-supplied field with `NEEDS` so nothing ships
 * as if it were finalised.
 *
 * Content is per-locale with English fallback (see getLegal). English is
 * authored now; DE/EL official wording is a consortium translation task.
 */

import type { Locale } from "@/lib/cms/types";

export type LegalDocId = "privacy" | "terms" | "cookies" | "accessibility";

export const LEGAL_DOCS: LegalDocId[] = [
  "privacy",
  "terms",
  "cookies",
  "accessibility",
];

/** A `NEEDS` sentinel marks text the consortium must supply before go-live. */
export interface LegalSection {
  heading: string;
  body?: string[];
  list?: string[];
  /** Highlighted "to be provided by the consortium" note. */
  needs?: string;
}
export interface LegalDoc {
  slug: LegalDocId;
  title: string;
  intro?: string;
  sections: LegalSection[];
}

const NEEDS = (what: string) => what;

const EN: Record<LegalDocId, LegalDoc> = {
  cookies: {
    slug: "cookies",
    title: "Cookies",
    intro:
      "SEQ Elevate is built to need as little of your data as possible. This page explains exactly what is stored in your browser and why.",
    sections: [
      {
        heading: "Essential cookies only",
        body: [
          "We use a single strictly-necessary cookie to keep you signed in after you use your one-time email link. Without it, you could not stay logged in. It is not used for tracking or advertising.",
        ],
      },
      {
        heading: "No tracking or advertising cookies",
        body: [
          "We do not use advertising cookies, cross-site trackers, or social-media pixels. Nothing you do here is sold or shared with advertisers.",
        ],
      },
      {
        heading: "Privacy-friendly, cookieless analytics",
        body: [
          "To understand which lessons are used, we use Plausible Analytics, which is cookieless and collects no personal data — no IP storage, no fingerprinting, no cross-site profile. Because it sets no cookies, no consent banner is required.",
        ],
      },
      {
        heading: "Saved on your device",
        body: [
          "While you are working through a course as a guest, your progress is kept in your browser's local storage so you don't lose it. When you sign in, it moves to your account and you can export or delete it at any time from your account page.",
        ],
      },
    ],
  },
  accessibility: {
    slug: "accessibility",
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
          "Captions on lesson videos.",
          "Colour contrast that meets AA, in light and dark themes.",
          "Motion is reduced automatically if your device asks for it.",
        ],
      },
      {
        heading: "No time pressure, no grades on show",
        body: [
          "You can pause any time; there are no leaderboards and no public scores. The reflection you write is private to you.",
        ],
      },
      {
        heading: "Found a barrier?",
        body: [
          "If anything is hard to use, we want to fix it.",
        ],
        needs: NEEDS(
          "Consortium to add the accessibility contact address and the target response time."
        ),
      },
    ],
  },
  privacy: {
    slug: "privacy",
    title: "Privacy policy",
    intro:
      "This page describes how your personal data is handled on SEQ Elevate. The technical facts below are accurate for the platform; the parts marked in the highlighted boxes must be completed by the programme's data controller before launch.",
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
          "Your email address, used only to sign you in with a one-time link (there is no password).",
          "Your course progress: which stages you completed and the choices you made in exercises.",
          "Your Comp Card reflections, which are private to you unless you choose to share them with your facilitator.",
          "Basic activity events (for example, when you open a course and how long a lesson took) used to support your learning.",
        ],
      },
      {
        heading: "Where your data is stored",
        body: [
          "Your data is stored in a database hosted within the European Union. We use privacy-friendly, cookieless analytics that store no personal data.",
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
          "Consortium to provide: the lawful basis (e.g. consent), the retention period for learner data, and the deletion schedule after the programme ends."
        ),
      },
      {
        heading: "Your rights",
        body: [
          "You can access, export, or delete your own data at any time from your account page — the platform provides these as self-service. You also have the right to complain to a data protection authority.",
        ],
        needs: NEEDS(
          "Consortium to name the relevant supervisory authority and the complaint route."
        ),
      },
      {
        heading: "Young people",
        body: [
          "This programme is designed for young people. Additional safeguards and, where required, guardian consent are handled under the programme's safeguarding policy.",
        ],
        needs: NEEDS(
          "Consortium to reference the safeguarding policy and the age / consent approach agreed for the pilot."
        ),
      },
    ],
  },
  terms: {
    slug: "terms",
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

/** Per-locale content; only EN authored so far, others fall back. */
const LEGAL: Partial<Record<Locale, Partial<Record<LegalDocId, LegalDoc>>>> = {
  en: EN,
};

/** A legal document for a locale, falling back to English. */
export function getLegal(doc: LegalDocId, locale: Locale): LegalDoc | null {
  return LEGAL[locale]?.[doc] ?? LEGAL.en?.[doc] ?? null;
}

/** Whether the requested locale has its own authored translation. */
export function hasLegalTranslation(doc: LegalDocId, locale: Locale): boolean {
  return Boolean(LEGAL[locale]?.[doc]);
}

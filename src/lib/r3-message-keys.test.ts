import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";

/*
 * Release 3 spec 17.2 (FD-U16): the Foundation adds every new message key
 * of 4.6, 5.9, 6.5, 7.4, 9.5, 10.5 and 11.4 and the legal, account and
 * courseManager.languageReady keys, in English, German and Greek, so the
 * streams only change values in the namespaces they own
 * (messages-parity.test.ts keeps the three in step). The role names of 6.5
 * are among them: AccountView and invitations map roles to keys through a
 * Record, so a missing key shows as the key itself, not as a type error.
 */

const KEYS = [
  ...[
    "onlyMe", "facilitators", "always", "alwaysNoOrganisation", "shareConfirm", "share", "cancel",
    "sharedSince", "guest", "noOrganisation", "guardianNeeded", "failed",
  ].map((k) => `compCard.sharing.${k}`),
  ...["charsLeft", "tooLong"].map((k) => `compCard.${k}`),
  // The integrator's contract commit: the Comp Card printout's footer, in
  // the page's language like the rest of the printout.
  ...["printMadeBy", "printBelongs"].map((k) => `compCard.${k}`),
  ...[
    "notShared", "compCardSubmissions", "noOrganisation", "emptyOrganisation", "testAccount",
    "formerStaff",
    // Stream C's contract commit (the learner detail: an empty shared card,
    // and the scenario choice under Activity).
    "sharedEmpty", "scenarioChoice",
  ].map((k) => `facilitator.${k}`),
  ...[
    "title", "intro", "whoSees", "whoSeesNoOrganisation", "setUpBy", "setUpByMismatch", "privacy",
    "termsChanged", "submit", "errors", "failed", "notSaving",
  ].map((k) => `profile.${k}`),
  ...["label", "hint", "empty", "tooLong", "invalid"].map((k) => `profile.name.${k}`),
  ...["legend", "DE", "CY", "BE", "GR", "OTHER", "empty"].map((k) => `profile.country.${k}`),
  ...["self", "invited", "required", "younger", "notInvited"].map((k) => `profile.age.${k}`),
  ...["label", "required"].map((k) => `profile.terms.${k}`),
  ...["label", "version", "required"].map((k) => `profile.consent.${k}`),
  ...[
    "title", "summary", "add", "remove", "added", "removed", "clear", "clearConfirm",
  ].map((k) => `guestWork.${k}`),
  ...[
    "country", "organisation", "organisationNone", "termsAccepted", "ageConfirmed",
    "changeDetails", "alwaysSee", "alwaysSeeNoOrganisation", "notes", "dataBody", "dangerBody",
    "confirmBody",
  ].map((k) => `account.${k}`),
  ...["languageFallback", "languageNotLive"].map((k) => `coursePlayer.${k}`),
  "dashboard.inEnglish",
  ...[
    "label", "on", "off", "confirmTitle", "confirmBody", "notChecked", "readOnly",
    "liveIncomplete", "notLive",
    // Stream E's contract commit: the panel's heading, its confirm button,
    // and English as the source language (D90) before and after the first
    // publish.
    "title", "confirm", "englishRequired", "englishMissing",
    // Stream E's second contract commit: the word Manage courses shows on
    // a live language's chip, beside its mark.
    "liveMark",
  ].map((k) => `courseManager.languageReady.${k}`),
  ...["body", "play", "privacyLink", "watchOn", "loading", "failed"].map((k) => `video.youtubeGate.${k}`),
  ...["body", "open"].map((k) => `video.external.${k}`),
  ...["hostRefused", "hostUnconfigured"].map((k) => `video.${k}`),
  ...[
    "title", "emergency", "contactFor", "helpline", "allContacts", "fallback", "hint",
    "hintReflection", "footerLink", "helpTitle",
  ].map((k) => `safeguarding.${k}`),
  ...["backHome", "translationPending", "toBeCompleted", "version", "poweredBy"].map((k) => `legal.${k}`),
  // Stream F's contract commit: the version line of a text written before
  // counsel's, whose stored version ("pre-counsel") is no word for a reader.
  "legal.versionInterim",
  ...["partnerAdmin", "partnerAdminDesc"].map((k) => `roles.${k}`),
];

/** The English the spec gives (German and Greek are drafts for partner review). */
/*
 * Spec 4.6 and 5.9's English, as built. One change at integration: the
 * lists of what staff always see also name the country and whether a
 * guardian's permission is recorded, which people managers see on Manage
 * people (the spec's lists left them out).
 */
const SPEC_ENGLISH: Record<string, string> = {
  "compCard.sharing.onlyMe": "Only me",
  "compCard.sharing.facilitators": "Me and the facilitators at {organisation}",
  "compCard.sharing.always": "Whatever you choose, the facilitators at {organisation} and the DIESIS and SENIC staff who run the platform always see your name and email, your country, your progress, your last activity, the time you spend on each lesson, your quiz and video-question results, the choices you make in exercises, and whether a parent's or guardian's permission is recorded for you.",
  "compCard.sharing.alwaysNoOrganisation": "Whatever you choose, the DIESIS and SENIC staff who run the platform always see your name and email, your country, your progress, your last activity, the time you spend on each lesson, your quiz and video-question results, the choices you make in exercises, and whether a parent's or guardian's permission is recorded for you. Once your account is linked to a partner organisation, its facilitators will see them too.",
  "compCard.sharing.shareConfirm": "Share your Comp Card? Facilitators at {organisation} will see everything on it. You can switch back to “Only me” at any time.",
  "compCard.sharing.share": "Share",
  "compCard.sharing.cancel": "Cancel",
  "compCard.sharing.sharedSince": "Shared since {date}.",
  "compCard.sharing.guest": "Sign in to share your Comp Card with your facilitators.",
  "compCard.sharing.noOrganisation": "You can share once your account is linked to a partner organisation.",
  "compCard.sharing.guardianNeeded": "You can share your Comp Card once {organisation} confirms that your parent's or guardian's permission covers it.",
  "compCard.sharing.failed": "Your choice didn't save. Please try again.",
  // A count that reads right for one (Stream B's contract commit).
  "compCard.charsLeft": "{count, plural, one {# character left} other {# characters left}}",
  "compCard.tooLong": "This is too long to save. Shorten it to {max} characters.",
  "roles.partnerAdmin": "Partner admin",
  "roles.partnerAdminDesc": "Manages the people of one partner organisation, supports its learners, and edits and translates courses.",
  "facilitator.notShared": "Nothing shared with you.",
  "facilitator.compCardSubmissions": "Comp Cards shared with you",
  "facilitator.noOrganisation": "Your account isn't linked to an organisation yet, so no learners are shown. Ask DIESIS to link it.",
  "facilitator.emptyOrganisation": "No learners at {organisation} yet.",
  "facilitator.testAccount": "Test account",
  "facilitator.formerStaff": "Former staff",
  "profile.title": "Before you start",
  "profile.intro": "We need a few details, once.",
  "profile.name.label": "Full name",
  "profile.name.hint": "Your first and last name, as your partner organisation knows you.",
  "profile.name.empty": "Enter your full name.",
  "profile.name.tooLong": "Use {max} characters or fewer.",
  "profile.country.legend": "Where are you taking part?",
  "profile.country.DE": "Germany",
  "profile.country.CY": "Cyprus",
  "profile.country.BE": "Belgium",
  "profile.country.GR": "Greece",
  "profile.country.OTHER": "Other",
  "profile.country.empty": "Choose a country.",
  "profile.whoSees": "Facilitators at {organisation} and the DIESIS and SENIC staff who run the platform will see your name and email, your country, your progress, your last activity, the time you spend on each lesson, your quiz and video-question results, the choices you make in exercises, and whether a parent's or guardian's permission is recorded for you. Your Comp Card stays private unless you share it.",
  "profile.whoSeesNoOrganisation": "The DIESIS and SENIC staff who run the platform will see your name and email, your country, your progress, your last activity, the time you spend on each lesson, your quiz and video-question results, the choices you make in exercises, and whether a parent's or guardian's permission is recorded for you. Once your account is linked to a partner organisation, its facilitators will too. Your Comp Card stays private unless you share it.",
  "profile.setUpBy": "Your account was set up by {organisation}.",
  // The country is named by its code (DE, CY, BE, GR, OTHER), each in the
  // words the sentence needs in every language (a select, not a name put in).
  "profile.setUpByMismatch": "{organisation} supports learners in another country. If you continue with {country, select, DE {Germany} CY {Cyprus} BE {Belgium} GR {Greece} other {another country}}, DIESIS will check which organisation supports you; until then only DIESIS and SENIC staff see your progress.",
  "profile.age.self": "I am {minAge} or older.",
  "profile.age.invited": "{organisation} invited me and has my parent's or guardian's permission.",
  "profile.age.required": "You can continue only if this is true.",
  "profile.age.younger": "Younger than {minAge}? You can join if a partner organisation invites you. Ask the organisation you work with. You can also <account>delete this account</account>.",
  "profile.terms.label": "I accept the <terms>Terms of use</terms>.",
  "profile.terms.required": "Accept the Terms of use to continue.",
  "profile.privacy": "How we use your data: <privacy>privacy notice</privacy>.",
  "profile.termsChanged": "Our Terms of use have changed. Please read them and accept them again.",
  "profile.submit": "Continue",
  "profile.errors": "Please check:",
  "profile.failed": "That didn't save. Please try again.",
  "profile.notSaving": "Finish your profile to save your progress. <welcome>Finish it now</welcome>",
  "guestWork.title": "Work saved on this browser before you signed in",
  // `n`: how many courses there are; a Comp Card alone (or badges) is work
  // too, and `badges` counts them, so a store of badges alone says what it
  // would add (Stream B's contract commit).
  "guestWork.summary": "{n, plural, =0 {No course progress} other {{courses}}}. Comp Card: {compCard, select, true {yes} other {no}}. Badges: {badges}.",
  "guestWork.add": "Add it to my account",
  "guestWork.remove": "Remove it from this browser",
  "guestWork.added": "Added to your account.",
  "guestWork.removed": "Removed from this browser.",
  "guestWork.clear": "Clear my work from this browser",
  "guestWork.clearConfirm": "This removes your progress, answers and Comp Card from this browser. It can't be undone.",
  "account.country": "Country",
  "account.organisation": "Organisation",
  // The version only where the Terms carried one; the statement confirmed
  // in a learner's words, the invited one included (Stream B's contract commit).
  "account.termsAccepted": "{versioned, select, true {Terms of use accepted on {date} (version {version}).} other {Terms of use accepted on {date}.}}",
  "account.ageConfirmed": "{rule, select, invited {You confirmed on {date} that you have your parent's or guardian's permission.} other {You confirmed your age on {date}.}}",
  "account.notes": "Notes that staff write about you are in your data download.",
  "account.dataBody": "Download a copy of the data SEQ Elevate holds about you: your account, progress, answers, Comp Card, badges, activity records and the notes staff wrote about you.",
  "account.dangerBody": "Deleting your account removes your account, progress, answers, Comp Card and badges for good. A record that an account was deleted is kept, without your name or email. Backup copies are deleted on their normal schedule.",
  "account.confirmBody": "This removes your account, progress, answers, Comp Card and badges for good. A record that an account was deleted is kept, without your name or email. To confirm, type your email address below.",
  "coursePlayer.languageFallback": "This course isn't available in your language yet, so it is shown in English.",
  "coursePlayer.languageNotLive": "Learners using {language} get English until {language} is switched on.",
  "dashboard.inEnglish": "In English",
  // Release 4 (spec 6.2, R2) names further reading and references too, which coverage doesn't count either.
  "courseManager.languageReady.notChecked": "Coverage counts the main text and exercises only. Check extra content, step names, video questions, documents, further reading and references yourself.",
  "video.youtubeGate.body": "This video is on YouTube. When you play it, YouTube (Google) receives your IP address and browser details and may set cookies.",
  "video.youtubeGate.play": "Play video (loads YouTube)",
  "video.youtubeGate.privacyLink": "More in our privacy notice",
  "video.youtubeGate.watchOn": "Watch on youtube.com (new tab; the video's questions appear only on this page)",
  "video.youtubeGate.loading": "Loading the video… If it doesn't start, press play.",
  "video.youtubeGate.failed": "This video can't be played here.",
  "video.external.body": "This video is on another website.",
  "video.external.open": "Open the video (new tab)",
  "video.hostRefused": "This link can't be used. Upload the file, or paste a YouTube link.",
  "video.hostUnconfigured": "Uploads can't be attached until the site's storage address is set. Tell SENIC.",
  "safeguarding.title": "Need to talk to someone?",
  "safeguarding.emergency": "In an emergency, call 112.",
  // Spec 11.4's "Contact for {country}:", with the country named by its
  // code (an ICU select), so "Other" reads "other countries".
  "safeguarding.contactFor":
    "Contact for {country, select, DE {Germany} CY {Cyprus} BE {Belgium} GR {Greece} other {other countries}}:",
  "safeguarding.helpline": "Help line:",
  "safeguarding.allContacts": "Contacts in every country",
  "safeguarding.fallback": "Talk to someone you trust at your partner organisation.",
  "safeguarding.hint": "Worried about your safety or someone else's? <help>Get help</help>.",
  "safeguarding.hintReflection": "Facilitators don't read what you write here. If you need help, <help>contact someone directly</help>.",
  "safeguarding.footerLink": "Need help?",
  "safeguarding.helpTitle": "Help and safeguarding contacts",
  "legal.translationPending": "The official translation of this page is being finalised; the English version is shown in the meantime.",
  "legal.toBeCompleted": "To be completed before launch —",
  "legal.version": "Version {version} · last updated {date}",
};

const at = (messages: unknown, path: string) =>
  path.split(".").reduce<unknown>((node, k) => (node as Record<string, unknown> | undefined)?.[k], messages);

describe("Release 3's message keys", () => {
  it.each(Object.entries({ en, de, el }))("are all in %s, with some text", (_, messages) => {
    for (const key of KEYS) {
      const value = at(messages, key);
      expect(typeof value === "string" && value.trim() !== "", key).toBe(true);
    }
  });

  it("say in English what the spec says", () => {
    for (const [key, text] of Object.entries(SPEC_ENGLISH)) expect(at(en, key), key).toBe(text);
  });

  it.each(Object.entries({ de, el }))("are translated: %s differs from English where the words do", (lang, messages) => {
    // Version strings and names are the same in every language, and so is
    // a word German shares with English.
    const same = new Set([
      "profile.consent.version",
      "compCard.sharing.onlyMe",
      ...(lang === "de" ? ["account.organisation"] : []),
    ]);
    for (const key of KEYS.filter((k) => !same.has(k))) {
      const english = at(en, key);
      if (typeof english === "string" && /[a-z]{4,}/i.test(english.replace(/\{[^}]*\}|<[^>]*>/g, ""))) {
        expect(at(messages, key), key).not.toBe(english);
      }
    }
  });

  it("give the consent text one version in every language: it is what a consent records", () => {
    expect(at(de, "profile.consent.version")).toBe(at(en, "profile.consent.version"));
    expect(at(el, "profile.consent.version")).toBe(at(en, "profile.consent.version"));
  });

  it("tell the Account page what staff always see, as the Comp Card does", () => {
    for (const messages of [en, de, el]) {
      expect(at(messages, "account.alwaysSee")).toBe(at(messages, "compCard.sharing.always"));
      expect(at(messages, "account.alwaysSeeNoOrganisation")).toBe(at(messages, "compCard.sharing.alwaysNoOrganisation"));
    }
  });

  it("list everything staff always see: the country and a guardian's permission too, as Manage people shows them", () => {
    const words = { en: ["your country", "guardian"], de: ["dein Land", "Vormund"], el: ["τη χώρα σου", "κηδεμόνα"] } as const;
    for (const [lang, messages] of Object.entries({ en, de, el }) as ["en" | "de" | "el", typeof en][]) {
      for (const key of [
        "compCard.sharing.always",
        "compCard.sharing.alwaysNoOrganisation",
        "profile.whoSees",
        "profile.whoSeesNoOrganisation",
        "account.alwaysSee",
        "account.alwaysSeeNoOrganisation",
      ]) {
        for (const word of words[lang]) expect(at(messages, key), `${lang} ${key}`).toContain(word);
      }
    }
  });

  it("say who made the platform in the same words everywhere, in each language", () => {
    for (const messages of [en, de, el]) {
      const credit = (at(messages, "invite.footer") as string).replace(/ · senic\.world$/, "");
      expect(at(messages, "legal.poweredBy")).toBe(`SEQ Elevate · ${credit}`);
      expect(at(messages, "compCard.printMadeBy")).toBe(at(messages, "invite.footer"));
      expect(at(messages, "landing.scaffoldNote")).toContain(credit);
    }
  });

  it("no longer offer a mentor or say a card was merely submitted", () => {
    expect(at(en, "facilitator.compCardSubmissions")).toBe("Comp Cards shared with you");
    for (const messages of [en, de, el]) {
      expect(JSON.stringify(at(messages, "compCard.sharing"))).not.toMatch(/mentor/i);
    }
  });

  it("name the country of setUpByMismatch by a select on its code, in every language", () => {
    for (const messages of [en, de, el]) {
      const text = at(messages, "profile.setUpByMismatch") as string;
      expect(text).toMatch(/\{country, select, DE \{[^}]+\} CY \{[^}]+\} BE \{[^}]+\} GR \{[^}]+\} other \{[^}]+\}\}/);
    }
  });

  it("no longer offer the old privacy choices, the mentor's among them (spec 4.6)", () => {
    for (const messages of [en, de, el]) {
      expect(at(messages, "compCard.privacyChoice")).toBeUndefined();
      expect(at(messages, "compCard.privacyLabel")).toEqual(expect.any(String));
    }
  });

  it("no longer name a field as redacted: a facilitator sees only what was shared (spec 4.5)", () => {
    for (const messages of [en, de, el]) {
      expect(at(messages, "facilitator.redacted")).toBeUndefined();
      expect(at(messages, "facilitator.redactedHint")).toBeUndefined();
    }
  });
});

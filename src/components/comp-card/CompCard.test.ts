import { afterEach, describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import type { CompCardData, CourseProgress } from "@/store/demo-state";
import type { SharingContext } from "./CompCard";

/*
 * Release 3 (D80, spec 4.5): the Comp Card screen. Two choices for who sees
 * it, "Only me" fixed (and why) where sharing isn't open, the note of what
 * facilitators always see, no mentor, and length notes instead of a cut.
 */

/** The page's language (the interface strings stay English here: only `lang` is checked by it). */
let pageLocale = "en";
vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-intl")>()),
  useTranslations: (namespace: string) => createTranslator({ locale: "en", messages: en, namespace: namespace as never }),
  useLocale: () => pageLocale,
}));
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return { Link: ({ href, ...rest }: { href: string }) => h("a", { href: `/en${href}`, ...rest }) };
});

let card: CompCardData;
/** The course the learner played, as the store holds it (none by default). */
let played: Partial<CourseProgress> = {};
/** The signed-in learner's own data has loaded into the store. */
let loaded = true;
vi.mock("@/store/demo-state", async () => {
  const { DEFAULT_STATE } = await vi.importActual<typeof import("@/store/demo-state")>("@/store/demo-state");
  return {
    DEFAULT_STATE,
    useDemoState: () => ({
      state: { ...DEFAULT_STATE, compCard: card, course: { ...DEFAULT_STATE.course, ...played } },
      dispatch: () => {},
      setSharing: async () => true,
      accountLoaded: loaded,
    }),
  };
});
vi.mock("@/app/actions/learner", () => ({ saveCourseProgress: vi.fn() }));
vi.mock("next-auth/react", () => ({ getSession: vi.fn(), useSession: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: vi.fn(), unstable_isUnrecognizedActionError: () => false }));

const { CompCard, cardFieldLength } = await import("./CompCard");
const { DEFAULT_STATE } = await import("@/store/demo-state");

const MEMBER: SharingContext = { signedIn: true, organisationName: "Pro Arbeit", blocked: null };

function render(sharing: SharingContext, over: Partial<CompCardData> = {}, accountLoaded = true) {
  card = { ...DEFAULT_STATE.compCard, ...over };
  loaded = accountLoaded;
  const html = renderToStaticMarkup(createElement(CompCard, { sharing }));
  return { html, text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&#x27;|&#39;/g, "'") };
}
/** The toggle buttons: their text and whether each is pressed. */
const toggles = (html: string) =>
  [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>(.*?)<\/button>/g)].map((m) => [
    m[2].replace(/<[^>]+>/g, "").trim(),
    m[1],
  ]);

describe("the Comp Card's sharing (spec 4.5)", () => {
  it("offers two choices to a learner of an organisation: Only me (pressed) and its facilitators", () => {
    const { html, text } = render(MEMBER);
    const sharing = toggles(html).filter(([name]) => !/^\d$/.test(name));
    expect(sharing).toEqual([
      ["Only me", "true"],
      ["Me and the facilitators at Pro Arbeit", "false"],
    ]);
    expect(text).not.toMatch(/mentor/i);
    expect(text).toContain(
      "Whatever you choose, the facilitators at Pro Arbeit and the DIESIS and SENIC staff who run the platform always see"
    );
  });

  it("says since when it is shared", () => {
    const { html, text } = render(MEMBER, {
      sharing: "facilitators",
      sharedAt: "2026-11-21T09:00:00.000Z",
      organisationName: "Pro Arbeit",
    });
    expect(toggles(html).filter(([name]) => !/^\d$/.test(name))).toEqual([
      ["Only me", "false"],
      ["Me and the facilitators at Pro Arbeit", "true"],
    ]);
    expect(text).toContain("Shared since November 21, 2026.");
  });

  it.each([
    ["a guest", { signedIn: false, organisationName: null, blocked: null }, "Sign in to share your Comp Card with your facilitators."],
    ["a learner with no organisation", { signedIn: true, organisationName: null, blocked: "no-organisation" }, "You can share once your account is linked to a partner organisation."],
    [
      "an invited learner whose guardian's permission doesn't cover sharing",
      { signedIn: true, organisationName: "Pro Arbeit", blocked: "guardian-consent-needed" },
      "You can share your Comp Card once Pro Arbeit confirms that your parent's or guardian's permission covers it.",
    ],
  ] as [string, SharingContext, string][])("shows %s Only me, fixed, and why", (_, context, why) => {
    const { html, text } = render(context);
    expect(toggles(html).filter(([name]) => !/^\d$/.test(name))).toEqual([]);
    expect(text).toContain("Only me");
    expect(text).not.toContain("Me and the facilitators");
    expect(text).toContain(why);
  });

  it("until the learner's own data has loaded, shows the choice the server read for the page, not the store's empty Only me", () => {
    const shared: SharingContext = {
      ...MEMBER,
      saved: { sharing: "facilitators", sharedAt: "2026-11-21T09:00:00.000Z" },
    };
    const { html, text } = render(shared, {}, false);
    expect(toggles(html).filter(([name]) => !/^\d$/.test(name))).toEqual([
      ["Only me", "false"],
      ["Me and the facilitators at Pro Arbeit", "true"],
    ]);
    expect(text).toContain("Shared since November 21, 2026.");
    // The print shows it too.
    expect(text).toMatch(/Who can see this Comp Card Me and the facilitators at Pro Arbeit/);
  });

  it("presses neither choice while nothing of the learner's has been read", () => {
    const { html, text } = render(MEMBER, {}, false);
    expect(toggles(html).filter(([name]) => !/^\d$/.test(name))).toEqual([
      ["Only me", "false"],
      ["Me and the facilitators at Pro Arbeit", "false"],
    ]);
    expect(text).not.toContain("Shared since");
  });

  it("tells a guest only that signing in lets them share: a guest's work is sent to no one", () => {
    const { text } = render({ signedIn: false, organisationName: null, blocked: null });
    expect(text).toContain("Sign in to share your Comp Card with your facilitators.");
    expect(text).not.toContain("always see");
    expect(text).not.toContain("DIESIS and SENIC staff");
  });

  it("says what is always seen without naming an organisation when there is none", () => {
    expect(render({ signedIn: true, organisationName: null, blocked: "no-organisation" }).text).toContain(
      "Whatever you choose, the DIESIS and SENIC staff who run the platform always see"
    );
  });

  it("places the safeguarding line under the free-text fields, and labels each field", () => {
    const { html } = render(MEMBER);
    expect(html).toContain('href="/en/help"');
    for (const key of ["wentWell", "difficult", "improve", "behaviour"]) {
      expect(html).toContain(`for="comp-card-${key}"`);
      expect(html).toContain(`id="comp-card-${key}"`);
    }
    expect(html).not.toMatch(/maxlength/i);
  });
});

describe("the Comp Card's length notes (D80)", () => {
  it("says nothing while short, how many are left from 1,800, and too long past 2,000", () => {
    expect(cardFieldLength("x".repeat(1799))).toBeNull();
    expect(cardFieldLength("x".repeat(1800))).toEqual({ kind: "left", left: 200 });
    expect(cardFieldLength("x".repeat(2000))).toEqual({ kind: "left", left: 0 });
    expect(cardFieldLength("x".repeat(2001))).toEqual({ kind: "tooLong" });
  });

  it("shows the note under the field it describes, the too-long one marking the field invalid", () => {
    const { html, text } = render(MEMBER, { difficult: "x".repeat(2001), improve: "y".repeat(1900) });
    expect(text).toContain("This is too long to save. Shorten it to 2000 characters.");
    expect(text).toContain("100 characters left");
    expect(html).toMatch(/id="comp-card-difficult"[^>]*aria-describedby="comp-card-difficult-length"|aria-describedby="comp-card-difficult-length"[^>]*id="comp-card-difficult"/);
    expect(html).toMatch(/aria-invalid="true"/);
  });
});

describe("the course's own text on the Comp Card carries its language (D90, spec 9.3; WCAG 3.1.2)", () => {
  const ENGLISH_COURSE: Partial<CourseProgress> = {
    courseSlug: "saying-no",
    courseTitle: "Saying no",
    courseLocale: "en",
    scenario: { root: "c1", followup: "f1", rootLabel: "Ask to finish", followupLabel: "Thank them" },
  };
  /** The element that holds exactly `text`, as its opening tag. */
  const tagOf = (html: string, text: string) => {
    const tag = new RegExp(`(<[a-z0-9]+[^>]*>)${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</`).exec(html)?.[1];
    expect(tag, `an element holding exactly "${text}"`).toBeDefined();
    return tag ?? "";
  };

  afterEach(() => {
    pageLocale = "en";
    played = {};
  });

  it("marks a course shown in English on a German page: its title and the scenario's choices", () => {
    pageLocale = "de";
    played = ENGLISH_COURSE;
    const { html } = render(MEMBER);
    expect(tagOf(html, "Saying no")).toContain('lang="en"');
    expect(tagOf(html, "Ask to finish → Thank them")).toContain('lang="en"');
  });

  it("marks nothing when the course is in the page's language", () => {
    played = ENGLISH_COURSE;
    const { html } = render(MEMBER);
    expect(tagOf(html, "Saying no")).not.toContain("lang=");
    expect(tagOf(html, "Ask to finish → Thank them")).not.toContain("lang=");
  });

  it("marks nothing for a course whose language the store doesn't know, nor the dash of no course", () => {
    pageLocale = "de";
    played = { ...ENGLISH_COURSE, courseLocale: undefined };
    expect(tagOf(render(MEMBER).html, "Saying no")).not.toContain("lang=");
    played = {};
    expect(tagOf(render(MEMBER).html, "—")).not.toContain("lang=");
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson, removePeople, runId, signIn } from "./fixtures/people";
import { narrative, ownLessonId, removeR2Course, seedR2Course } from "./fixtures/r2-course";

/**
 * Release 3 (D95, spec 13.7; 18.2: F-E3): the security headers, and what
 * the content security policy lets through.
 *
 *   - Every response carries the policy and the four other headers: a
 *     page, a prerendered legal page, the help page and an API route.
 *   - A collector of the browser's `securitypolicyviolation` reports, shown
 *     to work by a picture from another site that the policy blocks, finds
 *     none over: a learner's walk (the dashboard, a built-in course's
 *     lessons and its video with its in-video question, the Comp Card, the
 *     account, help and legal pages), a course shaped like A-E1 (a video
 *     with captions and a question, documents on our Blob store: a PDF and
 *     a picture in the document viewer), and signing in by email.
 *   - Two more walks need Stream E's changes (spec 10.2, 10.3), and run
 *     once they are in this tree: the editor's video preview with YouTube
 *     stubbed (nothing of YouTube before the press, its nocookie player
 *     after it), and documents stored on another site (shown as links).
 *
 * Each walk first checks that the page it walks carries an enforced
 * policy: with none (the old build) there is nothing to report, so no
 * report would prove nothing.
 *
 * Requires a real database for the walks (gated on E2E_DB=1). Nothing here
 * leaves the machine: requests to the Blob store, YouTube and other sites
 * are answered by the test.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  : (null as unknown as PrismaClient);
const describeDb = DB ? test.describe : test.describe.skip;

const RUN = runId();
const ROOT = path.resolve(__dirname, "..");
const source = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/* ------------------------------------------------------------- headers --- */

/** The policy's directives, by name. */
function directives(csp: string): Record<string, string[]> {
  return Object.fromEntries(
    csp
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...values]) => [name, values])
  );
}

/** The headers every response must carry, checked on one response. */
function expectSecurityHeaders(headers: Record<string, string>, where: string) {
  const csp = headers["content-security-policy"];
  expect(csp, `${where}: an enforced content security policy`).toBeTruthy();
  expect(headers["content-security-policy-report-only"], where).toBeUndefined();
  const d = directives(csp);
  expect(d["default-src"], where).toEqual(["'self'"]);
  expect(d["object-src"], where).toEqual(["'none'"]);
  expect(d["base-uri"], where).toEqual(["'self'"]);
  expect(d["form-action"], where).toEqual(["'self'"]);
  expect(d["frame-ancestors"], where).toEqual(["'none'"]);
  expect(d["upgrade-insecure-requests"], where).toEqual([]);
  expect(d["script-src"], where).toEqual(["'self'", "'unsafe-inline'", "https://www.youtube.com"]);
  // YouTube's player only from the nocookie domain; a Blob store for our uploads.
  expect(d["frame-src"]?.[1], where).toBe("https://www.youtube-nocookie.com");
  expect(d["frame-src"], where).toHaveLength(2);
  for (const name of ["img-src", "media-src", "frame-src"]) {
    expect(d[name]?.some((s) => /^https:\/\/[^/]*\.blob\.vercel-storage\.com$/.test(s)), `${where} ${name}`).toBe(true);
  }
  expect(d["connect-src"], where).toEqual(["'self'", "https://vercel.com"]);
  expect(headers["x-frame-options"], where).toBe("DENY");
  expect(headers["x-content-type-options"], where).toBe("nosniff");
  expect(headers["referrer-policy"], where).toBe("strict-origin-when-cross-origin");
  const permissions = headers["permissions-policy"] ?? "";
  for (const off of ["camera=()", "microphone=()", "geolocation=()", "payment=()", "usb=()", "browsing-topics=()"]) {
    expect(permissions, `${where}: ${off}`).toContain(off);
  }
  for (const player of ["fullscreen", "autoplay", "encrypted-media", "picture-in-picture"]) {
    expect(permissions, `${where}: ${player}`).toContain(`${player}=(self "https://www.youtube-nocookie.com")`);
  }
}

test.describe("Release 3 — security headers (F-E3)", () => {
  test("F-E3: a page, a prerendered legal page, the help page and an API route carry the security headers", async ({
    request,
  }) => {
    const page = await request.get("/en");
    expectSecurityHeaders(page.headers(), "/en");

    const legal = await request.get("/en/legal/privacy");
    expect(legal.status()).toBe(200);
    // Prerendered, and its headers with it.
    expect(legal.headers()["x-nextjs-prerender"], "/en/legal/privacy is prerendered").toBeTruthy();
    expectSecurityHeaders(legal.headers(), "/en/legal/privacy");

    const help = await request.get("/en/help");
    expect(help.status()).toBe(200);
    expectSecurityHeaders(help.headers(), "/en/help");

    const api = await request.get("/api/me/export");
    expect(api.status()).toBe(401);
    expectSecurityHeaders(api.headers(), "/api/me/export");
  });
});

/* ----------------------------------------------------------- collector --- */

interface Violation {
  directive: string;
  blocked: string;
  page: string;
  disposition: string;
}

/**
 * Collects every policy violation the browser reports in `context`, from
 * every page and frame of ours, across navigations; and every console line
 * that says the policy refused something.
 */
async function collectViolations(context: BrowserContext) {
  const reports: Violation[] = [];
  const console: string[] = [];
  await context.exposeBinding("__e2eCspViolation", (_source, v: Violation) => {
    reports.push(v);
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __e2eCspViolation: (v: unknown) => void }).__e2eCspViolation({
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
        page: location.pathname,
        disposition: e.disposition,
      });
    });
  });
  context.on("console", (message) => {
    if (/Content.Security.Policy/i.test(message.text())) console.push(message.text());
  });
  return { reports, console };
}

/** The policy is there to be broken: the main document of `page` carries it. */
async function expectEnforced(page: Page) {
  const headers = await (await page.request.get(page.url())).headers();
  expect(headers["content-security-policy"], `${page.url()}: an enforced content security policy`).toBeTruthy();
}

/** Answers requests to the Blob store (a PDF, a picture) and to other sites, so nothing leaves the machine. */
async function stubOutside(context: BrowserContext) {
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const PDF = Buffer.from(
    "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
  );
  await context.route(/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//, (route) => {
    const url = route.request().url();
    if (url.endsWith(".png")) return route.fulfill({ contentType: "image/png", body: PNG });
    return route.fulfill({ contentType: "application/pdf", body: PDF });
  });
  await context.route(/^https:\/\/(?:[a-z0-9-]+\.)*example\.org\//, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Elsewhere</title>" })
  );
}

test.describe("Release 3 — the policy blocks what it doesn't name (F-E3)", () => {
  test("F-E3: the collector hears the browser refuse a picture from another site", async ({ page, context }) => {
    const found = await collectViolations(context);
    await stubOutside(context);
    await page.goto("/en");
    await expectEnforced(page);
    await page.evaluate(() => {
      const img = document.createElement("img");
      img.src = "https://example.org/e2e-not-allowed.png";
      img.alt = "";
      document.body.append(img);
    });
    await expect.poll(() => found.reports.length).toBeGreaterThan(0);
    expect(found.reports[0]).toMatchObject({ directive: "img-src", blocked: "https://example.org/e2e-not-allowed.png", disposition: "enforce" });
  });
});

/* --------------------------------------------------------------- walks --- */

const LEARNER = `e2e-r3-headers-learner-${RUN}@example.com`;
const EDITOR = `e2e-r3-headers-editor-${RUN}@example.com`;
const SIGNIN = `e2e-r3-headers-signin-${RUN}@example.com`;
const COURSE = `e2e-r3-headers-${RUN}`;
const DRAFT = `e2e-r3-headers-draft-${RUN}`;
const ELSEWHERE = `e2e-r3-headers-elsewhere-${RUN}`;
const BLOB = "https://e2e-store.public.blob.vercel-storage.com";
const READ = ownLessonId();
const WATCH = ownLessonId();
const VIDEO_LESSON = ownLessonId();
const ELSEWHERE_LESSON = ownLessonId();

/** A video as A-E1 has it: our own file, English captions, a question at 4 s. */
const video = (cueId: string) => ({
  provider: "file",
  src: "/demo/sample-lesson.webm",
  title: "E2E headers video",
  captions: [{ src: "/demo/sample-lesson.en.vtt", label: "English", lang: "en", default: true }],
  cues: [
    {
      id: cueId,
      atSeconds: 4,
      question: "E2E headers: what helps most?",
      options: [
        { id: "early", text: "Speaking early" },
        { id: "late", text: "Waiting it out" },
      ],
      correctOptionId: "early",
    },
  ],
});

const continueButton = (page: Page) =>
  page.getByRole("main").getByRole("button", { name: /^continue$/i }).filter({ visible: true });

/** Answers the in-video question on the lesson shown. */
async function answerVideo(page: Page, option: string) {
  const video = page.getByTestId("lesson-video").filter({ visible: true });
  await expect(video).toBeVisible({ timeout: 15000 });
  await expect(video.locator("track[kind='captions']")).toHaveCount(1);
  const dialog = page.getByRole("dialog");
  await expect(async () => {
    await video.evaluate((v: HTMLVideoElement) => {
      v.currentTime = 6;
    });
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await dialog.getByText(option).click();
  await dialog.getByRole("button", { name: /^submit$/i }).click();
  await dialog.getByRole("button", { name: /continue watching/i }).click();
  await expect(dialog).toHaveCount(0);
}

describeDb("Release 3 — nothing we use breaks the policy (F-E3)", () => {
  // In order, in one worker, each test on its own: a failure doesn't skip
  // the rest (each says what it found on the old build too).
  test.describe.configure({ mode: "default" });

  // Everyone this part makes, removed after its pages have gone (a page
  // still open would write for a person who no longer exists).
  const PEOPLE = [LEARNER, `x-${LEARNER}`, `y-${LEARNER}`, EDITOR, SIGNIN];

  test.beforeAll(async () => {
    await removePeople(prisma, PEOPLE);
  });

  test.afterEach(async ({ page }) => {
    // Leave the page, so its last saves and timings arrive before anyone is removed.
    await page.goto("about:blank");
  });

  test.afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { in: PEOPLE } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users.map((u) => u.id) } } });
    await prisma.verificationToken.deleteMany({ where: { identifier: { in: [SIGNIN, SIGNIN.toUpperCase()] } } });
    await removePeople(prisma, PEOPLE);
    for (const slug of [COURSE, DRAFT, ELSEWHERE]) await removeR2Course(prisma, slug);
    await prisma.$disconnect();
  });

  test("F-E3: a learner's walk breaks no rule: dashboard, a course and its video, Comp Card, account, help and legal pages", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const learner = await createPerson(prisma, { email: LEARNER, roles: ["LEARNER"] });
    const found = await collectViolations(context);
    await stubOutside(context);
    await signIn(context, learner.sessionToken);

    await page.goto("/en/learner");
    await expectEnforced(page);
    await expect(page.getByRole("main")).toBeVisible();

    // A built-in course: its first lesson, then its video and in-video question.
    await page.goto("/en/learner/course/workplace-conflict");
    await expectEnforced(page);
    const concept = page.getByText(/watch: speaking up without blame/i);
    await expect(async () => {
      await continueButton(page).first().click();
      await expect(concept).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });
    await answerVideo(page, "Whose fault it is");

    for (const path of ["/en/learner/comp-card", "/en/account", "/en/help", "/en/legal/cookies", "/de/legal/privacy"]) {
      await page.goto(path);
      await expect(page.getByRole("main").first()).toBeVisible();
    }
    await page.waitForTimeout(500);
    expect(found.reports, JSON.stringify(found.reports)).toEqual([]);
    expect(found.console).toEqual([]);
  });

  test("F-E3: a course shaped like A-E1 breaks no rule: documents on our Blob store (a PDF, a picture), a video with captions and a question", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const learner = await createPerson(prisma, { email: `x-${LEARNER}`, roles: ["LEARNER"] });
    const found = await collectViolations(context);
    await stubOutside(context);
    await signIn(context, learner.sessionToken);
    await page.goto("/en/learner");
    await expectEnforced(page);
    await seedR2Course(prisma, {
      slug: COURSE,
      title: { en: `E2E headers ${RUN}` },
      lessons: [
        {
          id: READ,
          label: { en: "Read first" },
          narrative: narrative({ en: { title: "E2E headers: read first", text: "E2E headers reading." } }),
          documents: [
            { name: "E2E headers checklist.pdf", url: `${BLOB}/e2e-headers-checklist-${RUN}.pdf` },
            { name: "E2E headers picture.png", url: `${BLOB}/e2e-headers-picture-${RUN}.png` },
          ],
        },
        {
          id: WATCH,
          label: { en: "Watch" },
          narrative: narrative({ en: { title: "E2E headers: watch", text: "E2E headers watching." } }),
          video: video(`e2e-headers-cue-${RUN}`),
        },
      ],
    });
    // The picture is shown as one.
    await prisma.lessonDocument.updateMany({
      where: { url: `${BLOB}/e2e-headers-picture-${RUN}.png` },
      data: { mimeType: "image/png" },
    });
    await page.goto(`/en/learner/course/${COURSE}`);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 2, name: "E2E headers: read first" })).toBeVisible({ timeout: 15000 });

    // The document viewer: the PDF in a frame, then the picture.
    const pdf = page.waitForRequest((r) => r.url().includes(`e2e-headers-checklist-${RUN}.pdf`));
    await main.getByRole("button", { name: "E2E headers checklist.pdf" }).click();
    const viewer = page.getByRole("dialog");
    await expect(viewer.locator("iframe")).toHaveAttribute("src", `${BLOB}/e2e-headers-checklist-${RUN}.pdf`);
    await pdf;
    await viewer.getByRole("button", { name: /^next$/i }).click();
    const picture = viewer.getByRole("img", { name: "E2E headers picture.png" });
    await expect(picture).toBeVisible();
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);

    // On to the video lesson: its captions and its question.
    await expect(async () => {
      await continueButton(page).click();
      await expect(main.getByRole("heading", { level: 2, name: "E2E headers: watch" })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });
    await answerVideo(page, "Speaking early");
    await page.waitForTimeout(500);
    expect(found.reports, JSON.stringify(found.reports)).toEqual([]);
    expect(found.console).toEqual([]);
  });

  test("F-E3: signing in by email breaks no rule", async ({ page, context }) => {
    const found = await collectViolations(context);
    await page.goto("/en/signin");
    await expectEnforced(page);
    await page.getByRole("textbox", { name: "Email" }).fill(SIGNIN);
    await page.getByRole("button", { name: /send me a link/i }).click();
    // Auth.js's "check your email" page.
    await expect(page.getByRole("heading", { level: 1, name: /check your email/i })).toBeVisible({ timeout: 15000 });
    await expectEnforced(page);
    await page.waitForTimeout(500);
    expect(found.reports, JSON.stringify(found.reports)).toEqual([]);
    expect(found.console).toEqual([]);
  });

  // Stream E's click-to-load gate (spec 10.2) is what keeps YouTube off a
  // page until the press; until it is in this tree the player embeds
  // YouTube's own domain, which this policy refuses.
  const gate = /youtubeGate/.test(source("src/components/course/InteractiveVideoPlayer.tsx"));

  test("F-E3: the editor's video preview with YouTube stubbed: nothing of YouTube before the press, the nocookie player after it, no rule broken", async ({
    page,
    context,
  }) => {
    test.fixme(!gate, "needs Stream E's click-to-load gate (spec 10.2) in InteractiveVideoPlayer");
    test.setTimeout(120_000);
    const play = JSON.parse(source("src/messages/en.json")).video.youtubeGate.play as string;
    const editor = await createPerson(prisma, { email: EDITOR, roles: ["CONTENT_EDITOR"] });
    await page.goto("/en");
    await expectEnforced(page);
    await seedR2Course(prisma, {
      slug: DRAFT,
      status: "draft",
      lessons: [{ id: VIDEO_LESSON, label: { en: "Video" }, narrative: narrative({ en: { title: "E2E video", text: "E2E." } }) }],
    });
    const found = await collectViolations(context);
    const youtube: string[] = [];
    await context.route(/youtube|ytimg|googlevideo/, async (route) => {
      const url = route.request().url();
      youtube.push(url);
      if (url.includes("/iframe_api")) {
        // A stand-in for YouTube's player API: a player frame on the host it is given.
        return route.fulfill({
          contentType: "text/javascript",
          body: `window.YT = { Player: function (el, o) {
            var f = document.createElement("iframe");
            f.src = (o.host || "https://www.youtube.com") + "/embed/" + o.videoId;
            f.title = "YouTube";
            (typeof el === "string" ? document.getElementById(el) : el).replaceWith(f);
            this.getCurrentTime = function () { return 0; }; this.getDuration = function () { return 60; };
            this.pauseVideo = function () {}; this.playVideo = function () {}; this.destroy = function () { f.remove(); };
            var self = this; setTimeout(function () { o.events && o.events.onReady && o.events.onReady({ target: self }); }, 0);
          }, PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 } };
          window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();`,
        });
      }
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Player</title>" });
    });
    await signIn(context, editor.sessionToken);
    await page.goto(`/en/content/courses/${DRAFT}?lesson=${VIDEO_LESSON}`);
    await expectEnforced(page);
    const lesson = page.locator(`#lesson-${VIDEO_LESSON}`).filter({ visible: true });
    await lesson.getByRole("button", { name: "Paste URL" }).click();
    await lesson.getByLabel(/^Video URL/).fill("https://www.youtube.com/watch?v=e2eGate0001");
    const press = lesson.getByRole("button", { name: play });
    await expect(press).toBeVisible({ timeout: 15000 });
    expect(youtube, "nothing of YouTube before the press").toEqual([]);
    await press.click();
    await expect(lesson.locator("iframe")).toHaveAttribute("src", /^https:\/\/www\.youtube-nocookie\.com\/embed\//, {
      timeout: 15000,
    });
    await page.waitForTimeout(500);
    expect(found.reports, JSON.stringify(found.reports)).toEqual([]);
    expect(found.console).toEqual([]);
  });

  // Stream E's media rule (spec 10.3): a document stored on another site
  // shows as a link, not embedded, so the policy needs no other host.
  const mediaRule = /export function isFirstPartyMediaUrl/.test(source("src/lib/media-url.ts"));

  test("F-E3: documents stored on another site break no rule (they show as links)", async ({ page, context }) => {
    test.fixme(!mediaRule, "needs Stream E's first-party media rule (spec 10.3)");
    const learner = await createPerson(prisma, { email: `y-${LEARNER}`, roles: ["LEARNER"] });
    await page.goto("/en");
    await expectEnforced(page);
    await seedR2Course(prisma, {
      slug: ELSEWHERE,
      lessons: [
        {
          id: ELSEWHERE_LESSON,
          label: { en: "Elsewhere" },
          narrative: narrative({ en: { title: "E2E elsewhere", text: "E2E." } }),
          // As A-E1's warm-up has them.
          documents: [{ name: "E2E checklist.pdf", url: "https://example.org/e2e-r2-checklist.pdf" }],
        },
      ],
    });
    const found = await collectViolations(context);
    await stubOutside(context);
    await signIn(context, learner.sessionToken);
    await page.goto(`/en/learner/course/${ELSEWHERE}`);
    await expectEnforced(page);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 2, name: "E2E elsewhere" })).toBeVisible({ timeout: 15000 });
    const document = main.getByRole("button", { name: "E2E checklist.pdf" });
    if (await document.count()) await document.click();
    await page.waitForTimeout(1000);
    expect(found.reports, JSON.stringify(found.reports)).toEqual([]);
  });
});

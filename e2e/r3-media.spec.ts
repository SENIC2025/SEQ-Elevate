import { test, expect, type Locator, type Page, type Request } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson, removePeople, runId, signIn, type Person } from "./fixtures/people";
import { PROJECT, narrative, ownLessonId, type R2LessonSeed } from "./fixtures/r2-course";
import { hasFileQueue, removeECourse, seedECourse } from "./fixtures/r3-e-course";
import { callAction } from "./fixtures/server-action";
import de from "../src/messages/de.json";
import el from "../src/messages/el.json";
import en from "../src/messages/en.json";

/**
 * Release 3, Stream E (spec 10, D91, D92; 18.2: E-E4 to E-E7, E-E9, E-E10):
 * a lesson's video and documents come from our own store, YouTube loads
 * only when the viewer asks for it, and a removed file waits in a queue.
 *
 *   E-E4  with every YouTube, ytimg and googlevideo address routed to a
 *         stand-in: no request at all before the viewer presses play, in
 *         the player and in the editor's live preview; after it the frame
 *         comes from www.youtube-nocookie.com and focus is on the status
 *         line (never in YouTube's frame); a press plays that one video
 *         only: another link pasted into the preview asks again, and so
 *         does the first one pasted back
 *   E-E5  saveLessonVideo given a YouTube link as a file stores YouTube; an
 *         .mp4 and a document on another host are refused
 *   E-E6  a video stored on another host (before Release 3) is a link out:
 *         the page never asks that host for anything
 *   E-E7  a facilitator's direct setLessonDocumentPublished is refused
 *   E-E9  a YouTube lesson at 320 px with the largest reading-help text,
 *         in German, Greek and English: the play button is below the video,
 *         visible, reachable by keyboard; no sideways scroll; axe passes
 *         (the target size of the privacy link included)
 *   E-E10 removing a document asks with the new wording; its address is
 *         queued as the record held it, and nothing deletes the file; the
 *         same address pasted into another lesson, the admin clean-up's
 *         dry run takes it off the queue (files dropped: 1, the contract
 *         of src/lib/blob-files.ts)
 *
 * Each is red on Release 2's build: it loads YouTube (from youtube.com) and
 * other hosts' videos as the page renders, stores whatever address it is
 * given, lets a facilitator publish documents, puts the play button in a
 * 16:9 box too small for it, and has no queue.
 *
 * The queued address is on a made-up Vercel Blob store: this server sets no
 * BLOB_PUBLIC_HOST and isn't production, so any Blob store counts as ours
 * and nothing is ever deleted (the dry run says "keep"). The browser never
 * reaches that store or YouTube: both are routed to stand-ins.
 *
 * Requires a real database — gated on E2E_DB=1. Everything the run makes
 * is unique to it and removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;
test.describe.configure({ mode: "default" });

const RUN = runId();
const LESSON = "src/app/actions/lesson.ts";
const ADMIN_DATA = "src/app/actions/admin-data.ts";

/** A YouTube video id (11 characters). */
const VIDEO_ID = "e2eVideo001";
const OTHER_VIDEO_ID = "e2eVideo002";
const THIRD_VIDEO_ID = "e2eVideo003";
/** A video file on someone else's site. */
const OTHER_HOST_VIDEO = "https://media.example.org/e2e/clip.mp4";
/** A file on a Vercel Blob store (ours on this server: see above). */
const STORE_HOST = "e2e-media.public.blob.vercel-storage.com";
const HANDOUT_URL = `https://${STORE_HOST}/${RUN}/handout.pdf`;
const HANDOUT = `E2E handout ${RUN}`;

const text = (title: string) =>
  narrative({
    en: { title, text: `E2E: ${title}.` },
    de: { title: `${title} (de)`, text: `E2E: ${title} (de).` },
    el: { title: `${title} (el)`, text: `E2E: ${title} (el).` },
  });
const ALL = (t: string) => ({ en: t, de: `${t} (de)`, el: `${t} (el)` });

const YT = {
  slug: `e2e-r3-yt-${RUN}`,
  lessons: [
    {
      id: ownLessonId(),
      label: ALL("Watch"),
      narrative: text("A YouTube lesson"),
      video: { provider: "youtube", src: `https://www.youtube.com/watch?v=${VIDEO_ID}`, title: "E2E YouTube clip", cues: [] },
    },
    { id: ownLessonId(), label: ALL("After"), narrative: text("After the video") },
  ] satisfies R2LessonSeed[],
};
const EXT = {
  slug: `e2e-r3-ext-${RUN}`,
  lessons: [
    {
      id: ownLessonId(),
      label: ALL("Elsewhere"),
      narrative: text("A video elsewhere"),
      video: { provider: "file", src: OTHER_HOST_VIDEO, title: "E2E clip elsewhere", cues: [] },
    },
  ] satisfies R2LessonSeed[],
};
const DOCS = {
  slug: `e2e-r3-docs-${RUN}`,
  lessons: [
    {
      id: ownLessonId(),
      label: ALL("Handouts"),
      narrative: text("Handouts"),
      documents: [{ name: HANDOUT, url: HANDOUT_URL }],
    },
    {
      id: ownLessonId(),
      label: ALL("Another"),
      narrative: text("Another lesson"),
      documents: [{ name: `E2E published ${RUN}`, url: "/demo/sample.pdf" }],
    },
  ] satisfies R2LessonSeed[],
};
const COURSES = [YT, EXT, DOCS];

const emails = {
  learner: `e2e-r3-media-learner-${RUN}@example.com`,
  big: `e2e-r3-media-big-${RUN}@example.com`,
  editor: `e2e-r3-media-editor-${RUN}@example.com`,
  facilitator: `e2e-r3-media-fa-${RUN}@example.com`,
  admin: `e2e-r3-media-admin-${RUN}@example.com`,
};
let learner: Person;
let big: Person;
let editor: Person;
let facilitator: Person;
let admin: Person;

/* -------------------------------------------- YouTube, stood in for --- */

const YOUTUBE_HOST = /(^|\.)(youtube|youtube-nocookie|ytimg|googlevideo)\.com$|(^|\.)youtu\.be$/;
const isYouTube = (url: string) => {
  try {
    return YOUTUBE_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

/**
 * YouTube's player API as far as the lesson player uses it: a Player that
 * puts a frame at `host`/embed/`videoId` into the element it is given and
 * says it is ready. The frame's page is a blank stand-in.
 */
const IFRAME_API = `(() => {
  function Player(el, opts) {
    const f = document.createElement("iframe");
    f.src = opts.host + "/embed/" + opts.videoId + "?enablejsapi=1";
    f.title = "E2E YouTube stand-in";
    f.style.width = "100%";
    f.style.height = "100%";
    el.appendChild(f);
    this.frame = f;
    setTimeout(() => opts.events && opts.events.onReady && opts.events.onReady({ target: this }), 0);
  }
  Player.prototype.pauseVideo = function () {};
  Player.prototype.playVideo = function () {};
  Player.prototype.getDuration = function () { return 0; };
  Player.prototype.getCurrentTime = function () { return 0; };
  Player.prototype.destroy = function () { this.frame && this.frame.remove(); };
  window.YT = { Player, PlayerState: {} };
  if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
})();`;

/** Routes every YouTube address to the stand-in, and answers the requests the page made to it. */
async function standInYouTube(page: Page): Promise<string[]> {
  const asked: string[] = [];
  page.on("request", (r: Request) => {
    if (isYouTube(r.url())) asked.push(r.url());
  });
  await page.route(
    (url) => YOUTUBE_HOST.test(url.hostname),
    (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/iframe_api") {
        return route.fulfill({ status: 200, contentType: "text/javascript", body: IFRAME_API });
      }
      if (url.pathname.startsWith("/embed/")) {
        return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>stand-in</title>" });
      }
      return route.fulfill({ status: 204, body: "" });
    }
  );
  return asked;
}

/**
 * Waits until the page has had no request open for 500 ms (the rule of
 * Playwright's "networkidle"), counted from the page's own request events.
 * Used once the player's frame has been removed: Playwright fires its own
 * "networkidle" again only when a later request ends, and after a frame has
 * come and gone with no later request (Next 16.4's router makes none here)
 * it waits for one that never comes.
 */
async function networkQuiet(page: Page, quietMs = 500, timeoutMs = 10_000) {
  let open = 0;
  let last = Date.now();
  const started = () => {
    open += 1;
    last = Date.now();
  };
  const ended = () => {
    open = Math.max(0, open - 1);
    last = Date.now();
  };
  page.on("request", started);
  page.on("requestfinished", ended);
  page.on("requestfailed", ended);
  try {
    const deadline = Date.now() + timeoutMs;
    while (open > 0 || Date.now() - last < quietMs) {
      if (Date.now() > deadline) throw new Error("the page's requests didn't settle");
      await page.waitForTimeout(50);
    }
  } finally {
    page.off("request", started);
    page.off("requestfinished", ended);
    page.off("requestfailed", ended);
  }
}

/** Routes `host` to a stand-in and answers the requests the page made to it. */
async function standIn(page: Page, host: string, contentType: string): Promise<string[]> {
  const asked: string[] = [];
  page.on("request", (r: Request) => {
    if (new URL(r.url()).hostname === host) asked.push(r.url());
  });
  await page.route(
    (url) => url.hostname === host,
    (route) => route.fulfill({ status: 200, contentType, body: "" })
  );
  return asked;
}

/** A lesson video's player: the region its title names. */
const videoRegion = (scope: Page | Locator, title: string) =>
  scope.getByRole("region", { name: title }).filter({ visible: true });

/** The frame the player made, once the viewer pressed play. */
const playerFrame = (page: Page) => page.locator('iframe[title="E2E YouTube stand-in"]');

/** Presses play behind the gate and checks what happens then. */
async function pressPlay(page: Page, gate: ReturnType<Page["getByTestId"]>, asked: string[], play: string) {
  expect(asked, "nothing asked of YouTube before the press").toEqual([]);
  await gate.getByRole("button", { name: play }).click();
  await expect(playerFrame(page)).toHaveCount(1);
  expect(new URL((await playerFrame(page).getAttribute("src")) ?? "").host).toBe("www.youtube-nocookie.com");
  const focused = page.locator(":focus");
  await expect(focused).toHaveAttribute("role", "status");
  await expect(focused).toHaveText(en.video.youtubeGate.loading);
}

describe("Release 3: lesson media from our own store, YouTube on request (D91, D92)", () => {
  test.beforeAll(async () => {
    await removePeople(prisma, Object.values(emails));
    learner = await createPerson(prisma, { email: emails.learner, roles: ["LEARNER"] });
    big = await createPerson(prisma, { email: emails.big, roles: ["LEARNER"], user: { fontSize: "xl" } });
    editor = await createPerson(prisma, { email: emails.editor, roles: ["CONTENT_EDITOR"], organisation: "A" });
    facilitator = await createPerson(prisma, { email: emails.facilitator, roles: ["FACILITATOR"], organisation: "A" });
    admin = await createPerson(prisma, { email: emails.admin, roles: ["ADMIN"] });
    for (const c of COURSES) {
      await seedECourse(prisma, {
        slug: c.slug,
        title: { en: `E2E media ${c.slug}`, de: `E2E Medien ${c.slug}`, el: `E2E μέσα ${c.slug}` },
        lessons: c.lessons,
        ready: ["de", "el"],
      });
    }
  });

  test.afterAll(async () => {
    const ids = [learner, big, editor, facilitator, admin].filter(Boolean).map((p) => p.userId);
    if (await hasFileQueue(prisma)) {
      await prisma.pendingFileDeletion.deleteMany({ where: { url: { contains: RUN } } });
    }
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: ids } },
          ...COURSES.flatMap((c) => [{ entityId: c.slug }, { entityId: { startsWith: `${c.slug}:` } }]),
        ],
      },
    });
    await removePeople(prisma, Object.values(emails));
    for (const c of COURSES) await removeECourse(prisma, c.slug);
    await prisma.$disconnect();
  });

  test("E-E4: YouTube is asked for nothing until the viewer presses play, in the player and the editor's preview", async ({
    page,
    context,
  }) => {
    const asked = await standInYouTube(page);

    // The learner's player: the gate, inside the 16:9 box on a wide screen.
    await signIn(context, learner.sessionToken);
    await page.goto(`/en/learner/course/${YT.slug}`);
    await expect(videoRegion(page, "E2E YouTube clip")).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    expect(asked, "nothing asked of YouTube as the lesson shows").toEqual([]);
    const gate = page.getByTestId("youtube-gate").filter({ visible: true });
    await expect(gate).toBeVisible();
    await expect(gate).toContainText(en.video.youtubeGate.body);
    await expect(gate.getByRole("link", { name: en.video.youtubeGate.privacyLink })).toHaveAttribute(
      "href",
      "/en/legal/privacy"
    );
    await expect(gate.getByRole("link", { name: en.video.youtubeGate.watchOn })).toHaveAttribute(
      "href",
      `https://www.youtube.com/watch?v=${VIDEO_ID}`
    );
    await page.waitForLoadState("networkidle");
    await pressPlay(page, gate, asked, en.video.youtubeGate.play);

    // The editor's live preview of the same lesson, and of a link just pasted.
    asked.length = 0;
    await signIn(context, editor.sessionToken);
    await page.goto(`/en/content/courses/${YT.slug}?lesson=${YT.lessons[0].id}`);
    const lesson = page.locator(`#lesson-${YT.lessons[0].id}`).filter({ visible: true });
    await expect(videoRegion(lesson, "E2E YouTube clip")).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    expect(asked, "nothing asked of YouTube as the preview shows").toEqual([]);
    const preview = lesson.getByTestId("youtube-gate");
    await expect(preview).toBeVisible();
    const field = lesson.getByLabel("Video URL (direct .mp4/.webm or a YouTube link)");
    await expect(field).toHaveValue(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
    await field.fill(`https://youtu.be/${OTHER_VIDEO_ID}`);
    await expect(preview.getByRole("link", { name: en.video.youtubeGate.watchOn })).toHaveAttribute(
      "href",
      `https://www.youtube.com/watch?v=${OTHER_VIDEO_ID}`
    );
    await page.waitForLoadState("networkidle");
    await pressPlay(page, preview, asked, en.video.youtubeGate.play);

    // The press was for that video: another link pasted asks again, and loads nothing.
    await field.fill(`https://youtu.be/${THIRD_VIDEO_ID}`);
    await expect(preview).toBeVisible();
    await expect(preview.getByRole("link", { name: en.video.youtubeGate.watchOn })).toHaveAttribute(
      "href",
      `https://www.youtube.com/watch?v=${THIRD_VIDEO_ID}`
    );
    await expect(playerFrame(page)).toHaveCount(0);
    await networkQuiet(page);
    expect(asked.filter((url) => url.includes(THIRD_VIDEO_ID)), "nothing asked of YouTube for the new link").toEqual([]);
    // Back to the link played before: asked again too.
    const playedBefore = asked.length;
    await field.fill(`https://youtu.be/${OTHER_VIDEO_ID}`);
    await expect(preview.getByRole("link", { name: en.video.youtubeGate.watchOn })).toHaveAttribute(
      "href",
      `https://www.youtube.com/watch?v=${OTHER_VIDEO_ID}`
    );
    await expect(playerFrame(page)).toHaveCount(0);
    await networkQuiet(page);
    expect(asked.length, "nothing asked of YouTube until the next press").toBe(playedBefore);
  });

  test("E-E5: a YouTube link saved as a file is stored as YouTube; another host's video or document is refused", async ({
    request,
  }) => {
    const [, target] = DOCS.lessons.map((l) => l.id);
    const call = (name: string, args: unknown[]) =>
      callAction(request, { as: editor, page: `/en/content/courses/${DOCS.slug}`, file: LESSON, name, args });
    const stored = async () =>
      (
        await prisma.lesson.findFirst({
          where: { projectId: PROJECT, courseSlug: DOCS.slug, stageKey: target },
          select: { video: true },
        })
      )?.video ?? null;

    const youTube = await call("saveLessonVideo", [
      DOCS.slug,
      target,
      { provider: "file", src: `https://youtu.be/${VIDEO_ID}`, title: "Pasted", cues: [] },
    ]);
    expect(youTube.result).toMatchObject({ ok: true });
    expect(await stored()).toMatchObject({ provider: "youtube", src: `https://www.youtube.com/watch?v=${VIDEO_ID}` });

    const mp4 = await call("saveLessonVideo", [DOCS.slug, target, { provider: "file", src: OTHER_HOST_VIDEO, cues: [] }]);
    expect(mp4.result).toMatchObject({ ok: false, error: "host-refused" });
    expect(await stored(), "the video before stays").toMatchObject({ provider: "youtube" });

    const doc = await call("addLessonDocument", [
      DOCS.slug,
      target,
      { name: "Elsewhere", url: "https://files.example.org/e2e.pdf", mimeType: "application/pdf", sizeBytes: 10 },
    ]);
    expect(doc.result).toMatchObject({ ok: false, error: "host-refused" });
    expect(await prisma.lessonDocument.count({ where: { url: "https://files.example.org/e2e.pdf" } })).toBe(0);

    // Clean again for the other tests.
    expect((await call("clearLessonVideo", [DOCS.slug, target])).result).toMatchObject({ ok: true });
  });

  test("E-E6: a video stored on another host is a link out, and that host is never asked", async ({ page, context }) => {
    const asked = await standIn(page, "media.example.org", "video/mp4");
    await signIn(context, learner.sessionToken);
    await page.goto(`/en/learner/course/${EXT.slug}`);
    await expect(videoRegion(page, "E2E clip elsewhere")).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    expect(asked, "nothing asked of the other host").toEqual([]);
    const open = page.getByRole("link", { name: en.video.external.open }).filter({ visible: true });
    await expect(open).toHaveAttribute("href", OTHER_HOST_VIDEO);
    await expect(page.getByText(en.video.external.body).filter({ visible: true })).toBeVisible();
    await expect(page.getByTestId("lesson-video")).toHaveCount(0);
  });

  test("E-E7: a facilitator can't publish or withdraw a lesson document", async ({ request }) => {
    const doc = await prisma.lessonDocument.findFirstOrThrow({
      where: { name: `E2E published ${RUN}` },
      select: { id: true },
    });
    const answer = await callAction(request, {
      as: facilitator,
      page: `/en/content/courses/${DOCS.slug}`,
      file: LESSON,
      name: "setLessonDocumentPublished",
      args: [doc.id, false],
    });
    expect(answer.result).toEqual({ ok: false, error: "forbidden" });
    expect((await prisma.lessonDocument.findUniqueOrThrow({ where: { id: doc.id } })).published).toBe(true);
  });

  for (const [locale, messages] of [
    ["de", de],
    ["el", el],
    // English too: its privacy link is one short line, the smallest target (WCAG 2.5.8).
    ["en", en],
  ] as const) {
    test(`E-E9: at 320 px with the largest text, in ${locale}, the play button is below the video, reachable, and nothing scrolls sideways`, async ({
      page,
      context,
    }) => {
      const asked = await standInYouTube(page);
      await page.setViewportSize({ width: 320, height: 640 });
      await signIn(context, big.sessionToken);
      await page.goto(`/${locale}/learner/course/${YT.slug}`);
      await expect(page.locator("html")).toHaveAttribute("data-font-size", "xl", { timeout: 15_000 });
      const gate = page.getByTestId("youtube-gate").filter({ visible: true });
      await expect(gate).toBeVisible();
      const play = gate.getByRole("button", { name: messages.video.youtubeGate.play });
      await expect(play).toBeVisible();

      // Below the 16:9 box, in the page's flow, and all of it on screen.
      const box = await play.boundingBox();
      expect(box, "the play button has a size").not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
      const inBox = await gate.evaluate((g) => !!g.closest(".aspect-video"));
      expect(inBox, "the gate is below the video").toBe(false);
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(sideways, "no sideways scroll").toBeLessThanOrEqual(0);

      // Reachable by keyboard, from the top of the page.
      await page.locator("body").focus();
      let reached = false;
      for (let i = 0; i < 60 && !reached; i++) {
        await page.keyboard.press("Tab");
        reached = await play.evaluate((b) => b === document.activeElement);
      }
      expect(reached, "Tab reaches the play button").toBe(true);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious, JSON.stringify(serious.map((v) => [v.id, v.nodes.map((n) => n.target)]))).toEqual([]);
      expect(asked, "nothing asked of YouTube").toEqual([]);
    });
  }

  test("E-E10: a removed document's address waits in the queue, and comes off it when pasted back", async ({
    page,
    context,
    request,
  }) => {
    await standIn(page, STORE_HOST, "application/pdf");
    const [handouts, another] = DOCS.lessons.map((l) => l.id);
    await signIn(context, editor.sessionToken);
    await page.goto(`/en/content/courses/${DOCS.slug}?lesson=${handouts}`);
    const lesson = page.locator(`#lesson-${handouts}`).filter({ visible: true });
    const remove = lesson.getByRole("button", { name: `Remove ${HANDOUT}` });
    await expect(remove).toBeVisible({ timeout: 15_000 });

    // Asked with the new wording.
    let asked = "";
    page.once("dialog", (d) => {
      asked = d.message();
      void d.accept();
    });
    await remove.click();
    await expect(remove).toHaveCount(0);
    expect(asked).toBe(
      `Remove “${HANDOUT}” from this lesson? Learners will no longer see it. The file is deleted for good about a week later.`
    );

    // The record is gone, its address queued exactly as it held it.
    expect(await prisma.lessonDocument.count({ where: { url: HANDOUT_URL } })).toBe(0);
    expect(await hasFileQueue(prisma), "the database has the file queue").toBe(true);
    const queued = await prisma.pendingFileDeletion.findMany({ where: { url: { contains: RUN } } });
    expect(queued.map((q) => [q.url, q.reason])).toEqual([[HANDOUT_URL, "document.removed"]]);

    // Nothing deletes it: the dry run lists it as waiting, on a server that keeps files.
    const preview = () => callAction(request, { as: admin, page: "/en/admin/data", file: ADMIN_DATA, name: "previewCleanup", args: [] });
    const before = (await preview()).result as { ok: true; plan: { files: Record<string, unknown> } };
    expect(before.plan.files).toMatchObject({ mode: "keep", deleted: 0 });
    expect(before.plan.files.waiting).toEqual(expect.any(Number));
    expect(before.plan.files.waiting as number).toBeGreaterThanOrEqual(1);

    // A week and a day later, an editor pastes the address into another lesson…
    await prisma.pendingFileDeletion.update({
      where: { url: HANDOUT_URL },
      data: { queuedAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    const pasted = await callAction(request, {
      as: editor,
      page: `/en/content/courses/${DOCS.slug}`,
      file: LESSON,
      name: "addLessonDocument",
      args: [DOCS.slug, another, { name: `Pasted back ${RUN}`, url: HANDOUT_URL, mimeType: "application/pdf", sizeBytes: 1024 }],
    });
    expect(pasted.result).toMatchObject({ ok: true });

    // …and the clean-up's dry run takes it off the queue: dropped, never deleted.
    const after = (await preview()).result as { ok: true; plan: { files: Record<string, unknown> } };
    expect(after.plan.files).toMatchObject({ mode: "keep", deleted: 0, dropped: 1 });
    expect(await prisma.pendingFileDeletion.count({ where: { url: HANDOUT_URL } }), "a dry run changes nothing").toBe(1);

    // The other lesson links the file as it was.
    await page.goto(`/en/content/courses/${DOCS.slug}?lesson=${another}`);
    const other = page.locator(`#lesson-${another}`).filter({ visible: true });
    await expect(other.getByRole("link", { name: `Pasted back ${RUN}` })).toHaveAttribute("href", HANDOUT_URL, {
      timeout: 15_000,
    });
  });
});

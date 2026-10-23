/**
 * POST /api/progress/beacon — a learner's course save sent as the page goes
 * (D37 as built, 24 October).
 *
 * Next sends a page's server actions one at a time: a course save handed
 * over while another is on its way waits behind it, and one waiting never
 * leaves a page that goes. So on `pagehide` the learner store sends what
 * the server hasn't confirmed of each course with a save on its way or
 * failed here too, with fetch(keepalive), which the browser finishes after
 * the page has gone (src/store/course-save.ts progressBeacons; the body,
 * src/lib/learner-progress/beacon.ts).
 *
 * The save is the save action's own code (saveCourseProgressPatch in
 * src/app/actions/learner.ts), so it enforces exactly what that does: the
 * signed-in learner from the session cookie, the learner the save was made
 * for (another account's is refused), the course looked up in the project
 * (a course nobody ever published enrols no one), the patch's limits
 * (refused whole when too big, an answer over a limit refused alone), the
 * D62 merge under the Course and enrolment locks, never a Lesson row, and
 * never audited. A save that also arrives through the action queue writes
 * the same values: an answer is set to what the page has, finished lessons
 * and the completion only grow, the first completion date stays, and the
 * badge is inserted only if missing. Before it:
 *
 * - only POST is served (Next answers anything else 405);
 * - only from this site's own pages: Sec-Fetch-Site, when sent, must be
 *   same-origin, and Origin, when sent, this site's own (or AUTH_URL's);
 *   a request that sends neither is refused (403), and nothing is read;
 * - a JSON body (Content-Type application/json, 415 otherwise) of at most
 *   BEACON_MAX_BYTES, read no further than that (413), in the save's shape
 *   (400);
 * - someone signed in (401), whose profile step is done (D79: before it,
 *   nothing of the person's learning is saved; 403).
 *
 * The page is gone and doesn't read the answer: its status says what
 * happened, for the logs and the tests. Nothing personal is logged.
 */

import { saveCourseProgressPatch } from "@/app/actions/learner";
import { getCurrentUser } from "@/lib/auth-helpers";
import { BEACON_MAX_BYTES, readBeaconBody } from "@/lib/learner-progress/beacon";
import { prisma } from "@/lib/prisma";
import { isProfileComplete, profileRules } from "@/lib/profile";

export const dynamic = "force-dynamic";

const PROJECT = "seq-elevate";

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
const refused = (status: number, error: string) => answer(status, { ok: false, error });

/**
 * Is the request from this site's own pages? Every header a browser sent
 * of the two must say so, and it must have sent one of them.
 */
function fromOurPages(request: Request, env: Record<string, string | undefined> = process.env): boolean {
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  if (site === null && origin === null) return false;
  if (site !== null && site !== "same-origin") return false;
  if (origin === null) return true;
  const ours = new Set([new URL(request.url).origin]);
  try {
    if (env.AUTH_URL) ours.add(new URL(env.AUTH_URL).origin);
  } catch {
    // An unreadable AUTH_URL adds nothing.
  }
  return ours.has(origin);
}

/** The body as text, read no further than `max` bytes: null when it is longer. */
async function bodyWithin(request: Request, max: number): Promise<string | null> {
  const stated = Number(request.headers.get("content-length"));
  if (Number.isFinite(stated) && stated > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

const STATUS_OF_REFUSAL: Record<string, number> = {
  "other-account": 403,
  "unknown-course": 404,
  "bad-input": 400,
  "too-large": 413,
};

export async function POST(request: Request) {
  if (!fromOurPages(request)) return refused(403, "forbidden");
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return refused(415, "unsupported-media-type");
  let text: string | null;
  try {
    text = await bodyWithin(request, BEACON_MAX_BYTES);
  } catch {
    return refused(400, "bad-input"); // the body broke off
  }
  if (text === null) return refused(413, "too-large");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return refused(400, "bad-input");
  }
  const save = readBeaconBody(raw);
  if (!save) return refused(400, "bad-input");

  try {
    const user = await getCurrentUser();
    if (!user) return refused(401, "not-signed-in");
    const profile = await prisma.projectProfile.findUnique({
      where: { userId_projectId: { userId: user.id, projectId: PROJECT } },
      select: { country: true, termsVersion: true, ageConfirmedAt: true, consentAt: true },
    });
    if (!isProfileComplete(user, profile, profileRules())) return refused(403, "profile-incomplete");

    const result = await saveCourseProgressPatch(save.slug, save.patch, save.forUser);
    if (result.ok) return answer(200, { ok: true, refused: result.refused });
    return answer(STATUS_OF_REFUSAL[result.error] ?? 400, result);
  } catch (e) {
    // A session lookup or the database failed: the page's outbox, if it
    // still has one, brings the answers back on its next load.
    console.error(`[progress-beacon] the save failed: ${e instanceof Error ? e.name : "error"}`);
    return refused(503, "unavailable");
  }
}

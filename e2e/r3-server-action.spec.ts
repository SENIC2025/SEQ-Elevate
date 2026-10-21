import { test, expect } from "@playwright/test";
import { PrismaClient, type Role } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { builtActionsOf, callAction, decodeActionResponse } from "./fixtures/server-action";
import { createPerson } from "./fixtures/people";

/**
 * Release 3 (spec 18.3): the fixture that calls a server action directly
 * finds the action in the build and reads its answer. Shown on
 * saveObservation, whose rules hold on every build since Release 0: a
 * facilitator's note about a staff member is refused and nothing is
 * written; the same note about a learner is saved; with no session nothing
 * is written either. Where the Release 3 tables exist, everyone here has a
 * complete profile in one organisation, so the facilitator's scope covers
 * them (D74); the old build has no such table and needs none.
 *
 * Requires a real database — gated on E2E_DB=1. Every email is unique to
 * the run, and everything the run made is removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;
test.describe.configure({ mode: "serial" });

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const email = (who: string) => `e2e-action-${who}-${RUN}@example.com`;
const EMAILS = [email("facilitator"), email("staff"), email("learner")];

const FILE = "src/app/actions/facilitator.ts";
const PAGE = "/en/facilitator";

async function makeUser(address: string, roles: Role[]) {
  // Everyone in one organisation (A, one the seed makes), so the
  // facilitator's scope covers them (D74).
  const { userId, sessionToken } = await createPerson(prisma, {
    email: address,
    name: "E2E",
    roles,
    organisation: "A",
  });
  return { userId, sessionToken };
}

const notesAbout = (userId: string) => prisma.observation.count({ where: { observedId: userId } });

test("decodes an action's answer, a void answer and a thrown error", () => {
  expect(decodeActionResponse('0:{"a":"$@1","f":"","b":"x"}\n1:{"ok":false}\n').result).toEqual({ ok: false });
  expect(decodeActionResponse('0:{"a":"$@1","f":"","b":"x"}\n1:"$undefined"\n').result).toBeUndefined();
  expect(
    decodeActionResponse('0:{"a":"$@1","f":"","b":"x"}\n1:{"ok":true,"at":"$D2026-11-20T09:00:00.000Z","l":"$2"}\n2:["$$a"]\n')
      .result
  ).toEqual({ ok: true, at: "2026-11-20T09:00:00.000Z", l: ["$a"] });
  expect(decodeActionResponse('0:{"a":"$@1","f":"","b":"x"}\n1:T6,héllo\n').result).toBe("héllo");
  expect(decodeActionResponse('0:{"a":"$@1","f":"","b":"x"}\n1:E{"digest":"123"}\n')).toEqual({
    result: undefined,
    error: "123",
    thrown: true,
  });
  expect(decodeActionResponse("Server action not found.")).toEqual({
    result: undefined,
    error: "no action result in the response",
    thrown: false,
  });
});

describe("Calling a server action directly", () => {
  let facilitator: { userId: string; sessionToken: string };
  let staff: { userId: string; sessionToken: string };
  let learner: { userId: string; sessionToken: string };

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    facilitator = await makeUser(email("facilitator"), ["FACILITATOR"]);
    staff = await makeUser(email("staff"), ["CONTENT_EDITOR", "LEARNER"]);
    learner = await makeUser(email("learner"), ["LEARNER"]);
  });

  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
  });

  test("the build names the facilitator actions", () => {
    expect(builtActionsOf(FILE)).toEqual(expect.arrayContaining(["recordValidation", "saveObservation"]));
  });

  test("a note about a staff member is refused and nothing is written", async ({ request }) => {
    const answer = await callAction(request, {
      as: facilitator,
      page: PAGE,
      file: FILE,
      name: "saveObservation",
      args: [staff.userId, `About a colleague ${RUN}`],
    });
    expect(answer.status, answer.raw).toBe(200);
    expect(answer.result).toEqual({ ok: false });
    expect(await notesAbout(staff.userId)).toBe(0);
  });

  test("the same note about a learner is saved", async ({ request }) => {
    const answer = await callAction(request, {
      as: facilitator,
      page: PAGE,
      file: FILE,
      name: "saveObservation",
      args: [learner.userId, `About a learner ${RUN}`],
    });
    expect(answer.status, answer.raw).toBe(200);
    expect(answer.result).toEqual({ ok: true });
    const notes = await prisma.observation.findMany({ where: { observedId: learner.userId } });
    expect(notes.map((n) => [n.observerId, n.note])).toEqual([[facilitator.userId, `About a learner ${RUN}`]]);
  });

  test("with no session nothing is written", async ({ request }) => {
    const answer = await callAction(request, {
      as: null,
      page: PAGE,
      file: FILE,
      name: "saveObservation",
      args: [learner.userId, `Anonymous ${RUN}`],
    });
    expect(answer.result).toEqual({ ok: false });
    expect(await notesAbout(learner.userId)).toBe(1);
  });

  test("an action the build doesn't have is a clear error, not a request", async ({ request }) => {
    await expect(
      callAction(request, { as: facilitator, page: PAGE, file: FILE, name: "noSuchAction", args: [] })
    ).rejects.toThrow(/0 ids for src\/app\/actions\/facilitator\.ts#noSuchAction/);
  });
});

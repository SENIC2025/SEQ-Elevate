/**
 * Seeds ONE polished, CMS-created demo course on the staging/showcase deploy,
 * so clients can open the platform and try a fully code-free course — narrative
 * + an interactive simulation + a branching scenario + an assessment.
 *
 * Runs during the Vercel build (wired into `vercel-build`), so it uses the
 * build environment's own Neon credential — no secret is ever handled outside
 * Vercel. Idempotent: everything is upserted by its natural key, so redeploys
 * refresh the content in place rather than duplicating it.
 *
 * Guard: skipped when DEMO_LOGIN_DISABLED=true — the same kill-switch that
 * turns off the demo sign-in on a real production domain (see DECISIONS D16).
 * So the demo course rides along on the demo deploy and vanishes on real prod.
 * Never fails the build: any error is logged and swallowed.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
const PROJECT = "seq-elevate";
const SLUG = "demo-speaking-up";

if (!url || url.includes("placeholder")) {
  console.log("[seed-demo] no real DATABASE_URL — skipping");
  process.exit(0);
}
if (process.env.DEMO_LOGIN_DISABLED === "true") {
  console.log("[seed-demo] demo access disabled — skipping demo course");
  process.exit(0);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});

/** Per-locale text helper — EN authored; DE/EL fall back at render time. */
const t = (en) => ({ en });

const META = {
  en: {
    title: "Demo · Speaking up when something feels off",
    tagline: "15 minutes · saying the hard thing, kindly and clearly",
    clusterLabel: "Communication & EI",
  },
};

const NARRATIVE = {
  context: {
    title: "Three weeks into a new placement",
    blocks: [
      {
        kind: "paragraph",
        text: "You've just started at a busy café. During the lunch rush your supervisor, Mara, tells you off in front of customers for something a colleague actually did. Your face goes hot. Everyone heard it.",
      },
      {
        kind: "callout",
        text: "The skill this course builds: naming a problem without making it a fight — so you're heard and the relationship survives.",
      },
    ],
  },
  concept: {
    title: "Why 'speaking up' feels so risky",
    blocks: [
      {
        kind: "paragraph",
        text: "When we feel blamed, the body reacts before the brain does — heat, a tight chest, the urge to snap back or shrink away. Neither reaction gets you heard.",
      },
      {
        kind: "list",
        items: [
          "Snapping back turns a misunderstanding into a conflict.",
          "Saying nothing lets the wrong version of events stand.",
          "There's a third option: name what happened, calmly, at the right moment.",
        ],
      },
      {
        kind: "paragraph",
        text: "That third option is a skill — and like any skill, it gets easier with a few reps.",
      },
    ],
  },
  behaviour: {
    title: "The move: an I-statement, in private",
    blocks: [
      {
        kind: "callout",
        text: "\"When ___ happened, I felt ___. Could we ___ next time?\"",
      },
      {
        kind: "compare",
        compare: [
          {
            label: "Blaming",
            text: "\"You always blame me for things I didn't do.\"",
            tone: "negative",
          },
          {
            label: "I-statement",
            text: "\"When I was corrected in front of customers, I felt singled out. Could we have a quiet word next time?\"",
            tone: "positive",
          },
        ],
      },
      {
        kind: "paragraph",
        text: "Same message. One starts a fight; the other opens a door. The rest of this course lets you practise the door-opening version.",
      },
    ],
  },
};

const SIMULATION = {
  kind: "simulation",
  title: t("Practise the response"),
  prompt: t(
    "The rush is over. Mara is refilling the coffee machine. You want to clear up what happened earlier. What do you say?"
  ),
  instruction: t("Pick the response most likely to be heard."),
  options: [
    {
      id: "blame",
      isBest: false,
      text: t("\"You blamed me for something that wasn't even my fault.\""),
      feedback: t(
        "Understandable — but 'you' + 'blamed' puts Mara on the defensive, and the point gets lost in the argument that follows."
      ),
    },
    {
      id: "istatement",
      isBest: true,
      text: t(
        "\"When I got corrected in front of customers, I felt singled out. Could we have a quiet word next time?\""
      ),
      feedback: t(
        "This names the impact on you and asks for a small, reasonable change — without attacking. It's the door-opener."
      ),
    },
    {
      id: "shrink",
      isBest: false,
      text: t("\"…never mind, it's fine.\" (and say nothing)"),
      feedback: t(
        "It keeps the peace for now, but the wrong version stands and the same thing can happen again."
      ),
    },
  ],
};

const SCENARIO = {
  kind: "scenario",
  title: t("Play it out"),
  setup: t(
    "It happens again a week later — a colleague, Sam, leaves a mess and Mara assumes it was you. You decide to address it."
  ),
  question: t("What's your first move?"),
  followupQuestion: t("Mara is a bit defensive. What now?"),
  choices: [
    {
      id: "private",
      quality: "best",
      text: t("Wait for a quiet moment, then talk to Mara privately"),
      outcome: t(
        "Mara actually relaxes when it's not in front of anyone. She's willing to listen."
      ),
      followups: [
        {
          id: "askstop",
          quality: "best",
          text: t("Calmly explain what happened and ask to be checked with first"),
          outcome: t(
            "Mara agrees to ask before assuming next time. Problem named, relationship intact."
          ),
        },
        {
          id: "accept",
          quality: "okay",
          text: t("Accept the blame to avoid the awkwardness"),
          outcome: t(
            "The tension eases now, but nothing changes — so it may well happen again."
          ),
        },
      ],
    },
    {
      id: "public",
      quality: "poor",
      text: t("Correct Mara right there on the floor"),
      outcome: t("Mara feels shown up in front of the team and digs in."),
      followups: [
        {
          id: "escalate",
          quality: "poor",
          text: t("Push back harder"),
          outcome: t("It becomes an argument. Neither of you is really listening now."),
        },
        {
          id: "retreat",
          quality: "okay",
          text: t("Step back and ask for a quiet word instead"),
          outcome: t("You recover the situation — better late than never."),
        },
      ],
    },
  ],
};

const ASSESSMENT = {
  kind: "assessment",
  title: t("Quick check"),
  intro: t("Two quick questions to lock it in."),
  questions: [
    {
      id: "q1",
      correctOptionId: "b",
      question: t("What makes an I-statement land better than blaming?"),
      options: [
        { id: "a", text: t("It hides how you actually feel") },
        {
          id: "b",
          text: t("It names the impact on you and asks for a change, without attacking"),
        },
        { id: "c", text: t("It makes sure the other person feels guilty") },
      ],
    },
    {
      id: "q2",
      correctOptionId: "b",
      question: t("When is the best time to raise it?"),
      options: [
        { id: "a", text: t("Immediately, in front of everyone") },
        { id: "b", text: t("In a quiet moment, one to one") },
        { id: "c", text: t("Never — just let it go") },
      ],
    },
  ],
};

async function upsertLesson(stageKey, data) {
  await prisma.lesson.upsert({
    where: {
      projectId_courseSlug_stageKey: {
        projectId: PROJECT,
        courseSlug: SLUG,
        stageKey,
      },
    },
    create: { projectId: PROJECT, courseSlug: SLUG, stageKey, ...data },
    update: data,
  });
}

async function main() {
  // The project must exist (seeded by the main seed / present in prod).
  const project = await prisma.project.findUnique({ where: { id: PROJECT } });
  if (!project) {
    console.log("[seed-demo] project not found — skipping");
    return;
  }

  await prisma.course.upsert({
    where: { projectId_slug: { projectId: PROJECT, slug: SLUG } },
    create: {
      projectId: PROJECT,
      strapiId: `cms-${SLUG}`,
      slug: SLUG,
      cluster: "communicationEi",
      durationMinutes: 15,
      status: "published",
      publishedAt: new Date(),
      meta: META,
    },
    update: { status: "published", meta: META },
  });

  await upsertLesson("context", {
    narrative: { en: NARRATIVE.context },
  });
  await upsertLesson("concept", {
    narrative: { en: NARRATIVE.concept },
  });
  await upsertLesson("behaviour", {
    narrative: { en: NARRATIVE.behaviour },
  });
  await upsertLesson("simulation", { structure: SIMULATION });
  await upsertLesson("scenario", { structure: SCENARIO });
  await upsertLesson("assessment", { structure: ASSESSMENT });

  console.log(`[seed-demo] demo course '${SLUG}' seeded/refreshed (published)`);
}

main()
  .catch((e) => {
    // Never block a deploy over demo content.
    console.error("[seed-demo] non-fatal error:", e?.message ?? e);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });

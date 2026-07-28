/**
 * Seeds ONE polished, CMS-created demo course on the staging/showcase deploy,
 * so clients can open the platform and try a fully code-free course — narrative
 * + an interactive simulation + a branching scenario + an assessment.
 *
 * Trilingual: every learner-facing string is authored in EN + DE + EL. The
 * structural facts (option ids, isBest, quality, correctOptionId) are stored
 * once and are language-neutral (see DECISIONS D20) — only text is per-locale.
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

/** Per-locale text map. Structural fields never carry text — this is only copy. */
const L = (en, de, el) => ({ en, de, el });

const META = {
  en: {
    title: "Demo · Speaking up when something feels off",
    tagline: "15 minutes · saying the hard thing, kindly and clearly",
    clusterLabel: "Communication & EI",
  },
  de: {
    title: "Demo · Etwas ansprechen, wenn sich etwas falsch anfühlt",
    tagline: "15 Minuten · das Schwierige sagen – freundlich und klar",
    clusterLabel: "Kommunikation & EI",
  },
  el: {
    title: "Demo · Να μιλάς όταν κάτι δεν πάει καλά",
    tagline: "15 λεπτά · να λες το δύσκολο, ευγενικά και καθαρά",
    clusterLabel: "Επικοινωνία & ΣΝ",
  },
};

// Narrative stages: per-locale { title, blocks }. Block kinds are structural
// (paragraph/list/callout/compare); only their text is translated.
const NARRATIVE = {
  context: {
    en: {
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
    de: {
      title: "Drei Wochen in einem neuen Praktikum",
      blocks: [
        {
          kind: "paragraph",
          text: "Du hast gerade in einem gut besuchten Café angefangen. Mitten im Mittagstrubel weist dich deine Vorgesetzte Mara vor den Gästen zurecht – für etwas, das eigentlich eine Kollegin gemacht hat. Dein Gesicht wird heiß. Alle haben es gehört.",
        },
        {
          kind: "callout",
          text: "Die Fähigkeit, die dieser Kurs aufbaut: ein Problem ansprechen, ohne dass daraus ein Streit wird – damit du gehört wirst und die Beziehung erhalten bleibt.",
        },
      ],
    },
    el: {
      title: "Τρεις εβδομάδες σε μια νέα τοποθέτηση",
      blocks: [
        {
          kind: "paragraph",
          text: "Μόλις ξεκίνησες σε ένα πολυσύχναστο καφέ. Μέσα στη φούρια του μεσημεριού, η υπεύθυνή σου, η Μάρα, σε επιπλήττει μπροστά στους πελάτες για κάτι που στην πραγματικότητα έκανε μια συνάδελφος. Το πρόσωπό σου κοκκινίζει. Το άκουσαν όλοι.",
        },
        {
          kind: "callout",
          text: "Η δεξιότητα που χτίζει αυτό το μάθημα: να ονομάζεις ένα πρόβλημα χωρίς να το κάνεις καβγά — ώστε να σε ακούν και η σχέση να αντέχει.",
        },
      ],
    },
  },
  concept: {
    en: {
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
    de: {
      title: "Warum es sich so riskant anfühlt, etwas zu sagen",
      blocks: [
        {
          kind: "paragraph",
          text: "Wenn wir uns beschuldigt fühlen, reagiert der Körper schneller als der Kopf – Hitze, ein enges Gefühl in der Brust, der Drang zurückzuschießen oder sich klein zu machen. Keine der beiden Reaktionen sorgt dafür, dass du gehört wirst.",
        },
        {
          kind: "list",
          items: [
            "Zurückzuschießen macht aus einem Missverständnis einen Konflikt.",
            "Nichts zu sagen lässt die falsche Version der Geschichte stehen.",
            "Es gibt eine dritte Möglichkeit: ruhig und im richtigen Moment ansprechen, was passiert ist.",
          ],
        },
        {
          kind: "paragraph",
          text: "Diese dritte Möglichkeit ist eine Fähigkeit – und wie jede Fähigkeit wird sie mit ein paar Wiederholungen leichter.",
        },
      ],
    },
    el: {
      title: "Γιατί το να μιλήσεις μοιάζει τόσο ριψοκίνδυνο",
      blocks: [
        {
          kind: "paragraph",
          text: "Όταν νιώθουμε ότι μας κατηγορούν, το σώμα αντιδρά πριν το μυαλό — ζέστη, σφίξιμο στο στήθος, η παρόρμηση να απαντήσεις απότομα ή να μαζευτείς. Καμία από τις δύο αντιδράσεις δεν σε κάνει να ακουστείς.",
        },
        {
          kind: "list",
          items: [
            "Το να απαντάς απότομα μετατρέπει μια παρεξήγηση σε σύγκρουση.",
            "Το να μη λες τίποτα αφήνει τη λάθος εκδοχή των γεγονότων να επικρατήσει.",
            "Υπάρχει και μια τρίτη επιλογή: να πεις τι έγινε, ήρεμα, την κατάλληλη στιγμή.",
          ],
        },
        {
          kind: "paragraph",
          text: "Αυτή η τρίτη επιλογή είναι μια δεξιότητα — και όπως κάθε δεξιότητα, γίνεται πιο εύκολη με λίγη εξάσκηση.",
        },
      ],
    },
  },
  behaviour: {
    en: {
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
    de: {
      title: "Der Trick: eine Ich-Botschaft, unter vier Augen",
      blocks: [
        {
          kind: "callout",
          text: "„Als ___ passiert ist, habe ich mich ___ gefühlt. Könnten wir das nächste Mal ___?“",
        },
        {
          kind: "compare",
          compare: [
            {
              label: "Vorwurfsvoll",
              text: "„Du gibst mir immer die Schuld für Dinge, die ich nicht getan habe.“",
              tone: "negative",
            },
            {
              label: "Ich-Botschaft",
              text: "„Als ich vor den Gästen zurechtgewiesen wurde, habe ich mich bloßgestellt gefühlt. Könnten wir das nächste Mal kurz unter vier Augen sprechen?“",
              tone: "positive",
            },
          ],
        },
        {
          kind: "paragraph",
          text: "Dieselbe Botschaft. Die eine beginnt einen Streit, die andere öffnet eine Tür. Im Rest des Kurses übst du die Tür-öffnende Variante.",
        },
      ],
    },
    el: {
      title: "Η κίνηση: ένα μήνυμα σε πρώτο πρόσωπο, ιδιαιτέρως",
      blocks: [
        {
          kind: "callout",
          text: "«Όταν συνέβη το ___, ένιωσα ___. Θα μπορούσαμε την επόμενη φορά να ___;»",
        },
        {
          kind: "compare",
          compare: [
            {
              label: "Κατηγορώντας",
              text: "«Πάντα με κατηγορείς για πράγματα που δεν έκανα.»",
              tone: "negative",
            },
            {
              label: "Μήνυμα σε α' πρόσωπο",
              text: "«Όταν με διόρθωσαν μπροστά στους πελάτες, ένιωσα ότι με ξεχώρισαν αρνητικά. Θα μπορούσαμε την επόμενη φορά να το πούμε ιδιαιτέρως;»",
              tone: "positive",
            },
          ],
        },
        {
          kind: "paragraph",
          text: "Το ίδιο μήνυμα. Το ένα ξεκινά καβγά· το άλλο ανοίγει μια πόρτα. Στο υπόλοιπο μάθημα θα εξασκηθείς στην εκδοχή που ανοίγει πόρτες.",
        },
      ],
    },
  },
};

const SIMULATION = {
  kind: "simulation",
  title: L("Practise the response", "Übe die Reaktion", "Εξάσκησε την απάντηση"),
  prompt: L(
    "The rush is over. Mara is refilling the coffee machine. You want to clear up what happened earlier. What do you say?",
    "Der Ansturm ist vorbei. Mara füllt gerade die Kaffeemaschine auf. Du möchtest klären, was vorhin passiert ist. Was sagst du?",
    "Η φούρια πέρασε. Η Μάρα γεμίζει τη μηχανή του καφέ. Θέλεις να ξεκαθαρίσεις τι έγινε νωρίτερα. Τι λες;"
  ),
  instruction: L(
    "Pick the response most likely to be heard.",
    "Wähle die Reaktion, die am ehesten gehört wird.",
    "Διάλεξε την απάντηση που έχει τις περισσότερες πιθανότητες να ακουστεί."
  ),
  options: [
    {
      id: "blame",
      isBest: false,
      text: L(
        "\"You blamed me for something that wasn't even my fault.\"",
        "„Du hast mir die Schuld für etwas gegeben, das gar nicht meine Schuld war.“",
        "«Με κατηγόρησες για κάτι που δεν ήταν καν δικό μου λάθος.»"
      ),
      feedback: L(
        "Understandable — but 'you' + 'blamed' puts Mara on the defensive, and the point gets lost in the argument that follows.",
        "Verständlich – aber „du“ + „Schuld“ bringt Mara in die Defensive, und dein Anliegen geht im folgenden Streit unter.",
        "Κατανοητό — αλλά το «εσύ» + «κατηγόρησες» βάζει τη Μάρα σε άμυνα, και το ουσιαστικό χάνεται στον καβγά που ακολουθεί."
      ),
    },
    {
      id: "istatement",
      isBest: true,
      text: L(
        "\"When I got corrected in front of customers, I felt singled out. Could we have a quiet word next time?\"",
        "„Als ich vor den Gästen korrigiert wurde, habe ich mich bloßgestellt gefühlt. Könnten wir das nächste Mal kurz unter vier Augen reden?“",
        "«Όταν με διόρθωσαν μπροστά στους πελάτες, ένιωσα ότι με ξεχώρισαν. Θα μπορούσαμε την επόμενη φορά να το πούμε ιδιαιτέρως;»"
      ),
      feedback: L(
        "This names the impact on you and asks for a small, reasonable change — without attacking. It's the door-opener.",
        "Das benennt die Wirkung auf dich und bittet um eine kleine, faire Änderung – ohne Angriff. Das ist der Türöffner.",
        "Αυτό ονομάζει την επίδραση σε σένα και ζητά μια μικρή, λογική αλλαγή — χωρίς επίθεση. Αυτό ανοίγει την πόρτα."
      ),
    },
    {
      id: "shrink",
      isBest: false,
      text: L(
        "\"…never mind, it's fine.\" (and say nothing)",
        "„…schon gut, ist nicht so wichtig.“ (und sagst nichts)",
        "«…άσ' το, δεν πειράζει.» (και δεν λες τίποτα)"
      ),
      feedback: L(
        "It keeps the peace for now, but the wrong version stands and the same thing can happen again.",
        "Das wahrt den Frieden für den Moment, aber die falsche Version bleibt stehen – und dasselbe kann wieder passieren.",
        "Κρατά την ηρεμία προς το παρόν, αλλά η λάθος εκδοχή μένει και το ίδιο μπορεί να ξανασυμβεί."
      ),
    },
  ],
};

const SCENARIO = {
  kind: "scenario",
  title: L("Play it out", "Spiel es durch", "Παίξ' το ως το τέλος"),
  setup: L(
    "It happens again a week later — a colleague, Sam, leaves a mess and Mara assumes it was you. You decide to address it.",
    "Eine Woche später passiert es wieder – ein Kollege, Sam, hinterlässt Chaos, und Mara nimmt an, dass du es warst. Du beschließt, es anzusprechen.",
    "Συμβαίνει ξανά μια εβδομάδα αργότερα — ένας συνάδελφος, ο Σαμ, αφήνει ακαταστασία και η Μάρα υποθέτει ότι ήσουν εσύ. Αποφασίζεις να το θίξεις."
  ),
  question: L(
    "What's your first move?",
    "Was ist dein erster Schritt?",
    "Ποια είναι η πρώτη σου κίνηση;"
  ),
  followupQuestion: L(
    "Mara is a bit defensive. What now?",
    "Mara ist etwas abwehrend. Was jetzt?",
    "Η Μάρα είναι λίγο αμυντική. Τι κάνεις τώρα;"
  ),
  choices: [
    {
      id: "private",
      quality: "best",
      text: L(
        "Wait for a quiet moment, then talk to Mara privately",
        "Auf einen ruhigen Moment warten und dann unter vier Augen mit Mara reden",
        "Περίμενε μια ήσυχη στιγμή και μετά μίλα στη Μάρα ιδιαιτέρως"
      ),
      outcome: L(
        "Mara actually relaxes when it's not in front of anyone. She's willing to listen.",
        "Mara entspannt sich tatsächlich, wenn niemand dabei ist. Sie ist bereit zuzuhören.",
        "Η Μάρα όντως χαλαρώνει όταν δεν είναι μπροστά σε άλλους. Είναι διατεθειμένη να ακούσει."
      ),
      followups: [
        {
          id: "askstop",
          quality: "best",
          text: L(
            "Calmly explain what happened and ask to be checked with first",
            "Ruhig erklären, was passiert ist, und darum bitten, künftig zuerst gefragt zu werden",
            "Εξήγησε ήρεμα τι έγινε και ζήτησε να σε ρωτάει πρώτα"
          ),
          outcome: L(
            "Mara agrees to ask before assuming next time. Problem named, relationship intact.",
            "Mara willigt ein, das nächste Mal nachzufragen, bevor sie etwas annimmt. Problem benannt, Beziehung intakt.",
            "Η Μάρα συμφωνεί να ρωτάει πριν υποθέσει την επόμενη φορά. Το πρόβλημα ειπώθηκε, η σχέση παραμένει."
          ),
        },
        {
          id: "accept",
          quality: "okay",
          text: L(
            "Accept the blame to avoid the awkwardness",
            "Die Schuld auf dich nehmen, um die unangenehme Situation zu vermeiden",
            "Δέξου την ευθύνη για να αποφύγεις την αμηχανία"
          ),
          outcome: L(
            "The tension eases now, but nothing changes — so it may well happen again.",
            "Die Anspannung lässt jetzt nach, aber es ändert sich nichts – es kann also wieder passieren.",
            "Η ένταση εκτονώνεται τώρα, αλλά τίποτα δεν αλλάζει — οπότε μπορεί κάλλιστα να ξανασυμβεί."
          ),
        },
      ],
    },
    {
      id: "public",
      quality: "poor",
      text: L(
        "Correct Mara right there on the floor",
        "Mara direkt dort im Laden korrigieren",
        "Διόρθωσε τη Μάρα εκεί, μπροστά σε όλους"
      ),
      outcome: L(
        "Mara feels shown up in front of the team and digs in.",
        "Mara fühlt sich vor dem Team bloßgestellt und blockt ab.",
        "Η Μάρα νιώθει εκτεθειμένη μπροστά στην ομάδα και επιμένει στη θέση της."
      ),
      followups: [
        {
          id: "escalate",
          quality: "poor",
          text: L("Push back harder", "Noch stärker dagegenhalten", "Πίεσε ακόμη πιο πολύ"),
          outcome: L(
            "It becomes an argument. Neither of you is really listening now.",
            "Es wird zum Streit. Keiner von euch hört jetzt wirklich zu.",
            "Γίνεται καβγάς. Κανείς σας δεν ακούει πια πραγματικά."
          ),
        },
        {
          id: "retreat",
          quality: "okay",
          text: L(
            "Step back and ask for a quiet word instead",
            "Einen Schritt zurücktreten und stattdessen um ein ruhiges Gespräch bitten",
            "Κάνε πίσω και ζήτησε καλύτερα να το πείτε ιδιαιτέρως"
          ),
          outcome: L(
            "You recover the situation — better late than never.",
            "Du rettest die Situation – besser spät als nie.",
            "Σώζεις την κατάσταση — κάλλιο αργά παρά ποτέ."
          ),
        },
      ],
    },
  ],
};

const ASSESSMENT = {
  kind: "assessment",
  title: L("Quick check", "Kurzer Check", "Γρήγορος έλεγχος"),
  intro: L(
    "Two quick questions to lock it in.",
    "Zwei kurze Fragen, um es zu festigen.",
    "Δύο γρήγορες ερωτήσεις για να το εμπεδώσεις."
  ),
  questions: [
    {
      id: "q1",
      correctOptionId: "b",
      question: L(
        "What makes an I-statement land better than blaming?",
        "Warum kommt eine Ich-Botschaft besser an als ein Vorwurf?",
        "Τι κάνει ένα μήνυμα σε α' πρόσωπο να «περνάει» καλύτερα από την κατηγορία;"
      ),
      options: [
        {
          id: "a",
          text: L(
            "It hides how you actually feel",
            "Sie verbirgt, wie du dich wirklich fühlst",
            "Κρύβει το πώς πραγματικά νιώθεις"
          ),
        },
        {
          id: "b",
          text: L(
            "It names the impact on you and asks for a change, without attacking",
            "Sie benennt die Wirkung auf dich und bittet um eine Änderung, ohne anzugreifen",
            "Ονομάζει την επίδραση σε σένα και ζητά αλλαγή, χωρίς επίθεση"
          ),
        },
        {
          id: "c",
          text: L(
            "It makes sure the other person feels guilty",
            "Sie sorgt dafür, dass sich die andere Person schuldig fühlt",
            "Φροντίζει ο άλλος να νιώσει ενοχή"
          ),
        },
      ],
    },
    {
      id: "q2",
      correctOptionId: "b",
      question: L(
        "When is the best time to raise it?",
        "Wann ist der beste Zeitpunkt, es anzusprechen?",
        "Πότε είναι η καλύτερη στιγμή να το θίξεις;"
      ),
      options: [
        {
          id: "a",
          text: L(
            "Immediately, in front of everyone",
            "Sofort, vor allen anderen",
            "Αμέσως, μπροστά σε όλους"
          ),
        },
        {
          id: "b",
          text: L(
            "In a quiet moment, one to one",
            "In einem ruhigen Moment, unter vier Augen",
            "Σε μια ήσυχη στιγμή, ιδιαιτέρως"
          ),
        },
        {
          id: "c",
          text: L(
            "Never — just let it go",
            "Nie – lass es einfach auf sich beruhen",
            "Ποτέ — απλώς άσ' το να περάσει"
          ),
        },
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

  await upsertLesson("context", { narrative: NARRATIVE.context });
  await upsertLesson("concept", { narrative: NARRATIVE.concept });
  await upsertLesson("behaviour", { narrative: NARRATIVE.behaviour });
  await upsertLesson("simulation", { structure: SIMULATION });
  await upsertLesson("scenario", { structure: SCENARIO });
  await upsertLesson("assessment", { structure: ASSESSMENT });

  console.log(`[seed-demo] demo course '${SLUG}' seeded/refreshed (EN + DE + EL, published)`);
}

main()
  .catch((e) => {
    console.error("[seed-demo] non-fatal error:", e?.message ?? e);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });

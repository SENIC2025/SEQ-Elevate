# SEQ Elevate Platform — Build Log

A chronological log of every meaningful step and decision in building the SEQ Elevate platform. Purpose: full transparency, and the ability to retrace how any part was built so future work (new courses, new projects, new features) can follow the same patterns.

**How to read this**: newest entries at the bottom of each phase. Each entry is dated and tagged. Decisions that change direction are also cross-referenced in `DECISIONS.md`. Component-level documentation lives in `STORYBOOK.md` and the in-app gallery.

Legend: `[BUILD]` code/feature · `[DECISION]` a choice made · `[INFRA]` infrastructure/tooling · `[DOC]` documentation · `[FIX]` correction · `[BLOCK]` waiting on external input

---

## Phase 0 — Demo (pre-contract)

Goal: build a working, clickable demonstration of the platform shell to win the SEQ Elevate contract. Built before the deal was signed, deployed publicly, and cited in the signed Technical Proposal as the reason the 5-week / €10,500 build price is realistic.

- `[BUILD]` Scaffolded Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn-style components.
- `[BUILD]` Landing page + 4-role picker (Learner, Facilitator, Admin, Content Editor).
- `[BUILD]` Learner dashboard: visual skill map (7 clusters), mission feed, progress ladder, badge tray.
- `[BUILD]` Course player enforcing the WP3 7-stage pedagogical sequence (Context → Concept → Behaviour → Simulation → Scenario → Reflection → Micro-Assessment) as a visible state machine.
- `[BUILD]` Branching scenario engine (workplace-conflict course): root choice → follow-up → quality-tagged outcomes.
- `[BUILD]` Choose-response simulation pattern (1 of 4 templates the shell will ship).
- `[BUILD]` Reflection + 3-question micro-assessment with feedback.
- `[BUILD]` SEQ Comp Card form (WP3 fields, privacy controls) + printable PDF view.
- `[BUILD]` Gamification: badge unlock animation (framer-motion), progress bars, mission feed — explicitly no leaderboards (per WP3 §10).
- `[BUILD]` Facilitator workspace: cohort view, learner Comp Card with privacy redactions, observation + validation.
- `[BUILD]` Admin dashboard: users, cohorts, GDPR self-service, audit log.
- `[BUILD]` Content Editor: CMS structure view, content models, locale tree, editorial workflow.
- `[BUILD]` Live CMS preview: split-screen scenario editor with live learner-side phone preview.
- `[DECISION]` Full i18n EN/DE/EL with the entire workplace-conflict course translated (not just UI chrome). Strongest pitch to Pro Arbeit (DE) and Synthesis/UoM (EL). → `DECISIONS.md D5`
- `[BUILD]` Accessibility toolbar: font size, dyslexia-friendly font, high contrast. WCAG 2.2 AA foundation: keyboard nav, focus rings, ARIA, semantic HTML.
- `[BUILD]` Multi-tenant `Project` entity + brand-kit plumbing (`ProjectThemeProvider`) so future projects (Selevate, etc.) are configuration, not a rewrite. → `DECISIONS.md D6`
- `[DECISION]` Replicated the seqelevate.eu brand palette (lime `#cad12c` primary, purple `#7467ae` accent, rose `#b575ae` tertiary, logo gradients). Lime used as a surface colour with dark text (WCAG AAA); purple for foreground/icon tints where lime would fail contrast. → `DECISIONS.md D4`
- `[DOC]` README.md + HANDOVER.md written for the consortium.
- `[INFRA]` Deployed to Vercel at https://seq-elevate-demo.vercel.app/en — cited in the signed Technical Proposal §2.
- `[DECISION]` Attribution standardised to "Created and Powered by SENIC · senic.world". All "Claude Code" / build-tool references removed from user-facing surfaces.

**Outcome**: contract won. DIESIS-SEQ ELEVATE-SERVICE-M1-2026-01. €16,000 (€10,500 dev + €5,500 hosting/maintenance 5y). 5-week delivery. Kickoff 25–26 June 2026.

---

## Phase 1 — Week 0 (pre-kickoff productionisation)

Goal: use the ~2-week gap between contract signature and the 25–26 June kickoff to stage all infrastructure-only work (DB, auth, CMS, deploy, observability) so the kickoff opens with a live staging URL the consortium can click. De-risks the contractual 5 weeks into pure polish + feedback + audit + handover.

### Day 1 — Decisions log + repo direction (2026-06-13)
- `[DOC]` Created `DECISIONS.md`: 8 decisions locked, 4 critical open items tagged to close at kickoff, secondary open items logged.
- `[DECISION]` Hosting: Hetzner Cloud for the platform; existing Hostinger Business Web Hosting (paid to Feb 2028) repurposed for marketing/email/domains. Reason: Hostinger shared hosting can't run Postgres/Docker/long-running Node. → `DECISIONS.md D1`
- `[DECISION]` Repo: new repo in SENIC GitHub org during build, transferred to consortium at handover. → `DECISIONS.md D2`
- `[DECISION]` Staging URL: `staging.seq-elevate.senic.world` (SENIC-controlled) so the consortium can click from kickoff. Production domain deferred. → `DECISIONS.md D3, O1`

### Day 2 — Postgres + Prisma schema (2026-06-13)
- `[INFRA]` `docker-compose.yml` — Postgres 16 (alpine) on localhost:5432 for local dev; mirrors production major version. Strapi service stubbed (commented) to declare network topology early.
- `[DECISION]` Local dev DB in Docker so Prisma schema + migrations behave identically locally and in production. → `DECISIONS.md D8`
- `[INFRA]` Installed Prisma 7, @prisma/client, @auth/prisma-adapter, next-auth@beta (v5), resend, @prisma/adapter-pg, pg, tsx.
- `[FIX]` Prisma 7 dropped the `url` property in `datasource` blocks — moved to `prisma.config.ts` with `datasource.url` from env. Required the `@prisma/adapter-pg` driver adapter.
- `[BUILD]` `prisma/schema.prisma` — 20 tables. Multi-tenant root (`Project`); identity + RBAC (`User`, `Account`, `Session`, `VerificationToken`, `Membership`); org structure (`Organisation`, `Cohort`); course (`Course`, `CourseEnrollment`); Comp Cards (`CompCard`, `CompCardEntry`); gamification (`Badge`, `UserBadge`, `Mission`, `MissionProgress`); facilitator (`Observation`, `Validation`); audit (`AuditLog`).
- `[DECISION]` Every non-auth entity carries `projectId` — multi-tenancy enforced at the schema level. Learner state is project-scoped (a learner in two projects has two Memberships, two Comp Cards). Course narrative copy lives in Strapi; the DB holds structural refs (`Course.strapiId`) + platform state (progress, attempts, evidence).
- `[BUILD]` `src/lib/prisma.ts` — Prisma client singleton (global-cache pattern for dev hot-reload), Postgres driver adapter.
- `[BUILD]` `prisma/seed.ts` — idempotent seed: SEQ Elevate project, 4 partner orgs (Diesis, Pro Arbeit, Synthesis, UoM), Berlin pilot cohort, workplace-conflict course + "Voice without edges" badge. Reads from `src/data/project.ts` and `src/data/course.ts` so the demo's content model is the single source of truth.
- `[INFRA]` First migration `20260613044109_init` applied. DB seeded. 20 tables live. Type check passes.
- `[INFRA]` Added `db:up / db:down / db:migrate / db:reset / db:seed / db:studio` scripts to package.json.

### Transparency artifacts (2026-06-13)
- `[DOC]` Created `BUILDLOG.md` (this file) — chronological step/decision log.
- `[DOC]` Created `STORYBOOK.md` — narrative design-system + component reference.
- `[DECISION]` Storybook = in-app live gallery, NOT the Storybook npm tool. Reason: Next 16 + React 19 + Tailwind v4 is bleeding-edge; the standalone tool fights these versions and adds a fragile parallel build pipeline. An in-app gallery renders the real components in the real theme/i18n/a11y context and upgrades for free with the app.
- `[BUILD]` `src/components/dev/StorybookGallery.tsx` + route `/[locale]/dev/storybook` — live gallery: colour tokens, gradients, typography, Button (all variants/sizes), Badge, Progress, Card, Textarea, StageBreadcrumb (interactive), badge-unlock. Switchable across EN/DE/EL + a11y modes. Unlinked from user flows.

### Day 3 — NextAuth.js v5 + magic link (2026-06-13)
- `[BUILD]` `src/auth.ts` — Auth.js v5: PrismaAdapter, database sessions, Resend email provider (passwordless magic link). Branded HTML email template (lime/purple).
- `[DECISION]` Dev-without-key fallback: when no real `RESEND_API_KEY` is set, the magic link is logged to the server console instead of emailed. Makes auth fully testable locally and on staging before the Resend key is provisioned. Production sends via Resend automatically once the key is present.
- `[FIX]` Auth.js v5 threw `UntrustedHost` on non-Vercel hosts → added `trustHost: true` (required for self-hosted Hetzner). `AUTH_URL` will pin the host in production.
- `[BUILD]` Route handler `app/api/auth/[...nextauth]/route.ts`; session type augmentation `src/types/next-auth.d.ts` (adds `user.id`).
- `[BUILD]` `src/lib/auth-helpers.ts` — `getCurrentUser`, `requireUser`, `getMemberships`, `getProjectMemberships`, `hasRole`, `requireRole`. RBAC is always project-scoped ("admin *of this project*", never global).
- `[DECISION]` Auth gating lives in server components via these helpers, NOT in middleware. Keeps `proxy.ts` as next-intl-only and avoids the Auth.js edge-runtime + Prisma-adapter composition pain.
- `[BUILD]` `src/app/actions/auth.ts` — `signInWithEmail`, `signOutAction` server actions.
- `[BUILD]` Sign-in page (`/[locale]/signin`) + `SignInForm` (client, pending state) + check-email page. Auth i18n strings added to EN/DE/EL.
- `[VERIFY]` Full flow tested against the production build: providers endpoint ✓, CSRF ✓, sign-in POST 302 ✓, magic link generated + `VerificationToken` persisted ✓, link click → callback 302 + `User` created + `Session` created ✓. Auth works end-to-end with console magic links; real email only needs the Resend key.
- `[BLOCK]` Real `RESEND_API_KEY` + verified `senic.world` sender domain needed for actual email delivery (not blocking — console links work for testing). → `DECISIONS.md D7`

### Day 4 — CMS: hybrid Strapi + swappable content client (2026-06-13)
- `[DECISION]` CMS = **hybrid**: Strapi for authoring (hits the deadline, gives out-of-box no-code authoring per the signed proposal) but all content access behind a typed, source-agnostic client so we're never locked in and can migrate to native-Postgres authoring later with zero app-code changes. → `DECISIONS.md D9`
- `[BUILD]` `src/lib/cms/types.ts` — source-agnostic content contract: `CourseContent`, `CourseStage`, `ScenarioChoice`, `SimulationOption`, `AssessmentQuestion`, `NarrativeBlock`, `CompCardTemplate`. The app reads these regardless of backend.
- `[BUILD]` `src/lib/cms/provider.ts` — `CMSProvider` interface + `getCMSSource()` (reads `CMS_SOURCE` env).
- `[BUILD]` `src/lib/cms/local-provider.ts` — builds `CourseContent` from the bundled i18n messages + `data/course.ts`. The default source; zero external deps. Also the reference shape the Strapi provider must reproduce.
- `[BUILD]` `src/lib/cms/strapi-provider.ts` — fetches Course + Comp Card Template from the Strapi REST API, maps to `CourseContent`. Handles Strapi 5 flattened response shape, 60s ISR cache.
- `[BUILD]` `src/lib/cms/index.ts` — public client (`listCourses`, `getCourse`, `getCompCardTemplate`) delegating to the selected provider.
- `[INFRA]` Scaffolded Strapi 5.48 (TypeScript) in `cms/`. SQLite local, Postgres prod (env-driven config, no code change). Isolated from the web build (`tsconfig.json` excludes `cms`). Separate `strapi` Postgres database created.
- `[BUILD]` Strapi content models: `Course` (collection, i18n EN/DE/EL — native metadata fields + localized `content` JSON for the stage tree) and `Comp Card Template` (single type, i18n). Factory controllers/routes/services.
- `[BUILD]` `cms/src/index.ts` bootstrap — ensures DE + EL locales and public read permissions on boot.
- `[BUILD]` Dev verification page `/[locale]/dev/cms-check` — calls the real CMS client server-side and renders resolved content.
- `[VERIFY]` Production build ✓. `/en/dev/cms-check` resolves full `CourseContent`: 7 stages in order, 4 simulation options, 4 scenario root choices, 3 assessment questions, badge. `/el/dev/cms-check` renders native Greek ("Διαχείριση μιας μικρής διαφωνίας στη δουλειά", badge "Φωνή χωρίς αιχμές"). Local provider produces valid localized content end-to-end.
- `[DOC]` `cms/README.md` — content models, run instructions, backend switching, production env, worked-example seeding.
- `[PENDING]` Live Strapi boot + content-type load + REST read verification deferred to Day 5 (Strapi deploys to staging there anyway). Schemas follow the exact Strapi factory pattern; risk low.
- `[NOTE]` The course player still reads via i18n messages directly (staging stays functional). Refactoring the player to consume `CourseContent` generically — the "shell renders any authored course" capability — is a Week 1 task, now unblocked by the content client.

### Day 5 — Deployment config + CI + observability (2026-06-13)
- `[INFRA]` `next.config.ts` → `output: "standalone"` for small Docker images. Verified: `.next/standalone/server.js` builds (46 MB).
- `[INFRA]` `Dockerfile` (web) — multi-stage (deps → builder → runner), non-root user, Prisma client generated in build, standalone server in final image. `.dockerignore` excludes cms/secrets/docs.
- `[INFRA]` `cms/Dockerfile` (Strapi) — build + runner, vips for image processing.
- `[INFRA]` `deploy/docker-compose.prod.yml` — full stack: postgres + web + cms, health checks, named volumes (pgdata, strapi-uploads), all secrets via env. Migrations explicitly NOT auto-run by containers (deploy-step instead, avoids replica races).
- `[INFRA]` `.github/workflows/ci.yml` — quality gate on PR/push: install → prisma generate → lint → tsc → build. Auditable, consortium-takeover-ready (proposal §4).
- `[BUILD]` `src/components/Analytics.tsx` — Plausible (cookieless, no PII, no cookie banner). Renders only when `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` set. Wired into the locale layout.
- `[DECISION]` Server sizing: Hetzner CX22 (2 vCPU / 4 GB) for web + Strapi + Postgres at pilot scale. ~€6/mo. Comfortably within the €5,500 / 60-month hosting lump.
- `[DOC]` `deploy/README.md` — full provisioning runbook: credentials checklist, Hetzner provision, DNS, Coolify (reverse proxy + Let's Encrypt + push-deploys), env reference, migration step, post-deploy setup, smoke-test/acceptance dry-run, 5-year backup obligation.
- `[FIX]` Metadata title updated from "Platform Shell Demo" → "SEQ Elevate" (production framing).
- `[BLOCK]` Actual provisioning needs: Hetzner API token, `senic.world` DNS access, Resend key + verified sender, Sentry DSN, Plausible, Better Uptime account. Config is turn-key; deploy executes the moment these exist. → see report to client.
- `[PENDING]` Sentry SDK install (`@sentry/nextjs`) deferred to first staging deploy — wired via `SENTRY_DSN` env; the init files get added during the deploy pass (avoids the interactive wizard now).

### Day 6–8 — Kickoff prep (2026-06-13)
- `[DOC]` `KICKOFF.md` — consortium-facing brief for the 25–26 June meeting: where we are (live staging foundations), the 4 WP3 decisions with SENIC recommendations + rationale, scope boundary (RACI), the 5-week plan with weekly demos, what SENIC needs from the consortium, acceptance criteria, parked questions.
- `[DOC]` Updated main `README.md` to reflect the production architecture (was the demo README).
- `[NOTE]` Kickoff opens with a live walkthrough (everyone signs in on their phone), not slides — the pre-kickoff Week 0 infrastructure work makes this possible.

### Interim Vercel staging (2026-06-13)
- `[DECISION]` Deploy staging on Vercel now; delay Hetzner until contract/payment confirmed (client direction). The swappable CMS makes this free: `CMS_SOURCE=local` on Vercel, `strapi` on Hetzner later. → `DECISIONS.md D10`
- `[INFRA]` `package.json` → `postinstall: prisma generate` (Vercel generates the Prisma client on install). Verified `prisma generate` works with no `DATABASE_URL`.
- `[INFRA]` `.vercelignore` excludes `/cms`, `/deploy`, Docker files, internal docs from the upload.
- `[FIX]` **Critical bug**: first two deploys failed with "Can't resolve `@/lib/cms/*`". Root cause: `.vercelignore` line `cms` is an **unanchored** pattern that matched `src/lib/cms/` too, excluding the entire content client from the upload. Fixed by anchoring all entries with a leading slash (`/cms`). Lesson logged: `.vercelignore`/`.gitignore` patterns without a leading slash match at every directory level.
- `[FIX]` Removed the `src/lib/cms/check.ts` indirection (collateral of the above); inlined the CMS-source label into the cms-check page.
- `[INFRA]` Vercel env set (production): `AUTH_SECRET`, `CMS_SOURCE=local`, `AUTH_TRUST_HOST=true`, placeholder `DATABASE_URL` (real one with Neon later).
- `[VERIFY]` **Live at `https://seq-elevate-demo.vercel.app`**. Smoke test: 10 routes 200 (landing, 4 roles, content preview, storybook, cms-check, DE/EL learner, signin). CMS content resolves live — Greek course title + EN 7-stage sequence render server-side.
- `[INFRA]` Custom domain `staging.seq-elevate.senic.world` added to the Vercel project. Pending DNS: `A staging.seq-elevate → 76.76.21.21` in the Hostinger panel (senic.world NS = dns-parking.com). Vercel auto-verifies + SSL on propagation.
- `[BLOCK]` For auth + DB-backed features on Vercel: hosted Postgres (Neon free EU tier recommended) + Resend key. Demo flows need neither.

---

## Phase 2 — Week 1 (contracted build)

### Generic course player — the "shell renders any authored course" capability (2026-06-13)
The core acceptance criterion: the platform must render courses that don't exist in code. Refactored the player + all stage components to consume a `CourseContent` object from the CMS client instead of hardcoded i18n keys.
- `[BUILD]` Course route `/[locale]/learner/course/[courseId]` is now a server component: calls `getCourse(projectId, courseId, locale)`, passes `CourseContent` to the player, `notFound()` on unknown slug.
- `[BUILD]` `CoursePlayer` consumes `course: CourseContent`. Walks `course.stages` in the enforced WP3 order (`STAGES` filter); state machine, breadcrumb, progress all derive from the stage list. No per-course code.
- `[BUILD]` All 6 stage components rewritten to take their `CourseStage` data as props (content) + i18n only for UI chrome:
  - `NarrativeStage` renders generic content blocks (paragraph / list / callout / compare)
  - `SimulationStage` renders authored options; "best" flagged in content (`isBest`)
  - `ScenarioStage` renders the authored branch tree (root → outcome → followups), quality-tagged
  - `ReflectionStage` renders authored prompts
  - `AssessmentStage` renders authored questions, answers keyed by question id (any count)
  - `CompletionStage` celebrates with the course's own authored badge
- `[BUILD]` New `coursePlayer` i18n namespace (EN/DE/EL) for course-agnostic chrome (step counter, quality labels, score, encouragement, badge-unlocked, etc.). Content strings come from `CourseContent`; only chrome is i18n.
- `[BUILD]` Learner dashboard is now CMS-driven: server page calls `listCourses()`, dashboard renders the hero + a "Your courses" list + skill-map highlights from the data. Badges display from the course list's badge info.
- `[BUILD]` `CourseSummary` extended with `badgeSlug/badgeName/badgeMeaning/comingSoon`. Local provider's `listCourses` now returns the published course **plus a "Receiving feedback" coming-soon course** — proves the list is dynamic (the consortium authors courses 2–6). Strapi provider kept in sync.
- `[VERIFY]` Build ✓, type-check ✓. Course route renders EN ("Handling a small workplace conflict" → Context → narrative) and full native Greek ("Τρεις εβδομάδες στη νέα δουλειά", chrome "1 / 7 · Πλαίσιο", "Συνέχεια"). Dashboard shows "Your courses" + the coming-soon course. Unknown slug → 404. Valid slug → 200.
- `[NOTE]` Progress persistence is still single-course (localStorage demo-state). Multi-course progress keyed by slug + DB-backed state is a follow-up (needs the hosted Postgres). The RENDERING is fully generic now — the acceptance-criterion capability is met.

### CI green + GitHub + Vercel auto-deploy (2026-06-13)
- `[INFRA]` Connected local repo to `github.com/SENIC2025/SEQ-Elevate`. Non-destructive: merged the repo's original "Initial commit" (placeholder README) into our history rather than force-pushing. 130 files, no secrets/node_modules.
- `[FIX]` CI lint was red. Causes + fixes: (1) ESLint was scanning the Strapi `cms/` dir → added `cms/**` to eslint `globalIgnores`. (2) New React 19 rule `react-hooks/set-state-in-effect` flagged 4 legitimate localStorage-hydration-on-mount effects (the correct SSR pattern — localStorage is unavailable during SSR) → scoped `eslint-disable` with justifying comments in ProjectThemeProvider, AccessibilityProvider, demo-state, CoursePlayer. (3) Removed unused imports/vars (`COURSE_META`, `locale`) and a stale `no-var` disable. Result: 0 errors, 0 warnings.
- `[VERIFY]` CI run green: Lint ✓ Type check ✓ Build ✓ (52s).
- `[INFRA]` `vercel git connect` → pushes to `main` now auto-deploy to staging. Verified an auto-deploy fired on push.

### Generic pass — Comp Card + Facilitator decoupled from hardcoded course (2026-06-13)
- `[BUILD]` Comp Card and Facilitator views no longer read the `course.workplaceConflict` i18n namespace. The learner's scenario evidence (choice labels) and the course title are now stored in demo-state *when the learner plays*, so these views render any course's evidence.
- `[BUILD]` `demo-state`: `ScenarioAttempt` gains `rootLabel`/`followupLabel`; `CourseProgress` gains `courseSlug`/`courseTitle`; new `setCourseContext` action (resets per-course progress when a different course opens). `recordScenarioRoot/Followup` now carry the label text.
- `[BUILD]` `CoursePlayer` dispatches `setCourseContext` on mount; `ScenarioStage` passes choice text when recording.
- `[VERIFY]` Build ✓ type-check ✓ lint clean (0/0). Comp Card + facilitator pages render (EN + EL). The entire learner→evidence→facilitator chain is now course-agnostic.

### Second course — "Receiving feedback" (Resilience), full trilingual (2026-06-13)
The proof the shell is content-driven: a genuinely different course (different cluster, scenario tree, behaviour model) flowing through the identical engine, in all three languages, with zero new component code.
- `[BUILD]` Generalised `data/course.ts`: `CourseDef` type + `COURSE_DEFS` registry (structure: sim options, scenario root/followup tree with quality tags, assessment) + `COURSE_ORDER`. `contentKey` maps hyphenated slug → camelCase messages namespace. Workplace-conflict structure preserved identically.
- `[BUILD]` Generalised local provider: `buildCourse(def, locale)` builds any course's `CourseContent` from its `CourseDef` + `course.<contentKey>.*` messages. Falls back to EN if a course isn't translated for the locale yet (mirrors the real CMS handling an untranslated course).
- `[BUILD]` Authored "Receiving feedback without flinching" (Resilience, badge "feedback-as-fuel") — full 7-stage course (context → … → assessment), 4 sim options, 4×3 scenario tree, 3 assessment Qs — in **EN, DE, and EL** (native translations, not machine).
- `[BUILD]` DB seed iterates `COURSE_DEFS` — seeds both courses + both badges. Verified: `workplace-conflict` + `receiving-feedback`, `voice-without-edges` + `feedback-as-fuel` in the DB.
- `[VERIFY]` Both courses render 200 in all 3 locales; native content confirmed (EN "The flyer you stayed late for", DE "Der Flyer, für den du länger geblieben bist", EL "Το φυλλάδιο που έμεινες αργά να φτιάξεις"). Dashboard lists both. Build ✓ lint ✓ types ✓.
- `[NOTE]` This validates the whole generic architecture: adding a course = a `CourseDef` + localized text, no engineering. Exactly what the consortium does in Strapi for courses 2–6.

---

## Phase 3 — Autonomous hardening (client OOO)

### Production hardening + SEO + PWA (2026-06-13)
- `[BUILD]` Error/loading/not-found boundaries: `[locale]/loading.tsx` (branded spinner), `[locale]/not-found.tsx` (localized 404, EN/DE/EL), `[locale]/error.tsx` (localized error boundary, Sentry-ready hook), `global-error.tsx` (root fallback), `app/not-found.tsx` (root unmatched-path 404). New `system` i18n namespace (EN/DE/EL).
- `[BUILD]` Branded favicon `app/icon.svg` (lime tile + sparkle, auto-detected by Next).
- `[BUILD]` PWA `app/manifest.ts` — installable, standalone display, theme color, start_url `/en`. (Maskable PNG icons pending consortium brand logo.)
- `[BUILD]` SEO: `app/robots.ts` (disallow all on staging — placeholder content + vulnerable target group; flip at production go-live), root metadata with `metadataBase`, title template, Open Graph, Apple web-app meta; `viewport` export with theme color. Course route has dynamic `generateMetadata` (course title).
- `[VERIFY]` Build ✓ lint ✓ types ✓. 404 → branded localized page (course notFound() shows DE/EL text); manifest.webmanifest, robots.txt, icon.svg all 200.

### Accessibility pass — WCAG 2.2 AA (2026-06-13)
- `[BUILD]` Skip-to-content link (`.skip-link`, hidden until focused) in the locale layout → `#main-content`; added `id="main-content"` + `tabIndex={-1}` to all role-layout `<main>` landmarks + the landing main. (WCAG 2.4.1 Bypass Blocks)
- `[BUILD]` Focus management in the course player: focus moves to the new stage region on stage change (skips initial mount), so screen-reader users hear new content. (WCAG 2.4.3)
- `[BUILD]` `prefers-reduced-motion`: global CSS kills non-essential animation/transition; the framer-motion badge unlock wrapped in `<MotionConfig reducedMotion="user">`. (WCAG 2.3.3)
- `[BUILD]` `role="status" aria-live="polite"` on in-stage feedback regions (simulation feedback, scenario outcome, assessment score) so results are announced. New `system.skipToContent` i18n (EN/DE/EL).
- `[NOTE]` Builds on the existing foundation: visible focus rings, semantic HTML, `lang` per locale, dyslexia/contrast/font-size toolbar, lime-as-surface contrast model.

### Testing — Vitest unit suite + CI gate (2026-06-13)
- `[INFRA]` Vitest + vite-tsconfig-paths; `vitest.config.ts`; `test` / `test:watch` / `test:e2e` scripts.
- `[BUILD]` `src/lib/cms/local-provider.test.ts` — the content engine: lists all courses per locale; null for unknown; builds complete valid CourseContent for every course × locale (7 stages, one best sim option, scenario tree text/outcomes/quality, assessment correct-id validity, badge); content is localized (titles differ EN/DE/EL); Comp Card template has the WP3 fields.
- `[BUILD]` `src/data/course.test.ts` — course-def integrity: order references defined courses, cluster valid, sim correct ∈ options, scenario ids unique, quality tags valid, assessment correct ∈ options, badge slugs unique.
- `[VERIFY]` 10 tests pass. Added `Unit tests` step to CI (lint → type → **test** → build).

### Testing — Playwright E2E + axe accessibility, CI job (2026-06-13)
- `[INFRA]` `@playwright/test` + `@axe-core/playwright`; `playwright.config.ts` (chromium, prod-server webServer); chromium installed.
- `[BUILD]` `e2e/learner-journey.spec.ts` — dashboard lists both courses; player advances stages; unknown course shows the not-found page; German + Greek content render natively.
- `[BUILD]` `e2e/accessibility.spec.ts` — axe-core WCAG 2.2 AA scan (wcag2a/aa, wcag21, wcag22aa) on landing, dashboard, course player, Comp Card; asserts zero serious/critical violations.
- `[FIX]` **Axe caught a real WCAG AA failure**: purple accent `#7467ae` as 12px text on light tints = 4.21:1 (< 4.5:1). Root cause was the runtime `ProjectThemeProvider` override from the brand kit. Fixed by setting the brand kit `accentColor` to the brand's own secondary-dark `#5d528b` (axe-verified pass). → `DECISIONS.md D4`
- `[FIX]` Axe caught `aria-progressbar-name`: the course-player progress bar had no accessible name. `Progress` now always has an `aria-label` (label ?? ariaLabel ?? "Progress").
- `[NOTE]` `notFound()` for an unknown course renders the branded not-found page but Next 16 streams a 200 status header (framework nuance). The E2E asserts the rendered page (the meaningful UX check).
- `[VERIFY]` 8/8 E2E + axe tests pass in headless Chromium. Added a separate `e2e` CI job (build → install chromium → playwright test, uploads report on failure). Both CI jobs green in GitHub Actions.

### Lighthouse mobile audit — acceptance criterion #7 (2026-06-13)
- `[VERIFY]` Ran Lighthouse (mobile) on the learner dashboard against the production build:
  - **Performance 91** ✓ (no optimisation opportunities >100ms)
  - **Accessibility 100** ✓ (the WCAG pass + axe fixes paid off)
  - **Best Practices 100** ✓
  - **SEO 63** — the *only* deduction is `is-crawlable` "blocked from indexing", i.e. the **intentional staging `robots` disallow** (placeholder content + vulnerable target group). At production go-live (robots → allow) SEO rises to ~100.
- `[NOTE]` Acceptance criterion (Lighthouse mobile ≥90 across Performance/A11y/Best-Practices/SEO) is effectively met — the sole sub-90 category is held down only by the deliberate staging crawl-block, which is correct behaviour for staging and reverses at go-live.

### Live database + email — full auth stack real on staging (2026-06-13)
- `[INFRA]` **Neon Postgres** (eu-central-1 Frankfurt) connected as the staging DB. Migrated (20 tables, via direct endpoint — Prisma locks don't work through Neon's pooler) + seeded (project, 4 orgs, cohort, both courses + badges). `DATABASE_URL` (pooled) set in Vercel. Verified: live app reads + writes Neon. → `DECISIONS.md D11`
- `[INFRA]` **Resend email** wired. `senic.world` already verified on the account → can email any recipient. `RESEND_API_KEY` (sending-only restricted key) + `EMAIL_FROM` set in Vercel.
- `[VERIFY]` End-to-end on the **live** site: sign-in POST → 302 (no Resend error) → magic-link email sent from `no-reply@senic.world` + `VerificationToken` created in Neon. Test tokens cleaned afterwards (DB is a clean slate: 0 tokens, 0 users).
- `[NOTE]` The full auth stack — Neon DB + NextAuth magic-link + Resend email — is now real on staging. The consortium can sign in with a real email at kickoff. Secrets live only in Vercel's encrypted env + gitignored `.env.local`; verified absent from git history.
- `[NOTE]` The learner journey itself still uses localStorage (client demo-state). Migrating it to DB-backed per-course progress + real RBAC memberships is the next build step, now fully unblocked by the live DB + auth.

---

## Phase 4 — Multi-user: DB-backed learner state

### Authenticated learners persist to Postgres; guests keep localStorage (2026-06-13)
The last real "demo-ism" removed: authenticated learners' progress, Comp Card and badges now persist server-side and follow them across devices. Guests keep the instant-clickable localStorage demo. Same `useDemoState` API for both.
- `[BUILD]` `SessionProviderWrapper` (NextAuth `SessionProvider`) added to the locale layout so client components know auth state.
- `[BUILD]` `src/app/actions/learner.ts` — server actions: `ensureLearnerMembership` (auto-provisions a LEARNER membership on first use), `loadLearnerGlobal` (Comp Card + badges + enrollment summaries), `loadCourseProgress` (a course's saved progress, with scenario labels + title re-resolved from the CMS), `saveCourseProgress` (CourseEnrollment upsert), `saveCompCard`, `awardBadgeAction`. Stage-key ↔ enum + privacy ↔ enum mapping.
- `[BUILD]` `DemoStateProvider` rewritten as a hybrid store: on mount, authed users hydrate from the DB (source of truth on login) + ensure membership; guests hydrate from localStorage. Write-through to the DB (debounced 700ms) for course progress + Comp Card; append-only for badges. Race guards (`courseLoadingRef`, `loadedCourseRef`, `dbReady`, per-badge `persistedBadges`) prevent the reset-then-load flow from clobbering saved data.
- `[BUILD]` Auth UX: header shows the signed-in user's email + real Sign out (NextAuth `signOut`) for authed users, demo role-chip for guests; landing gains a real "Sign in" CTA alongside the guest role picker; sign-in callback → `/learner`.
- `[BUILD]` `e2e/db-backed-progress.spec.ts` — signs a user in via a Session row, walks a full course in Chromium, asserts the DB has: CourseEnrollment (completed, `scenarioRoot=private`, stages recorded), auto-provisioned LEARNER Membership, and the `voice-without-edges` UserBadge. Gated on `E2E_DB=1`.
- `[INFRA]` CI `e2e` job gains a **Postgres 16 service** + migrate + seed + `E2E_DB=1`, so the DB-backed test is a real CI gate.
- `[VERIFY]` Local: DB-backed test passes (full course walk → all DB rows correct); 8 guest E2E + axe tests still pass (guest flows intact); DB test skips without `E2E_DB`. Build ✓ lint ✓ types ✓ 10 unit ✓.
- `[NOTE]` On login, guest localStorage progress is not migrated to the DB — DB wins (acceptable; could add migration later).

### Dashboard, admin + facilitator read real DB data (2026-06-13)
The staff/learner views now show real people and progress, not mock data.
- `[BUILD]` `src/lib/server-queries.ts` — server-component read queries: `getLearnerEnrollments` (current user's per-course progress), `getAdminCounts` (real aggregate counts), `getViewerRoles`, `getProjectLearners` (RBAC-gated list of real learners with progress + Comp Card + scenario evidence resolved from the CMS).
- `[BUILD]` Learner dashboard: per-course status (completed / in-progress / open) now comes from real enrollments for authed users (demo-state for guests) — hero CTA + course-card badges reflect actual progress.
- `[BUILD]` Admin dashboard: Users / Cohorts / Organisations counts are real DB aggregates (server-fetched).
- `[BUILD]` Facilitator: `RealFacilitatorView` renders real learners for staff (FACILITATOR/ADMIN) — cohort list with real progress, per-learner Comp Card with **field-level privacy redaction** (SELF hides difficult+behaviour; FACILITATOR_AND_MENTOR reveals all), scenario evidence, observation + validation that persist (`src/app/actions/facilitator.ts`, RBAC-gated, write Observation/Validation + AuditLog). Guests/non-staff still see the demo mock.
- `[BUILD]` Seed: optional `SEED_STAFF_EMAIL` grants FACILITATOR + ADMIN so staff views can be tested with real data.
- `[BUILD]` E2E: a facilitator test signs in as staff and verifies a real learner appears in the cohort with their Comp Card (privacy-respecting). Added to the DB-backed spec (CI Postgres-gated).
- `[FIX]` Test flakiness: `SessionProvider` now disables background refetch (`refetchOnWindowFocus={false}`, `refetchInterval={0}`) — fewer requests + stabler hydration; the journey "Continue" click retries via `toPass` (guards the hydration race); DB spec runs serial; ambiguous `getByText` selectors use `.first()`. Result: 10/10 E2E stable across repeated runs.
- `[VERIFY]` Build ✓ lint ✓ types ✓ 10 unit ✓ 10 E2E ✓ (stable ×2).

### Polish: real per-course journey + guest→DB migration on sign-in (2026-06-14)
Two loose ends from the multi-user migration, closed.
- `[FIX]` Dashboard **"Your journey"** stage checklist read client demo-state, which is empty for an authenticated learner on the dashboard (no course player mounted) — so a learner who'd finished the hero course still saw 0/7 ticked. `getLearnerEnrollments` now returns the actual completed **stage keys** per course (not just a count); the journey checklist ticks the real stages for authed users (demo-state fallback for guests).
- `[BUILD]` **Guest→DB migration on first login.** A learner who builds progress as a guest (localStorage) and then signs in now keeps it. On first authenticated hydration the store reconciles localStorage into Postgres — **DB always wins on conflict**, we only fill gaps the server has no data for: badges are unioned (idempotent), the Comp Card migrates only if none exists server-side, and the last-played course migrates only if that course has no DB enrollment yet. localStorage is cleared first (so a StrictMode/second-tab re-run can't double-migrate), then `router.refresh()` reconciles the server-rendered views. Runs before `dbReady` so it never races the write-through effects.
- `[BUILD]` `e2e/db-backed-progress.spec.ts` — new test: walk the full course **as a guest** (asserts no DB enrollment), inject a session cookie, land on the dashboard → assert the enrollment, completion, `scenarioRoot=private` and the `voice-without-edges` badge all migrated to Postgres. The shared course-walk is extracted into a `walkWorkplaceConflict` helper.
- `[VERIFY]` Build ✓ lint ✓ types ✓ 10 unit ✓ **11 E2E ✓** (guest + a11y + 3 DB-backed, run locally against Docker Postgres). The two `[NOTE]`s from the prior entries (journey checklist reading demo-state; guest progress not migrated) are now resolved.

### Accessibility preferences persist to the account (2026-06-14)
Reading-help settings now follow the learner across devices — important for this audience (set a dyslexia-friendly font on a shared computer, find it already on your phone).
- `[BUILD]` `src/app/actions/a11y.ts` — `loadA11yPrefs` / `saveA11yPrefs` against the user-global `User.fontSize / dyslexic / contrast` fields (NOT project-scoped — they live on the person). Maps the schema's `dyslexic` ↔ the client's `dyslexia`.
- `[BUILD]` `AccessibilityProvider` rewritten as a hybrid store (same shape as the learner store): authed users load from the DB and write-through (debounced 600ms); guests use localStorage, which is also kept as a mirror for authed users (instant paint next load + survives sign-out). First-login migration carries guest prefs onto the account when the account has no custom prefs yet; the DB wins otherwise.
- `[FIX]` **Async-load race** (caught by the new E2E): a late-arriving DB load could overwrite a setting the user changed while it was in flight. Fixed with a `touched` ref — user-facing setters mark it, and neither the optimistic paint nor the post-load apply overwrites a touched value.
- `[BUILD]` `e2e/db-backed-progress.spec.ts` — new test: signed in, open the reading-help toolbar, set "Extra large" + "Easy-read font" → assert the `User` row (`fontSize=xl`, `dyslexic=true`), then reload and confirm the setting loads back from the DB (not just localStorage).
- `[VERIFY]` Build ✓ lint ✓ types ✓ 10 unit ✓ **12 E2E ✓** (stable ×2 vs Docker Postgres).

### GDPR self-service — data export + right to erasure (2026-06-14)
Signed-in learners can now exercise their data rights without emailing anyone — important for an EU platform serving vulnerable youth, and demoable at kickoff. → `DECISIONS.md · D12`
- `[BUILD]` **Account page** (`src/app/[locale]/account/page.tsx` + `AccountView`): profile (email, roles, project, member-since), a stats strip, a reading-help note, **Download my data**, and a **Danger zone** that deletes the account behind a typed-email confirmation. Reachable from the header (the email chip is now a link to `/account`, icon-only on mobile).
- `[BUILD]` **Export** (`GET /api/me/export`, `src/lib/gdpr-export.ts`): streams a JSON file (Content-Disposition attachment) of everything we hold — profile, memberships, course progress, Comp Card + entries, badges, missions, and facilitator observations/skill-validations *about* the learner (Art. 15/20). 401 for guests; writes an `account.exported` audit record.
- `[BUILD]` **Erasure** (`deleteMyAccount`, `src/app/actions/gdpr.ts`): writes an `account.deleted` audit record, then `prisma.user.delete` — the cascade erases all personal data while `AuditLog.actorId` (SetNull) keeps the row *anonymised*. The action clears the session cookie itself (cascade already removed the Session), so there's no spurious NextAuth `SignOutError`.
- `[SECURITY]` The export builder is a **server-only** helper taking a server-derived id — it is deliberately NOT exported from a `"use server"` file, so a client can't call it with someone else's userId (IDOR). Verified by the guest-401 test.
- `[BUILD]` i18n: new `account` namespace in EN/DE/EL (+ `common.account`).
- `[BUILD]` E2E (DB-gated): export returns the user's own JSON + is audited; guest export → 401; account page (incl. the expanded delete-confirm form) passes axe (WCAG 2.2 AA); deletion erases the `User` and leaves an anonymised (`actorId=null`) `account.deleted` audit record.
- `[VERIFY]` Build ✓ lint ✓ types ✓ 10 unit ✓ **16 E2E ✓** (8 DB-backed incl. 4 GDPR, stable ×2 vs Docker Postgres).

---

## Phase 5 — Interactive video (in-video questions)

### Lesson videos + in-video quiz pop-ups (2026-06-14)
Requested by the client: add videos to courses (upload or URL), and have a video pause mid-play to ask the learner a question. Built as "interactive video" / cue points. → `DECISIONS.md · O9` (video hosting)
- `[BUILD]` Content model (`src/lib/cms/types.ts`): `VideoContent` (provider `file` | `youtube`, `src`, `title`, `poster`, `caption`, `cues[]`) + `VideoCue` (`atSeconds`, `question`, `options[]`, `correctOptionId`, `explanation`). A stage gains an optional `video` block.
- `[BUILD]` `src/lib/video.ts` — pure helpers: `dueCue()` (which question to show now — earliest unanswered cue whose time is reached, so none are skipped on seek-forward), `parseYouTubeId()`, `formatTimecode()`, `detectProvider()`. 11 unit tests.
- `[BUILD]` `InteractiveVideoPlayer` — two playback engines behind one UI: native `<video>` (uploaded file / direct URL, full cue control via `timeupdate`/`seeked`) and **YouTube** (IFrame API, polled). At a cue it pauses and shows an accessible quiz dialog (radio options, correct/incorrect feedback + explanation, Skip/Submit → Continue watching), then resumes. A timeline shows cue markers. Wired into `CoursePlayer` above any stage with a `video`.
- `[BUILD]` Demo: the hero course's Concept stage carries a placeholder lesson clip (`public/demo/sample-lesson.webm`, ~1 MB, open-codec so it plays in real browsers *and* Playwright) with one cue tied to the I-statement concept. The consortium swaps src + cues per course.
- `[BUILD]` **Authoring** (`VideoBlockAuthor`, embedded in the Content Editor): a working "Add interactive video" container — Upload file (object-URL preview) | Paste URL (auto-detects YouTube vs direct), title/caption, a cue editor (timestamp + question + 2–4 options + correct + explanation), and a **live preview** using the exact learner player. New `video` content model surfaced in the CMS schema list.
- `[BUILD]` i18n: `video` namespace (UI + demo cue) in EN/DE/EL.
- `[VERIFY]` New E2E (`e2e/interactive-video.spec.ts`): seeking past the cue pops the quiz, the video is paused, a wrong answer shows "Not quite" + explanation, Continue closes it; the popup passes axe (WCAG 2.2 AA). Build ✓ lint ✓ types ✓ **21 unit ✓ 18 E2E ✓**.
- `[NOTE]` Uploads currently preview in-browser (object URL). Persisting an uploaded file to storage needs a hosting decision (EU/GDPR residency for a vulnerable-youth platform) — see `DECISIONS.md · O9`. URL/YouTube sources already work end-to-end with no storage.

### Video uploads wired to Vercel Blob (2026-06-15)
Client chose Vercel Blob for uploaded lesson videos. → `DECISIONS.md · D13`
- `[BUILD]` `POST /api/video/upload` (`@vercel/blob` client-upload flow, so large videos bypass the 4.5 MB serverless body limit). Gated in `onBeforeGenerateToken` to a signed-in **ADMIN / CONTENT_EDITOR**; restricted to `video/*` ≤ 500 MB; random suffix on the stored name.
- `[BUILD]` `VideoBlockAuthor` now uploads on file-select: instant local preview, a progress bar while it uploads, then the preview swaps to the **persisted Blob URL** ("Stored ✓"). If Blob isn't configured or the author isn't staff, it falls back to **preview-only** (the video still plays) — graceful degradation, no hard failure.
- `[SECURITY]` E2E: a guest POST to `/api/video/upload` is rejected (400) — no token minting without a staff session.
- `[INFRA]` **Pending (client/Vercel dashboard)**: connect a Blob store to the Vercel project so `BLOB_READ_WRITE_TOKEN` is set, then redeploy — real uploads go live. ⚠️ Vercel Blob is US-default; confirm region/DPA before real learner videos (flagged for kickoff). Storage is pluggable — an EU S3 bucket later is an adapter swap.
- `[VERIFY]` Build ✓ lint ✓ types ✓ 21 unit ✓ **19 E2E ✓** (incl. the upload-route guard).
- `[INFRA]` **Blob store connected + redeployed (2026-06-15)**: client connected a Vercel Blob store (`BLOB_STORE_ID` + webhook key now on the project's Production env); empty-commit redeploy picked it up. Confirmed the `@vercel/blob` SDK resolves credentials via **OIDC first** (`VERCEL_OIDC_TOKEN` + `BLOB_STORE_ID`, both auto-present on Vercel) before the classic `BLOB_READ_WRITE_TOKEN` — so the linked store authenticates with no static token. Live routes 200, upload route still guards guests (400). → `DECISIONS.md · D13`

### Captions (WebVTT) for the interactive video (2026-06-15)
An interactive video without captions fails **WCAG 2.2 SC 1.2.2 (Level A)** — so captions are required, not optional, for this audience. → completes Phase 5.
- `[BUILD]` `VideoCaptionTrack` (`src`, `label`, `lang`, `default`) added to `VideoContent`; the native player renders `<track kind="captions">` for each (with `crossOrigin="anonymous"` so cross-origin Blob/URL VTT loads). YouTube uses its own CC.
- `[BUILD]` Authoring: a "Captions (WebVTT)" field in `VideoBlockAuthor` (upload `.vtt` or paste a URL + a language label), with a clear warning when none is set. Demo ships `public/demo/sample-lesson.en.vtt`, wired to the hero course's lesson video.
- `[VERIFY]` E2E asserts the caption `<track>` renders. Build ✓ lint ✓ types ✓ 21 unit ✓ **19 E2E ✓**.

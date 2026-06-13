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

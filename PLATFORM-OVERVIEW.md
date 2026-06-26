# SEQ Elevate — Platform Overview & Recap

_A complete map of what SEQ Elevate is and does right now: the functionality, the
workflows, the architecture, and the development history. Companion to
`BUILDLOG.md` (chronological build log) and `DECISIONS.md` (decisions D1–D16)._

Last updated: 15 June 2026 · Live (staging): https://seq-elevate-demo.vercel.app

---

## 1. What SEQ Elevate is

A **gamified, multilingual, accessible digital learning platform** for NEET youth,
built for the DIESIS-led consortium. Young people walk short "soft-skill"
micro-courses (a 7-step learning journey per course); facilitators/teachers
track them; content editors author the content; admins run the project.

It is **multi-tenant by design** (a `Project` roots all data) and **trilingual**
(English / Deutsch / Ελληνικά). Everything is built to **WCAG 2.2 AA**.

### The stack

| Layer | Technology |
|---|---|
| Framework | **Next.js 16** (App Router, Server Components, Server Actions, Turbopack), **React 19**, TypeScript (strict) |
| UI | **Tailwind CSS v4** (CSS-variable design tokens), hand-built component primitives, `lucide-react` icons |
| i18n | **next-intl** (EN/DE/EL, ICU messages, locale routing via `proxy.ts`) |
| Auth | **NextAuth.js v5** — passwordless magic-link (Resend), **database sessions**, Prisma adapter, project-scoped RBAC |
| Data | **Prisma 7** + **PostgreSQL** — Neon (EU / Frankfurt) in staging/prod, Docker locally |
| Files | **Vercel Blob** (lesson videos + documents, client-upload flow) |
| Email | **Resend** (`senic.world` verified) |
| Content | **Hybrid CMS** — bundled provider + DB lesson overlay now; swappable to Strapi later (`CMS_SOURCE`) |
| Hosting | **Vercel** (staging), auto-migrate on deploy; Hetzner planned for production |
| Quality | **Vitest** (unit), **Playwright + @axe-core** (E2E + WCAG), GitHub Actions CI |

### Roles (project-scoped `Membership`)

- **Learner** — walks courses.
- **Facilitator / teacher** — tracks a cohort, observes, validates, sees statistics.
- **Content editor** — authors lesson content (text, video, documents).
- **Admin** — runs the project (dashboard, GDPR).

A single person can hold several roles, and the same human can belong to
multiple projects with different roles.

---

## 2. The map — routes, data, structure

### Routes (15 pages + 4 API)

```
/[locale]                         Landing — role picker + "Sign in" / demo
/[locale]/signin                  Magic-link sign-in (+ "Demo / client access")
/[locale]/signin/check-email      "Check your inbox"
/[locale]/demo                    One-click demo profiles (code-gated)        ← client showcase
/[locale]/learner                 Learner dashboard (overall completion bar, courses, journey, badges)
/[locale]/learner/course/[id]     The course player (7-stage journey)
/[locale]/learner/comp-card       Comp Card (reflective journal + PDF)
/[locale]/facilitator             Facilitator workspace (cohort bar, learner list, detail)
/[locale]/analytics               Statistics dashboard (staff only)
/[locale]/content                 Content editor (CMS authoring surface)
/[locale]/content/preview         Live content preview (split-screen)
/[locale]/admin                   Admin dashboard (aggregate counts)
/[locale]/account                 Account + GDPR (export, delete)
/[locale]/dev/storybook           Component gallery (transparency)
/[locale]/dev/cms-check           CMS source check (transparency)

/api/auth/[...nextauth]           NextAuth handlers
/api/me/export                    GDPR data export (JSON download)
/api/video/upload                 Vercel Blob token — lesson videos (staff)
/api/document/upload              Vercel Blob token — lesson documents (staff)
```

### Data model (20 tables, 5 migrations)

- **Multi-tenant root:** `Project`.
- **Identity / RBAC:** `User`, `Membership` (project-scoped role), NextAuth's `Account` / `Session` / `VerificationToken`.
- **Org structure:** `Organisation`, `Cohort`.
- **Content:** `Course`, `Lesson` (DB overlay: per-locale narrative + attached video), `LessonDocument` (uploaded files — ordered, publishable), `Badge`, `Mission`.
- **Learner state:** `CourseEnrollment` (stages completed, simulation/scenario/reflection/assessment answers, completion), `CompCard` + `CompCardEntry`, `UserBadge`, `MissionProgress`.
- **Facilitator workflow:** `Observation`, `Validation`.
- **Audit / telemetry / GDPR:** `AuditLog` (events: `stage.time`, `course.opened`, `video.cue_answered`, `account.exported`, `account.deleted`; `actorId` SetNull on user delete → anonymised trail).

### Server actions (`src/app/actions/`)

`auth.ts` · `demo.ts` · `learner.ts` · `lesson.ts` · `video.ts` · `telemetry.ts` ·
`facilitator.ts` · `gdpr.ts` · `a11y.ts`

### The 7-step learning journey (per course)

`Context → Concept → Behaviour → Simulation → Scenario → Reflection → Assessment → (Complete)`

Each stage renders generically from `CourseContent`, so any authored course
plays through the same engine.

---

## 3. Every functionality

### Identity & access
- **Magic-link sign-in** (passwordless, email link via Resend) with database sessions.
- **One-click demo profiles** at `/demo` (code-gated `elevate-demo`): Stefan (Admin+Editor), Demo Editor, Demo Teacher, Demo Learner — provisioned on first use; kill-switch `DEMO_LOGIN_DISABLED`.
- **Project-scoped RBAC** (Learner / Facilitator / Content-Editor / Admin); auto-provisions a Learner membership on first course use; configured emails (e.g. `stefan@senic.org`) get editor roles on login.
- **Account page** — profile, roles, stats, reading-help note.

### Learner journey
- **Generic 7-stage course player** (Context → … → Assessment → Completion) with a breadcrumb, progress bar, resume-from-last-position, and focus management.
- **Narrative stages** (paragraph / list / callout / compare blocks).
- **Simulation** (choose-the-response with feedback), **branching Scenario** (root + follow-up tree with outcome quality), **Reflection** (free-text prompts), **Assessment** (multiple-choice, scored, no grades/leaderboards).
- **Interactive video** — uploaded file, direct URL, or **YouTube**; **in-video quiz pop-ups** that pause at a timestamp; **WebVTT captions**; cue timeline.
- **Lesson documents** — an **ordered** (1.1, 1.2 …) list of mixed formats (PDF/Office/images), shown **both** as a downloadable list **and** a guided **step-through viewer** (slides); only **published** documents are visible to learners.
- **Comp Card** — reflective journal with privacy choice + branded **PDF** export.
- **Gamification** — badges (no leaderboards), skill-cluster map, "your journey" checklist.
- **Overall completion bar** across the whole programme.
- **Persistence** — signed-in learners persist to Postgres (progress, Comp Card, badges, accessibility prefs) and roam across devices; guests use localStorage; **guest progress migrates to the DB on first sign-in**.

### Content / CMS (in-app, DB-backed — "hybrid: DB now")
- **Edit lesson narrative** per language (title, subtitle, content blocks) with a "Customised / Default copy" indicator and one-click **Revert to default**.
- **Attach an interactive video** to a lesson — upload/URL/YouTube + in-video quiz cue editor + captions + **live preview**, saved to the lesson.
- **Lesson documents** — upload (to Blob), **reorder** (▲/▼ → 1.1, 1.2 …), and **publish/unpublish** each (teachers release when ready).
- **Lesson overlay** merges DB content (narrative + video + published documents) onto the bundled course at read time, per locale, defensively.
- **Swappable backend** (`CMS_SOURCE=local|strapi`) preserved for a future Strapi move.

### Facilitator / teacher
- **Cohort completion bar** + stat cards (active, Comp Cards, needs attention).
- **Real learner list**, each opening a detail with **Comp Card (field-level privacy redaction)**, scenario evidence, and an **Activity & performance** panel (current stage + course, time-on-task with per-stage breakdown, last active, quiz performance).
- **Observations + competence validations** (persisted, audited).
- Link to the **Statistics** dashboard.

### Statistics / analytics
- **Dashboard** (`/analytics`, staff-gated): KPIs; **completion funnel** with biggest drop-off; **where they get stuck** insights; **average time per lesson**; **activity (14 days)** + a **"when they open" day×time heatmap**; **per-learner table**.
- **Two data sources, one view**: a deterministic **representative sample** (so client demos look full) that **auto-switches to live data** once ≥5 learners have started (with a `?live` toggle).
- **Telemetry captured** for real cohorts: `stage.time` (active time per stage, tab-hidden excluded), `course.opened`, `video.cue_answered`.

### GDPR & privacy
- **Download my data** (`/api/me/export`, Art. 15/20) — JSON of everything held about the learner.
- **Delete my account** (Art. 17) — typed-email confirmation; cascade erases PII while the audit trail is **anonymised** (`actorId` → null).
- Comp Card **privacy choices** with field-level redaction in staff views.

### Accessibility (WCAG 2.2 AA)
- **Reading-help toolbar** — text size, dyslexia-friendly font, high contrast; **persists to the account** and follows the learner across devices (guests: localStorage).
- Captions on video; skip-link; focus order on stage changes; ARIA roles/labels; **axe-tested** on key surfaces (landing, dashboard, course, Comp Card, account, video quiz, analytics).
- No leaderboards (per the pedagogical brief); colour tokens tuned for AA contrast.

### Internationalisation
- Full EN / DE / EL across UI and the two demo courses; locale routing; per-locale content overrides.

### Infrastructure & operations
- **Auto-migrate on deploy** — the Vercel build derives Neon's direct endpoint and runs `prisma migrate deploy` before `next build`, so schema changes reach production automatically (defensive reads if a table is missing).
- **CI** (GitHub Actions): web job (lint · types · unit · build) + E2E job (Postgres service, migrate + seed, Playwright + axe).
- **Transparency artifacts**: `BUILDLOG.md`, `DECISIONS.md`, in-app storybook, this overview.

---

## 4. The workflows

**Learner** — Land → pick a role (guest) or sign in → dashboard (overall completion, courses) → open a course → walk the 7 stages (read → watch video + answer pop-up quiz → open documents → simulate → branch a scenario → reflect → assessment) → earn a badge → completion. Progress saves automatically (DB if signed in, localStorage if guest; guest progress migrates up on sign-in).

**Content editor** — Sign in (editor) → `/content` → choose course + lesson + language → edit the narrative / attach a video with quiz cues / upload, order and publish documents → save → learners see the change immediately (DB overlay). Live preview available.

**Facilitator / teacher** — Sign in → `/facilitator` → cohort completion + learner list → open a learner → read their Comp Card (privacy-respecting) + activity, time-on-task and quiz results → record an observation or validate a competence → jump to `/analytics` for cohort statistics.

**Client / demo** — Open `/demo`, enter the access code, click a profile → instantly signed in as that role (no email). Best entry point for showcasing.

**Admin** — Sign in → `/admin` (aggregate counts) and full content/facilitator/analytics access.

**GDPR** — `/account` → Download my data (JSON) or Delete my account (confirmed; anonymises the audit trail).

---

## 5. Development recap (phases)

- **Phase 0 — Foundations.** Decisions log + repo; Postgres + 20-table Prisma schema; NextAuth magic-link + Resend; Strapi content models; Hetzner/CI/observability plan; kickoff prep; storybook + build log.
- **Phase 1 — Core learner product.** Scaffold (Next 16 + Tailwind v4 + shadcn-style primitives); landing + role picker; **generic course player** + the 7-stage engine (narrative, simulation, branching scenario, reflection, assessment); Comp Card + PDF; gamification; full EN/DE/EL course translation; accessibility toolbar; facilitator peek; production hardening (error/404/loading, PWA, SEO); **WCAG 2.2 AA pass + axe**; **Vitest + Playwright in CI**; deploy to Vercel.
- **Phase 2 — Multi-tenant + CMS shell.** `Project` entity + brand-kit plumbing; live content preview; content-editor surface; replicate seqelevate.eu palette.
- **Phase 3 — Live database + auth.** Neon (EU) connected; Resend live; NextAuth UX (SessionProvider, header sign-in/out, auto-provision membership); **DB-backed learner state** (enrollment, Comp Card, badges); dashboards read real data.
- **Phase 4 — Multi-user.** Hybrid store (DB for authed, localStorage for guests); **guest→DB migration on login**; accessibility prefs persisted cross-device; **dashboard, admin & facilitator read real DB data**; GDPR self-service (export + erasure).
- **Phase 5 — Interactive video.** In-video quiz pop-ups; captions (WCAG 1.2.2); **Vercel Blob uploads**; in-video answer persistence + facilitator engagement.
- **Phase 6 — Facilitator analytics.** Position, time-on-task, quiz performance.
- **Phase 7 — Content / CMS (hybrid: DB now).** Auto-migrate on deploy; **lesson media** (link video + upload documents); ordered documents (1.1, 1.2 …); publish/unpublish; step-through document viewer; **editable lesson narrative per locale**; **demo access page**; **statistics showcase** (sample + real data); completion bars.

**Quality posture throughout:** every change ships only when `build · lint · types · unit · E2E (+ axe)` are green and CI passes; secrets verified absent from git; production verified live. Current: **25 unit + 27 E2E green**, both CI jobs green.

---

## 6. Decisions & open items (see `DECISIONS.md`)

**Decided (D1–D16):** Hetzner (prod, later) · SENIC-owned repo · staging URL · brand palette · tech stack · multi-tenant posture · Resend (live) · Postgres-in-Docker (dev) · hybrid CMS · interim Vercel staging · Neon (EU) · GDPR self-service · **Vercel Blob** for uploads · **hybrid "DB now" CMS** with auto-migrate · **Moodle scoped for later** · **demo access (staging only)**.

**Open / production to-dos:**
- **O1** production domain (DNS) · **O2** four WP3 strategic decisions (kickoff) · O3–O8 content/pilot/legal/audit items.
- **D13** — confirm **Vercel Blob region / DPA** (US-default) before real learner videos; storage is pluggable for an EU bucket.
- **D16** — **disable demo login** (`DEMO_LOGIN_DISABLED=true`) on the real production domain.
- **D10** — buy **Hetzner** for production (currently deferred; staging on Vercel).

---

## 7. Roadmap — next candidates

- **Bigger interactive-structure editor** _(flagged for the future)_ — author the **simulation options, branching scenario tree, and assessment questions** in the DB (the current CMS edits narrative text, video and documents end-to-end; the interactive structures are still bundled). This is the next major content-authoring layer.
- **Moodle integration** (LTI 1.3 / SCORM-xAPI / Web-Services API) — scoped, not built.
- **Strapi on Hetzner** — when production infra lands; the swappable client makes it a drop-in.
- **EU media storage** + production domain + demo lockdown for go-live.

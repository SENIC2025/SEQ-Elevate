# SEQ Elevate Platform

The gamified digital learning platform for the SEQ Elevate consortium (Diesis Network, Pro Arbeit, Synthesis, University of Macedonia). A mobile-first learner-journey environment for NEET youth — micro-courses, scenario-based practice, reflection, and competence validation through SEQ Comp Cards.

**Contract**: DIESIS-SEQ ELEVATE-SERVICE-M1-2026-01 · Created and Powered by SENIC · senic.world

> **Project docs**: `DECISIONS.md` (decisions log) · `BUILDLOG.md` (step-by-step build history) · `STORYBOOK.md` + `/en/dev/storybook` (component reference) · `KICKOFF.md` (consortium brief) · `deploy/README.md` (deployment runbook) · `cms/README.md` (content authoring).

## Architecture

| Layer | Tech |
|---|---|
| Frontend | Next.js 16 (App Router) · React 19 · Tailwind v4 · shadcn-style components |
| Auth | NextAuth.js v5 — passwordless magic link, project-scoped RBAC |
| Database | PostgreSQL 16 + Prisma 7 |
| Content | Strapi 5 (self-hosted), behind a swappable content client (`src/lib/cms/`) |
| i18n | next-intl — EN / DE / EL |
| Hosting | Hetzner Cloud (EU/Germany), Coolify, Let's Encrypt |
| Observability | Sentry · Plausible (cookieless) · Better Uptime |
| CI/CD | GitHub Actions |

Multi-tenant by design: a `Project` entity roots all data, so future projects are configuration, not a rewrite.

## Local development

```bash
# 1. Start Postgres
pnpm db:up

# 2. Install + generate Prisma client
pnpm install
pnpm prisma generate

# 3. Migrate + seed
pnpm db:migrate
pnpm db:seed

# 4. Run the app
pnpm dev          # http://localhost:3000  (redirects to /en)
```

Copy `.env.example` → `.env.local` and fill values. Without a Resend key, magic-link sign-in works in dev by logging the link to the server console.

Optional — run the CMS:
```bash
cd cms && npm run develop    # http://localhost:1337/admin
# then set CMS_SOURCE=strapi in .env.local
```

## Key scripts

| Script | Does |
|---|---|
| `pnpm dev` / `build` / `start` | Next.js |
| `pnpm db:up` / `db:down` | Postgres (Docker) |
| `pnpm db:migrate` / `db:seed` / `db:studio` | Prisma |
| `pnpm lint` | ESLint |

## Project structure

```
src/
  app/[locale]/        Locale-aware routes (en/de/el)
    learner/ facilitator/ admin/ content/   Role surfaces
    signin/            Auth pages
    dev/storybook/     Live component gallery
    dev/cms-check/     CMS client verification
  components/          UI primitives + composites
  lib/
    cms/               Swappable content client (local | strapi providers)
    prisma.ts          DB client
    auth-helpers.ts    Project-scoped RBAC
  data/                Project + course structure (seed source of truth)
  messages/            en/de/el translations
  store/               Client demo state (migrating to DB)
  auth.ts              NextAuth config
prisma/                Schema + migrations + seed
cms/                   Strapi (content authoring)
deploy/                Production Docker + runbook
```

## Status

Week 0 (pre-kickoff) productionisation complete: database, auth, CMS, deployment config, observability all staged. The contracted 5-week build (from the 25–26 June kickoff) productionises the consortium's content, runs the accessibility audit, delivers training, and hands over. See `BUILDLOG.md` for the full history and `KICKOFF.md` for the plan.

# SEQ Elevate Platform — Decisions Log

Single source of truth for decisions made, decisions still open, and the rationale behind both. Living document, updated as the build proceeds.

**Contract reference**: DIESIS-SEQ ELEVATE-SERVICE-M1-2026-01
**Signed proposal**: SENIC Technical + Financial Proposal, 10 June 2026
**Total contract value**: €16,000 (€10,500 dev + €5,500 hosting/maintenance 5y lump)
**Kickoff**: 25–26 June 2026

---

## ✅ Decided

### D1 · Hosting infrastructure — Hetzner Cloud
**Decided**: 13 June 2026 · *Decider: SENIC*
- Hetzner CX21 + object storage for the platform shell
- Existing Hostinger Business Web Hosting (paid through Feb 2028) repurposed for marketing/email/domain management
- 5-year cost estimate: ~€660–720 (well within €5,500 lump)
- Rationale: best Docker/Postgres ecosystem fit, predictable 5-year pricing, broadest EU footprint for community/tutorial support during the maintenance window

### D2 · Repo strategy — SENIC owns until handover
**Decided**: 13 June 2026 · *Decider: SENIC*
- New repo in SENIC GitHub org during build
- Transferred to consortium GitHub org at acceptance sign-off (Week 5)
- Demo repo (`seq-elevate-demo`) stays alive as the demo URL; production work moves to new repo
- Rationale: ops continuity during build, clean handover at the end

### D3 · Staging URL — `staging.seq-elevate.senic.world`
**Decided**: 13 June 2026 · *Decider: SENIC*
- SENIC-controlled subdomain for the duration of build
- Production domain decided separately later (see O1)
- Goes live by end of Week 0 so consortium can click it from kickoff onwards

### D4 · Brand palette — matched seqelevate.eu
**Decided (provisional, pending kickoff)**: 12 June 2026 · *Decider: SENIC, to be confirmed by consortium*
- Lime `#cad12c` primary, purple `#7467ae` accent, rose `#b575ae` tertiary
- Logo gradient stops (warm sunset, cool wave) available for accent surfaces
- Cool-tinted neutrals matching the Bricks WP theme on seqelevate.eu
- *Confirm at kickoff: is this the canonical SEQ Elevate brand or does a separate brand kit exist?*

### D5 · Tech stack — locked per Technical Proposal §4
**Decided**: 10 June 2026 · *Decider: SENIC, accepted in signed proposal*
- Next.js 14 (App Router) + React + Tailwind + shadcn-style components
- Postgres 16 + Prisma ORM
- Strapi (self-hosted)
- NextAuth.js (magic link)
- next-intl (EN/DE/EL)
- Hetzner Cloud (EU/Germany)
- Sentry + Better Uptime + Plausible
- GitHub Actions

### D6 · Multi-tenancy posture — plumbed, single-tenant in scope
**Decided**: 12 June 2026 · *Decider: SENIC*
- `Project` entity exists in data model, brand kit per project
- This contract delivers SEQ Elevate only — second project would be a future engagement
- Architecture decision so future projects don't require a refactor
- Not surfaced in consortium-facing UI to avoid distraction

### D7 · Email service — Resend
**Decided (provisional)**: 13 June 2026 · *Decider: SENIC*
- Magic link delivery + transactional email
- Free tier (3k emails/mo, 100/day) covers go-live and likely the full maintenance window for a NEET pilot scale
- Paid tier kicks in at €20/mo only if volume grows materially

### D8 · Local dev database — Postgres in Docker
**Decided**: 13 June 2026 · *Decider: SENIC*
- Mirror production Postgres locally so Prisma schema and migrations behave identically
- Docker Compose for local dev convenience

### D9 · CMS — hybrid Strapi, behind a swappable client
**Decided**: 13 June 2026 · *Decider: client (SENIC principal)*
- Strapi (per signed Technical Proposal §4) is the authoring backend — out-of-box no-code authoring, draft/publish, media, i18n, fastest to the "publish a course without code" acceptance criterion within the 5-week budget.
- BUT all content access goes through a source-agnostic client (`src/lib/cms/`). The app never imports Strapi types; it consumes a `CourseContent` shape. Backends switch via `CMS_SOURCE=local|strapi`.
- Rationale: hits the deadline with Strapi while staying swappable — if the 5-year Strapi maintenance proves heavy, migrate to native-Postgres authoring with zero app-code changes.
- Mitigates the 5-year-maintenance concern (D-risk): content is authored once then mostly idle; Strapi version pinned; clean migration path preserved.

---

## 🟡 Open — must close before kickoff or Week 1

### O1 · Production domain
**Status**: Open · **Decide by**: end of Week 1 in production (~7 July 2026)
- Options: subdomain of `seqelevate.eu` (e.g. `platform.seqelevate.eu`, `learn.seqelevate.eu`, `app.seqelevate.eu`) vs separate domain
- DNS configuration owned by consortium (they hold `seqelevate.eu`)
- Staging URL stays on `senic.world` until this is decided

### D10 · Interim staging on Vercel (delay Hetzner until contract/payment confirmed)
**Decided**: 13 June 2026 · *Decider: client (SENIC principal)*
- Deploy staging on Vercel now to keep development moving; buy Hetzner once the contract/payment lands.
- Works cleanly because of the swappable CMS (D9): Vercel runs `CMS_SOURCE=local` (Strapi can't run serverless), the local content provider keeps the app fully functional. Flip to `strapi` on Hetzner later — no code change.
- **Live now**: `https://seq-elevate-demo.vercel.app` (demo flows fully working: all 4 roles, course player, Comp Card, EN/DE/EL, a11y, storybook, cms-check).
- **Custom domain** `staging.seq-elevate.senic.world` added to the Vercel project; pending one DNS record (see below).
- Auth + DB-backed features dormant on Vercel until a hosted Postgres (Neon, free EU tier — recommended) + Resend key are added. Demo flows need neither.
- **DNS action (Hostinger panel for senic.world)**: add `A  staging.seq-elevate  →  76.76.21.21`. Vercel auto-verifies + issues SSL. senic.world nameservers are on dns-parking.com (Hostinger).

### O2 · The four open WP3 strategic decisions (PCR v2.0 §1.2)
**Status**: Open · **Decide by**: end of kickoff (26 June 2026)

| # | Decision | Default if not closed by kickoff |
|---|---|---|
| O2a | Number of micro-courses in v1 | Build for 4 (one per cluster), CMS supports 24+ |
| O2b | Comp Card granularity | Hybrid: cluster-level + per-course snapshot |
| O2c | Gamification intensity | Light-but-visible, tunable per cohort without code |
| O2d | Peer/mentor model | Data model present, UI feature-flagged per cohort |

If any decision slips past kickoff, the default ships and we revisit in Week 4.

### O3 · Content authoring schedule
**Status**: Open · **Decide by**: end of kickoff
- When does the consortium start authoring micro-courses in the CMS?
- Realistically: at least 1 course needs to be in Strapi by Week 4 to test the end-to-end content flow
- Translation timeline (DE, EL) — does the consortium have translators ready?

### O4 · Pilot launch date
**Status**: Open · **Decide by**: end of kickoff
- Affects acceptance window and the 5-year hosting clock start
- Pilot with real NEET learners is a consortium activity (out of SENIC scope)
- But the date determines when SENIC's go-live invoice (€5,500 hosting lump) is issued

---

## 🟠 Open — decide later

### O5 · External WCAG 2.2 AA audit
**Status**: Open · **Decide by**: end of Week 4
- Internal audit is in SENIC scope (acceptance criterion #8)
- External audit is consortium-paid if requested
- Auditor recommendations: TBD if needed
- WCAG 2.2 AA is non-negotiable for the target group, but who certifies is flexible

### O6 · Safeguarding policy + DPIA sign-off
**Status**: Open · **Owner**: Consortium (not SENIC scope)
- Required given vulnerable youth target group
- SENIC's platform supports the technical posture; the policy itself is consortium's
- Needed before pilot launch — flag in kickoff to avoid surprise

### O7 · Legal pages — Terms of Service, Privacy Policy, Cookie Policy
**Status**: Open · **Owner**: Consortium (not SENIC scope)
- SENIC delivers the legal page rendering surface
- Text written by consortium legal counsel
- Needed before production go-live

### O8 · Post-launch content maintenance
**Status**: Open · **Decide by**: handover
- Maintenance covers infrastructure and P0/P1 bug fixes
- Content updates, new courses, translation refresh are consortium-owned
- Worth confirming explicitly so there are no Year-2 surprises

---

## 📝 Notes & change requests

*Anything that arises during the build that doesn't fit a clean decision goes here. Add a date stamp.*

- **13 June 2026** — Consortium kickoff scheduled for 25–26 June 2026, giving ~2 weeks of "Week 0" prep before the contractual 5-week clock starts. SENIC uses this window to stage all infrastructure-only work (auth, DB, CMS, deploy, observability) so kickoff opens with a live staging URL.

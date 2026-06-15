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
- **13 June 2026 — accent darkened for accessibility**: the purple accent was changed from the brand's `secondary` (#7467ae) to `secondary-dark` (#5d528b). Reason: as 12px text on light tints #7467ae only reached 4.21:1 contrast, failing WCAG 2.2 AA (4.5:1) — caught by automated axe tests. #5d528b passes and stays within the seqelevate.eu palette. *Confirm acceptable at kickoff; if the consortium insists on the lighter purple, we restrict it to large text only.*

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

### D7 · Email service — Resend ✅ LIVE
**Decided + wired**: 13 June 2026 · *Decider: SENIC; key provided by client*
- Magic-link delivery + transactional email via Resend.
- **`senic.world` is verified on Resend** → we can send to any recipient (the whole consortium), no DNS work needed. Sender: `SEQ Elevate <no-reply@senic.world>`.
- **Verified live**: the running Vercel app sent a real magic-link email via Resend (302, no error) and wrote the token to Neon. Test email visible as Delivered in the Resend dashboard.
- The API key is a **sending-only restricted key** (good security — can send, can't manage domains/account). Stored only in Vercel's encrypted env + gitignored `.env.local`. Never committed.
- Free tier (3k emails/mo, 100/day) covers go-live and likely the full maintenance window for a NEET pilot scale; paid tier (€20/mo) only if volume grows.
- **Full auth stack is now end-to-end real on staging**: Neon DB (D11) + NextAuth magic-link (D-auth) + Resend email. The consortium can sign in with a real email at kickoff.

### D8 · Local dev database — Postgres in Docker
**Decided**: 13 June 2026 · *Decider: SENIC*
- Mirror production Postgres locally so Prisma schema and migrations behave identically
- Docker Compose for local dev convenience

### D11 · Staging database — Neon (EU, Frankfurt)
**Decided / done**: 13 June 2026 · *Decider: client provided, SENIC wired*
- Neon serverless Postgres (eu-central-1, Frankfurt — GDPR-aligned) is the staging database, connected to the Vercel app.
- **Pooled** connection (`-pooler` host) is `DATABASE_URL` for the serverless runtime; **direct** connection (no `-pooler`) used for `prisma migrate deploy` (Prisma's migration advisory-locks don't work through Neon's PgBouncer pooler).
- Migrated (20 tables) + seeded (SEQ Elevate project, 4 partner orgs, Berlin cohort, both courses + badges). Verified: the live Vercel app reads + writes Neon (auth created a VerificationToken in Neon).
- **Not used**: Neon Auth (we have NextAuth) and Neon's Data API/REST (we use Prisma over the native protocol).
- Local dev stays on Docker Postgres (isolated from staging data); Vercel uses Neon. The secret connection string lives only in Vercel's encrypted env (never committed).
- **Still needed for end-to-end user sign-in**: a Resend API key — without it, tokens are created in Neon but the magic-link email isn't delivered (logged to Vercel function logs instead). This is a Resend dependency, not a Neon one. → `DECISIONS.md D7`

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

### D12 · GDPR self-service — data export + right to erasure
**Decided**: 14 June 2026 · *Decider: SENIC (build), within scope (vulnerable-youth platform)*
- Signed-in learners get an **Account** page (`/[locale]/account`) with: profile, a **Download my data** export (`GET /api/me/export` → JSON of everything we hold; Art. 15/20), and **Delete my account** with typed-email confirmation (Art. 17).
- **Erasure anonymises rather than erases the audit trail**: `User` delete cascades away all personal data, but `AuditLog.actorId` is `onDelete: SetNull` — the `account.deleted` record survives with `actorId = null`. We keep the *legal* fact of the action without the PII.
- Export is a **server-only** helper called with a server-derived user id (never a client-callable action) — closes the IDOR risk of letting a client pass any userId.
- Deletion clears the session cookie in the server action itself (not NextAuth `signOut`), since the cascade already removed the `Session` row — avoids a spurious `SignOutError` in production logs.
- Does **not** close O7 (the Terms/Privacy/Cookie *copy* is still consortium counsel's) — it provides the technical mechanism those policies will point to. Flag at kickoff that the rights-exercise surface is already live.

### D14 · Content / CMS — hybrid (DB now, Strapi later)
**Decided**: 15 June 2026 · *Decider: client (SENIC principal)*
- Authored content (courses, lessons, attached videos & documents) is persisted to the **Postgres DB now**, edited via an in-app content editor — no new infrastructure, works on the current Vercel + Neon staging immediately.
- The swappable content client (`CMS_SOURCE=local|strapi`, see D9) is **kept**, so a Strapi instance on Hetzner can slot in later without reworking the app.
- **Enabler**: production DB migrations now run automatically on deploy. Neon's pooled endpoint can't run Prisma migrations (advisory locks need a direct connection), so the Vercel build derives the **direct** Neon endpoint (drops `-pooler`) and runs `prisma migrate deploy` before `next build` (`prisma/migrate-deploy.mjs` via the `vercel-build` script). DB reads of new content are defensive (try/catch → fall back to bundled content) so a missing table never breaks the live site.

### D15 · Moodle integration — scoped for later
**Decided**: 15 June 2026 · *Decider: client (SENIC principal)*
- Requirement noted; **not built now**. Three viable approaches when prioritised: **LTI 1.3** (Moodle as the front door, SSO + grade passback), **SCORM/xAPI export** (portable course packages + an LRS), or **Moodle Web-Services API sync** (users/cohorts/grades). Each is a sizable, separate workstream — revisit at/after kickoff with the consortium's actual Moodle usage in hand.
- The platform is being built so these stay open: stable per-learner identity, project-scoped data, and an event log (AuditLog) that an xAPI/LRS bridge could emit from.

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

### D13 · Video hosting / storage — Vercel Blob (interactive video uploads)
**Decided**: 15 June 2026 · *Decider: client (SENIC principal)*
- File uploads in the interactive-video authoring UI persist to **Vercel Blob** (client-upload flow — large videos bypass the 4.5 MB serverless body limit). URL and YouTube sources work without any storage.
- **Wired**: `POST /api/video/upload` issues a Blob client-upload token, gated to signed-in staff (ADMIN / CONTENT_EDITOR) and restricted to `video/*` ≤ 500 MB; `VideoBlockAuthor` uploads with a progress bar and swaps the preview to the persisted Blob URL. Without the token (or for guests) it falls back to in-browser preview-only — the feature degrades gracefully.
- **One infra step remaining (client/Vercel dashboard)**: create a Blob store on the Vercel project → Vercel auto-adds **`BLOB_READ_WRITE_TOKEN`** to the env → redeploy. Real uploads then work in production.
- **⚠️ GDPR follow-up**: Vercel Blob is US-default storage. Before real learner videos (identifiable vulnerable youth) go in, confirm the region/DPA or move uploads to an EU bucket. Acceptable for staging/kickoff demos; flag at kickoff alongside the DPIA (O6). The code is storage-pluggable — swapping to an S3-compatible EU bucket later is an adapter change, not a rewrite.

---

## 📝 Notes & change requests

*Anything that arises during the build that doesn't fit a clean decision goes here. Add a date stamp.*

- **13 June 2026** — Consortium kickoff scheduled for 25–26 June 2026, giving ~2 weeks of "Week 0" prep before the contractual 5-week clock starts. SENIC uses this window to stage all infrastructure-only work (auth, DB, CMS, deploy, observability) so kickoff opens with a live staging URL.

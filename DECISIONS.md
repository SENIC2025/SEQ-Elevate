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

### D22 · Production hosting — Vercel (supersedes D1 Hetzner for production)
**Decided**: 21 August 2026 · *Decider: SENIC principal*
- Production runs on **Vercel** (the platform staging/demo already runs there), **not** the Hetzner Cloud VPS named in **D1 / D5 / the signed proposal §4**. Hostinger considered and declined.
- **Rationale**: the app is architected for Vercel — Vercel Blob for uploads (Vercel-proprietary, EU/FRA1), serverless Server Actions + API routes, auto-migrate on deploy (D14), EU-configurable compute region, one-click rollback. A Hostinger/Hetzner VPS would mean self-managed Node server, SSL, deploys, scaling, monitoring, and losing the Blob integration — a re-architecture for no pilot-stage benefit. The auth layer is already host-agnostic (`trustHost: true`), so self-hosting isn't *blocked*; the cost is Blob + ops.
- ⚠️ **Commercial note — flag to consortium**: D1 budgeted Hetzner (~€660–720 / 5y) inside the €5,500 hosting/maintenance lump. Vercel is a different, SaaS-recurring cost profile (Vercel Pro ~€20/seat/mo + Neon + Blob; still within €5,500 at pilot scale, but ongoing not fixed-VPS). This departs from the signed proposal's stated infrastructure — a **conscious choice, not an oversight**. Confirm the commercial framing with the consortium.
- **Hostinger** remains available for the **marketing/landing site** (its original D1 role) — not the app.

### D23 · Production environment — reuse the demo Vercel project (not a separate clean project)
**Decided**: 21 August 2026 · *Decider: SENIC principal*
- Production **reuses the existing demo deployment** (same Vercel project + Neon DB + FRA1 Blob), flipped to production mode — rather than standing up an isolated clean project/DB/Blob.
- SENIC recommended a **separate clean environment** for real learners' data (incl. under-18s), so demo activity can never touch real PII; the principal chose reuse for speed. Recorded so the trade-off is explicit.
- **Required hygiene before the first real learner** (because prod shares the demo DB):
  1. `DEMO_LOGIN_DISABLED=true` — turns off one-click demo admin login **and** stops the demo course re-seeding (D16/D21).
  2. **Rotate `AUTH_SECRET`** to a fresh strong value — invalidates any lingering demo sessions (a demo login can hold an ADMIN session).
  3. **Purge demo data** — remove the seeded demo course (`demo-speaking-up`) and demo users/memberships so the production DB starts clean. SENIC can provide a guarded cleanup script on request.
- Consequence, accepted: real learner records and demo/test records live in the same database; the isolation is by the above steps + RBAC, not by separate infrastructure.

### D24 · Cost lifecycle — Neon Launch during the pilot, downgrade to Neon Free when passive
**Decided**: 21 August 2026 · *Decider: SENIC principal*
- The project has a **short active phase** (pilot with ~120 learners, ~1 year to ~Sept 2027) then a **long passive/archive phase** (little to no activity). Hosting cost is matched to that shape rather than paid flat for 5 years.
- **Vercel Pro is a sunk cost** — SENIC keeps it regardless — so the only *new* recurring cost of the platform is the database (Blob is pennies; teaching video goes to YouTube/Vimeo, not Blob).
- **Active phase → Neon Launch** (usage-based; verified on Neon's pricing page, "typical $15/mo" for intermittent load + 1 GB — the pilot's exact profile, likely ≤$15). Buys off the Free tier's 100 CU-hr/month cap and auto-suspend cold-starts during live use, and includes point-in-time recovery (also answers the "backup retention tier" gap in DATA-PROTECTION §6 / DPA Annex II).
- **Passive phase → downgrade to Neon Free ($0)**. 120 learners' records are tens of MB — far inside Free's 0.5 GB. Auto-sleep/cold-start is irrelevant when passive. The downgrade is a **billing toggle in the Neon dashboard: same DB, no migration, no code change.** (Do *not* "cancel" Neon — that deletes the DB; downgrade, don't cancel. To fully mothball, `pg_dump` and take the deployment offline for true €0.)
- **Total new cost over the lifecycle ≈ €150–200 for the pilot year, then ≈ €0** — corrects the earlier ~€2,400/5y figure (which wrongly counted sunk Vercel Pro and assumed paid Neon for all 5 years).
- **Hostinger VPS rejected for the app** (considered per the principal's cost question): ~€400–600 that *never* drops when passive, still needs security patching when idle, forces a Blob→S3 code migration now, and puts self-managed-server risk into the live pilot. The managed path is the one that actually scales to ~€0 when passive. (Existing Hostinger stays the marketing-site host, its D1 role.) Neon's Scale tier ($701/mo, "high load, 100 GB") is enterprise-scale and irrelevant here.

### D25 · Onboarding & roles — passwordless (sign-in = sign-up), roles granted not self-selected
**Decided**: 21 August 2026 · *Decider: SENIC principal*
- **No separate sign-up page.** Sign-in is passwordless (magic link); the first click creates the account. A newcomer and a returning user use the same page.
- **Roles are granted, never chosen.** A public "choose admin" role picker would let a stranger reach every learner's PII and GDPR deletion — unacceptable on a vulnerable-youth platform. A brand-new user lands with **no elevated role**; `ensureLearnerMembership` adds LEARNER when they use learner features.
- **Admin bootstrap = `ADMIN_EMAILS` allow-list** (the chosen option over "SENIC provisions each by hand" and "self-service request+approval"). Emails you configure in the env auto-receive **ADMIN + CONTENT_EDITOR** on sign-in (so admins can manage people *and* author courses). Server-controlled; wired in `auth.ts` `events.signIn`, decoupled from the demo profiles.
- **Demo-profile role grants are now gated to showcase deploys** (`DEMO_LOGIN_DISABLED !== "true"`), so a hardcoded demo email (e.g. `stefan@senic.org`) never silently becomes admin on real production — only `ADMIN_EMAILS` governs there.
- **Everyone else is added by an admin** via Admin → People (`admin.ts addMember(email, role)` — already built): trainers/teachers (FACILITATOR), content editors, learners, or other admins, by email + org + cohort. They sign in via magic link and land in their role.
- **Open sub-decision (consortium):** an ADMIN sees **project-wide** data today; whether each partner admin is siloed to their own organisation is the per-org siloing decision left with the consortium (DATA-PROTECTION §3).

### D26 · "Your workspaces" — role-based navigation replaces the demo role picker in production
**Decided**: 28 September 2026 · *Decider: SENIC principal (reported: admins on ADMIN_EMAILS saw only the learner view)*
- **The problem (a regression SENIC introduced):** in the demo, the only way into course creation / admin was the home-page role-picker cards. The production front door (ff707eb) replaced those with a single "Sign in" button, sign-in always landed on `/learner`, and the signed-in header had no workspace links — so even correctly-granted admins had **no button** to reach "Create courses".
- **The fix:** after sign-in, users land on **"Your workspaces"** — cards for exactly the workspaces their **real roles** allow: *Create courses* (Content-Editor or Admin), *Manage people* (Admin), *Support learners* and *Statistics* (Facilitator or Admin), *My learning* (everyone). A **workspace switcher** in the top bar moves between them from any page. Users with a single workspace (most learners) skip the hub and go straight to their courses. Same feel as the demo's role picker — but every card is a role the user actually holds, so nothing is self-selected (D25 still holds).
- **Admin access no longer needs a re-sign-in:** the `ADMIN_EMAILS` grant is also applied on the person's next page load (idempotent, race-safe), not only at sign-in. Adding someone to the list + redeploying is enough.
- Rules mirror the server gates they lead to (`requireEditor`, `getProjectLearners`, the analytics staff check), so the UI never offers a door the server would refuse. Shared, unit-tested logic in `src/lib/workspaces.ts`; role grants in `src/lib/role-grants.ts`; the allow-list in `src/lib/admin-bootstrap.ts`.
- Also removed the "platform shell demo" footer real learners still saw on `/learner`.

### D27 · Invitation emails — admins invite people with a one-click join link
**Decided**: 28 September 2026 · *Decider: SENIC principal*
- **Why:** after D25/D26, adding someone in *Manage people* didn't tell them anything — someone had to say "go to seq-elevate.eu and sign in". Now adding a person **sends an invitation email by default** (a checkbox; the admin can untick it), in **EN / DE / EL** chosen per person (defaults to the admin's screen language). It greets them, says who invited them, **their role**, and **what they'll find** (the same workspace cards as D26), with one button: **Join SEQ Elevate**.
- **The link is a real one-click sign-in**, valid **7 days** — people open invitations days later. Ordinary sign-in links keep Auth.js's **24 hours**. Implemented as a **second Auth.js email provider (`invite`)** with its own `maxAge`, so we use only public Auth.js APIs (no re-implementation of its token hashing). After joining they land on "Your workspaces" in their language.
- **Security — only an admin can cause an invitation email.** Auth.js serves every provider publicly (`/api/auth/signin/invite`), so the provider is gated in the `signIn` callback, which Auth.js runs **before** creating any link: it is allowed only inside an admin's server action inviting exactly that address (an in-process `AsyncLocalStorage` intent — no DB state, nothing forgeable from outside). A public request is refused and **no link is created** (E2E-tested for a pending invitee and a stranger). The sending helper is a plain server module, **not** a `"use server"` export (lesson from the July privilege-escalation fix). Rate-limited per address (5/h) and per admin (100/h). Admin-typed text (names) is HTML-escaped in the email.
- **Status without a migration:** Auth.js sets `emailVerified` the first time someone uses a link, so the People list shows **Joined** vs **Invited <date>** (from the `member.invited` audit event) with **Resend invitation**. Adding someone who already has an account sends no invitation — they just get the new role (the UI says so).
- **Data protection:** the invitation sends the invitee's email, optional name, role and the inviter's name (or email) through **Resend** — an existing sub-processor; DATA-PROTECTION.md and the DPA template updated.
- **Addendum (29 Sep 2026) — "sent" must mean sent.** A learner's invitation never arrived, although the screen said it was sent. Root cause in SENIC's code: with `redirect: false`, next-auth's `signIn()` does **not** throw when the email fails — Auth.js returns its error-page URL instead — and the invite action only watched for exceptions, so a refused email was reported as *sent*, audited as `member.invited`, and listed as *Invited* (reproduced on the then-live code). Now: an invitation counts as sent **only** when Auth.js reaches the "check your email" step (`lib/signin-result.ts`, unit-tested); otherwise the admin sees Resend's own reason on screen and nothing is audited. Every send is logged (`[email] … accepted (id …)` / `refused — reason`, recipient domain only). On the live site a missing `RESEND_API_KEY` now fails loudly instead of printing working sign-in links into the logs. Verified: the real Resend key + `senic.world` sender deliver invitations (to Resend's test inbox) and production sends sign-in email; troubleshooting steps in GO-LIVE §4.

### D28 · Admin includes Editor — one rule, in one place
**Decided**: 29 September 2026 · *Decider: SENIC principal ("Admin should also be content editor")*
- An **Admin can do everything an Editor can**. This was already true on the server; the confusion came from upload screens that printed a hard-coded *"sign in as a content editor"* for every failure.
- The rule now lives once in `src/lib/permissions.ts` (`canEditContent`, `roleIncludes`) and is used by every authoring action, the upload routes, the workspace cards and draft previews. Nothing extra is stored: granting Admin does not add an Editor row; *Manage people* shows **Admin (includes Editor)** and the Editor chip as *included with Admin*.
- Failure messages name what actually happened (not signed in any more / no Editor role / storage not connected / the server's reason) — never a guess.

### D29 · Upload storage — find the token under any prefix, and show the site's own view of it
**Decided**: 29 September 2026 · *Decider: SENIC (build decision)*
- **Why:** the Blob store showed *Connected* while the running deployment had no `BLOB_READ_WRITE_TOKEN` — Vercel env vars only reach deployments built after they exist, and a store can be connected with a custom prefix.
- The server accepts the standard `BLOB_READ_WRITE_TOKEN` **or** any `…READ_WRITE_TOKEN` whose value is a Vercel Blob read-write token (`vercel_blob_rw_…`), passed explicitly to `handleUpload`. `NEXT_PUBLIC_*` names are never used. If several stores are ever connected, the standard name wins, then the first prefixed name alphabetically — keep **one** store (D13, `fra1`).
- `GET /api/storage/status` reports, to signed-in users only, whether uploads can work (`ready`/`missing`, and for admins whether the token name is standard or prefixed) — never a value or a variable name. The upload panels show the same answer **before** anyone picks a file.
- A file that only exists in the author's browser (a `blob:` preview) can't be saved to a lesson: learners would get a broken video.

### D30 · No "demo" on the working platform
**Decided**: 29 September 2026 · *Decider: SENIC principal ("It is not a demo. It is a working platform.")*
- Removed every demo/Strapi panel, banner, mock and made-up number from the pages real users see. Where a mock stood in for real data, the page now shows the real data or says honestly that there is none yet.
- **Test sign-in (`/demo`) and developer pages (`/dev/*`) do not exist on the live site** (404 wherever `DEMO_LOGIN_DISABLED=true`, and `/dev` also on Vercel production). On test copies the one-click accounts are called what they are: *Test sign-in*.
- A unit test fails the build if *demo*, *Strapi* or *"in production this"* reappears in user-facing copy (messages or JSX), with a tiny, justified allow-list for developer-only pages.
- Internal names (`useDemoState`, `DEMO_*` env vars, `demo-profiles.ts`, the seed/purge scripts, the Vercel project name `seq-elevate-demo`) are not user-visible and stay, to avoid churn.
- Staff-only pages (*Create courses*, the admin overview) now check the viewer's role **before** loading any data.

### D31 · Server functions run in Frankfurt (`fra1`)
**Decided**: 29 September 2026 · *Decider: SENIC (build decision, consistent with D13/D22)*
- The live site's serverless functions were running in Vercel's default region `iad1` (US East) — every database query crossed the Atlantic to Neon Frankfurt, and personal data was processed in the US. `vercel.json` now pins `regions: ["fra1"]`, next to the database (Neon, Frankfurt) and file storage (Blob, `fra1`). DATA-PROTECTION.md updated.

### D32 · Official logo, generated reproducibly
**Decided**: 29 September 2026 · *Decider: SENIC principal (logo supplied)*
- The *SEQ Elevate — Skills for the Future* logo replaces the placeholder sparkle everywhere: header (arcs mark + wordmark; the full lockup's tagline would be unreadable at header height), landing, sign-in pages, favicon/app icons, link previews and both emails.
- All sizes are generated by `scripts/brand-assets.py` from the trimmed master `public/brand/seq-elevate-lockup.png`; the lockup is never upscaled. Emails use a copy on **white** (dark-mode mail apps would hide the black lettering on transparency) with an absolute URL taken from the email's own link, and keep *SEQ Elevate* as alt text. If an SVG or larger original is supplied later, re-run the script with it.

### D33 · "Manage courses" workspace + one page per course
**Decided**: 29 September 2026 · *Decider: SENIC principal ("it must be very easy and user-friendly")*
- **Why:** editors had to pick the same course again inside every tool (narrative, video, documents, exercises) on one long page. Now a sixth workspace, **Manage courses** (`/content/courses`, Editor or Admin, D28), shows every course as a card — status, built-in or created here, lessons, languages, last edited, enrolled — with links to open it, preview it, or jump straight to one lesson.
- **The course page** (`/content/courses/<slug>`) holds everything for one course: title and subtitle per language, one content-language switch, the lessons in learner order (video, documents, then the lesson body — what learners see), "Preview as learner", and publish / unpublish / archive / **move back to draft**. The tools no longer have course dropdowns. *Create courses* keeps starting new courses and the shared templates (Comp Card).
- **No draft layer (Q2):** saving to a published course is live at once, as it already was for lessons. The page says so plainly: *"This course is live — changes you save are visible to learners straight away."* Publish warnings (missing translation, empty lesson) never block publishing.
- **Built-in courses (Q3):** their simulation, scenario, quick check and reflection come with the platform and stay read-only (with a notice); their video, documents, lesson text, title and subtitle are editable.
- Every page and loader checks the Editor role on the server **before** loading anything (drafts, draft documents and enrolment counts are staff-only). Saves of one lesson's or one course's per-language JSON take a row lock, so two languages saved at once can't overwrite each other. A lesson's text or interactive stage saved from a page opened before a colleague saved it is refused instead — nothing is written, and the editor is offered the colleague's version — because an interactive stage holds every language in one draft and would otherwise silently wipe the other's translation.
- *Q1, unchanged:* the build-seeded course (D21) is only seeded where test sign-in exists (`DEMO_LOGIN_DISABLED` unset), so the live site is unaffected.

### D34 · Rewording a built-in course's title and subtitle (`copyOverride`)
**Decided**: 29 September 2026 · *Decider: SENIC (build decision)*
- A course **created here** keeps its copy in `Course.meta`; editing it per language writes `meta[locale]` (which is also how it gains German or Greek copy).
- A **built-in** course's copy comes from the message catalogue. Its rewording goes in a new nullable column, `Course.copyOverride` (`{ de: { title?, tagline? } }`), applied on read — not in `meta`, because a non-null `meta` is what marks a course as created here (it would be listed twice and accept exercise edits that are then ignored).
- Each field overrides on its own and only in its own language. An empty field, or one identical to the built-in wording, removes the override, so later fixes to the catalogue still show; the course page always shows *"Built-in: …"* and offers *Use built-in wording*. The badge name is unchanged.
- The overlay fails open like the status overlay (D18): if the read fails, learners see the built-in wording. Migration `course_copy_override` is additive; rolling back means ignoring the column.

### D35 · "Preview as learner" is a sandbox
**Decided**: 29 September 2026 · *Decider: SENIC (build decision)*
- Editors preview a course (published or draft) in the real player, from any lesson, and can jump to any step. **Nothing they do there is saved:** no enrolment, no progress, no badge, no statistics — preview runs on an in-memory copy of the course state, so an editor's clicks never show up in a cohort's numbers.
- Only people who can edit content get preview mode, and only they can start at a chosen lesson; learners keep the step-by-step order. Draft documents stay hidden in the preview, exactly as learners would see it (the course page lists them with a *Draft* badge).
- An editor viewing any course sees **Edit this lesson**, which opens that lesson on the course page; the preview banner links **Back to editing**.

### D36 · Rich text format for lesson paragraphs and key messages
**Decided**: 29 September 2026 · *Decider: SENIC principal ("Bold, italic, bullet points, numbering, and indent" — "the same as you see it as a learner"); format: SENIC (build decision)*
- Paragraphs and key messages can use **bold, italic, bulleted and numbered lists (up to three levels) and indent** — nothing else: no links, images, colours, fonts or headings, so every lesson keeps the platform's look and can't carry anything unsafe. Editor and learner view use the same styles, so what authors see is what learners get.
  - *Amended by D55 (13 October 2026): web and email addresses typed in the text show to learners as links, found when the page is drawn; the stored format is unchanged.*
- **Stored as structured JSON, never HTML:** a block keeps `rich = { v: 1, doc }` next to its plain `text`. The server rebuilds every saved doc from that whitelist (anything else is dropped) and derives `text` from it itself — older code, the reflection intro and a rollback keep working from `text`. The learner view checks the doc again on every render and only ever outputs a fixed set of elements. No migration: `Lesson.narrative` is already JSON.
- **Existing text isn't converted in bulk.** A block becomes rich only when an author edits it, converted by the rules learners already see (Round 1's list detection), so nothing changes for learners until someone changes the text.
- **Limits are refused, not cut:** a block over 10,000 characters (or with extreme formatting), a list over 50 points or a lesson over 100 blocks is not saved, and the author is told which block to split — silently losing the end of a text would be worse. Lists pasted deeper than three levels are kept at the third level instead of refused; no text is lost.
- List blocks can be **bulleted or numbered** (`listStyle`; existing lists stay numbered). Saving and removing lesson text is now audited (`narrative.saved` / `narrative.cleared`), like the exercises.
- **Q4 — no "Paste from Word" button.** Normal paste (Ctrl+V, ⌘V on Mac) tidies Word and Google Docs formatting automatically, keeping bold, italic and lists; a short tip by the toolbar says so. A button that in some browsers could only show instructions would confuse more than help.
- **The reflection intro uses the same format** (SENIC principal: "make the reflection intro rich text too"): on a created course, the reflection lesson's *Introduction* is edited with the same toolbar and stored as its one paragraph, `rich` next to the server-derived `text` — so older code and a rollback still show it, unformatted. Learners, the course page and the editor draw it with the same styles. An intro nobody edits stays plain text; built-in courses' reflection stays read-only.


### D37 · A learner's saved data is only ever saved over by what they did — never by a copy that didn't load
**Decided**: 30 September 2026 · *Decider: SENIC principal ("fix the learner progress bug too"); rules: SENIC (build decision)*
- **Load before save.** A signed-in learner's course, Comp Card and badges are saved only once their saved data has loaded into this page and been merged. A load that fails — or finds no session, which is what a failed session lookup looks like — is tried again (after 1, 2, 4 and 8 s); nothing is saved until one gets through, and what the learner does meanwhile stays on screen.
- **Merging, not replacing.** What the learner did while their data loaded is kept: new lessons are added to the saved ones, answers they gave win, fields they didn't touch keep the saved value, badges are a union, the first completion date stays.
- **A session that can't be read is held, not dropped.** The page keeps the learner's data (saving nothing new, writing nothing to the browser's guest store) and reads the session again after 1 s and 3 s; found again, what's on screen is saved; still no one, it's let go of. Another account signing in lets go at once. Every save carries the learner it was made for, and the server refuses it for anyone else, so nothing lands in the next account on a shared computer.
- **On sign-in, the account wins.** A guest's progress moves to the account only where the account has nothing (per course, Comp Card, badge) — the same whether the sign-in link opens in this tab or in another one.
- *Added 13 October 2026 (Release 0):* saves wait out a short pause (~0.7 s) so quick clicks go together, except the save that **finishes a course**, which is sent at once; and when the tab is hidden or closed, whatever save is already waiting is sent then. Only saves these rules had scheduled are sent. (Server actions run one at a time, so such a save can still wait behind one already on its way; sending it outside that queue would need its own endpoint — not done.)

### D38 · Reading-help settings: the account's own are never reset or overwritten
**Decided**: 30 September 2026 · *Decider: SENIC principal ("fix the reading-help settings bug too"); rules: SENIC (build decision)*
- Same load-before-save, retry, hold and "made for this account" rules as D37 for text size, dyslexia font and high contrast.
- A setting chosen while the account's settings load wins — only that setting; the others are the saved ones.
- Settings chosen in this browser that no account holds yet (a guest's) move into an account **only if that account is still on the defaults**, and stay in the browser until the server confirms the account holds them. An account's own settings never move into another account.
- Unchanged settings aren't sent: no save follows a load.

### D39 · Screens don't rely on a page refresh alone to show a change
**Decided**: 30 September 2026 · *Decider: SENIC (build decision)*
- In Next.js 16 a `router.refresh()` after a change sometimes doesn't show until the next router update; the data is saved, the screen looks unchanged. Upgrading to 16.2.12 didn't change this, so we work around it instead of changing framework versions in a fix release. It existed on the live site too; a settings save sent after every page load happened to hide it for changes made in the first half-second.
- The **people** and **organisations & cohorts** screens now show the list each action returns, until the page's own list is rendered again.
- **Learner pages** that must stop showing a learner's progress after a sign-out elsewhere check that the page was rendered for whoever holds the session now; if not, they refresh again (a later refresh brings a stalled one in) every 2 s and reload after the third try.

*D40–D48 are kept for the consortium's answers to the October 2026 change-request document; they are recorded once confirmed.*

### D49 · Quick-check answers are saved, and a learner can try again
**Decided**: 13 October 2026 · *Decider: SENIC principal ("Start Release 0", plan §4); rules: SENIC (build decision)*
- A learner's quick-check answers and whether they pressed *Check answers* are saved with the course (`CourseEnrollment.assessment = { answers: { questionId: optionId }, checked }`; the guest store for guests), by question id, so quick checks made in the editor — any number of questions, their own ids — work like the built-in ones. No migration: the column was already JSON and only ever held empty slots.
- A checked quick check comes back as it was left: answers, score, Continue — and **Try again**, which clears it; only the latest check is saved and shown to facilitators. A quiz whose questions were changed after the learner checked counts as not checked again.
- D37 holds: nothing is saved before the course's saved progress has loaded and been merged; an answer chosen while it loads wins over the saved one; a retake made meanwhile wins over an older saved check. A page from before the release keeps sending the old empty slots, which the server ignores rather than letting them wipe saved answers; anything else malformed is refused.
- Facilitators and statistics count a quick check only once it is checked, scored against the questions the quiz has now.

### D50 · Progress is counted against each course's own lessons
**Decided**: 13 October 2026 · *Decider: SENIC (build decision, plan §4)*
- A course's progress is its completed lessons out of the lessons it actually has: seven for built-in courses, four narrative lessons plus the interactive ones an editor added for created courses — the same list the player plays. Used by the dashboard, "Your journey", the facilitator's view and the statistics (`src/lib/course-progress.ts`).
- A completed course is 100% with every step ticked, even if a lesson was added after the learner finished. Completed steps a course no longer has don't count. A course that can't be resolved counts as the full seven.

### D51 · A blank translation counts as not written
**Decided**: 13 October 2026 · *Decider: SENIC (build decision, plan §4)*
- Text that is empty or only spaces is treated as missing wherever a created course's text is chosen for learners: field by field for exercises and titles, title/subtitle/blocks for lessons, the course title and subtitle. Learners get the English, then the first language written, never a blank.
- The publishing warnings count a language version with no non-blank text as not written; a partly written one (say, a German title with an empty body) counts as written, and learners get the English body under the German title. The lesson editor says which language it shows when the lesson isn't written in the one being edited.

### D52 · Unfinished exercises are saved as drafts; "Save stage" stays checked
**Decided**: 13 October 2026 · *Decider: SENIC principal (partners' change request: save unfinished exercises); rules: SENIC (build decision)*
- An editor can always **save a draft** of a practice, scenario or quick check (`Lesson.structureDraft`, a separate column); learners only ever get `Lesson.structure`, written by **Save stage**, which still requires a complete exercise and clears the draft. On a published course *Save stage* goes live at once, as before.
- *Save stage* also refuses an exercise learners could get stuck in: a scenario choice with follow-ups needs the follow-up question and each follow-up's text and outcome; quick-check answers can't be blank. The reasons name the choice, question and box, in the editor's language.
- Every exercise write (draft, stage, discard, remove) sends the stage and draft the editor started from; if either changed meanwhile, the write is refused, so a colleague's translation or draft is never overwritten unseen.
- Size limits (titles 200 characters, texts 2,000; 10 options, 8 choices, 6 follow-ups, 20 questions, 8 answers) are **refused, not cut**, like D36. What was stored before the limits may stay as it is — only growth is refused — so no live exercise becomes unsaveable.

### D53 · Who counts as a learner
**Decided**: 13 October 2026 · *Decider: SENIC (build decision, plan §4 "staff no longer turned into learners")*
- A learner role is given automatically only to a signed-in person with **no role at all** in the project (new people; someone whose roles were all removed). Staff are never given one.
- For everything that lists, counts, analyses or writes about learners — the facilitator roster, the admin *Learners* figure, statistics, "learners enrolled", facilitator notes and validations — a learner is someone with the learner role and **no staff role** (facilitator, admin, content editor) in the project. One rule, in `src/lib/learner-scope.ts`.
- Nothing is deleted: staff who were given the learner role before this release keep it in the database and on the People screen, where an admin can remove it. Every learner feature still works for staff (they need a sign-in, not a learner role).
- Facilitator notes and validations: written only by a facilitator or admin of the project, about a learner of the project by this rule, never about themselves; refused otherwise (fail closed). Organisation and cohort scoping stays with the partner-separation work in the plan (D25's open sub-decision).

### D54 · Every course created in the platform has its badge
**Decided**: 13 October 2026 · *Decider: SENIC (build decision, plan §4)*
- A course gets its badge (`Badge` row, slug `<course slug>-complete`, named after the course) when it is created. Courses created before this release got one from a migration, which also awarded it to everyone who had finished.
- Because the old version keeps serving while a new one builds, the same idempotent backfill also runs on **every deploy**, after the migrations (`prisma/backfill-course-badges.mjs`, reading the migration's own SQL), and publishing, rewording or finishing a course that still has no badge gives it one on the spot.
- The badge row's name is in one language (English, else the first written); learners see badge names from the course's own copy in their language.

### D55 · Quick links in lesson text (amends D36)
**Decided**: 13 October 2026 · *Decider: SENIC principal (partners' change request: links in lessons); rules: SENIC (build decision)*
- Web addresses with `https://` or `http://` and email addresses (bare or `mailto:`) typed in lesson text become links **when the page is drawn**; nothing stored changes, and the editor keeps plain text. Only http(s) and mailto are ever linked — never `javascript:`, `data:` or anything else — and addresses with a user name or password are left as text.
- Links open in a new tab with `rel="noopener noreferrer"` and a spoken "(opens in a new tab)" in the interface language; they're underlined (not colour alone), have a solid focus ring, and long ones wrap on a 320 px phone. Text without an address renders exactly as before.
- A *Link* button in the editor is a later release.

### D56 · Lessons and their content: the main content never moves (amends D33, D36, D52)
**Decided**: 13 October 2026 · *Decider: SENIC principal ("Start Release 1", plan §3–4); design: SENIC (build decision)*
- A lesson's main content stays where it is today: text in `Lesson.narrative`, exercises in `Lesson.structure` / `Lesson.structureDraft`, edited by the same editors and actions. Two nullable columns are added, nothing is copied or backfilled.
- `Course.outline` holds what the editor arranges: lesson order, hidden lessons, step names per language, lessons added in Release 1, and standard lessons that were deleted. Empty means today's layout, worked out exactly as before.
- `Lesson.parts` holds only a lesson's extra content (text, practice, scenario, quick check, own reflection questions, 1–5 self-assessment) around a `main` placeholder; a lesson with only its main content stores nothing.
- Ids are made on the server: standard lessons keep their keys, new lessons get `s-` plus 8 characters, extra content `p-` plus 8. `lesson id/content id` is the key Release 2 will save learners' answers under; today's enrolment columns map onto `…/main`, so no data has to move.
- Rejected: copying a course on first edit (it would freeze what learners of published courses see), writing both old and new forms (they drift apart), and converting between forms (the riskiest option for live data).

### D57 · Courses using what only Release 2 can show can't be published yet (amends D33)
**Decided**: 13 October 2026 · *Decider: SENIC principal (plan §4 safety catch); rules: SENIC (build decision)*
- A created course that uses anything the learner player can't show until Release 2 — an own lesson, a hidden or deleted standard lesson, a changed order, extra content, or an arrangement the server can't read — can be previewed but **not published**. Publishing checks this with the Course row locked and refuses with the reasons, which the course page lists; the refusal is audited.
- On a published course, every lesson or content change must not add a new reason (removing one is always allowed). Built-in courses, unpublishing and archiving are never checked.
- The build-seeded demo course is left alone once an editor has added lessons or content to it.
- Release 2 lifts this rule.

### D58 · Step names live with the course, per language
**Decided**: 13 October 2026 · *Decider: SENIC (build decision)*
- A lesson's step name is stored per language in `Course.outline`, at most 40 characters, refused rather than cut (like D36). It is never stored in the lesson text, which the lesson editor rewrites on every save.
- Step names never block publishing. In Release 1 they show on the course page, the lesson list and the editor's preview; learners, the dashboard and the facilitator view switch to them together in Release 2.

### D59 · Published courses keep their shape until Release 2 (a deliberate deviation)
**Decided**: 13 October 2026 · *Decider: SENIC (build decision); confirmation asked of the SENIC principal*
- The consortium's default is "reorder or hide on a published course, with a warning". Until Release 2 the learner player ignores the arrangement and resumes learners by count, so on a **published** course these are refused instead: reordering, hiding, adding a lesson, adding extra content or own reflection questions, and deleting a standard lesson. The controls say why. From Release 2 the consortium default applies.
- A lesson learners have — a text lesson, or an exercise saved for them — can be deleted only while the course has **no learners** (D53, on any status, counted again inside the change). The Course row is locked for the delete, which an enrolment's own check waits on, so a first enrolment can't slip in between. A lesson of the course's own, or an exercise lesson with nothing saved for learners, is nobody's yet and can always be deleted, so a course reworked while it has learners can be put back as they had it and published again.
- Removing an exercise learners have (*Remove stage*) is refused while learners are enrolled, whatever the course's status, since the course can be published again.

### D60 · The learner path is frozen in Release 1
**Decided**: 13 October 2026 · *Decider: SENIC (build decision)*
- What learners get is unchanged: the course loader, the player, its stage screens, the progress store, progress counting and the learner actions are not edited in Release 1. A test checks their file hashes and is removed on purpose in Release 2. A recorded walk through a standard created course (English and German) and a built-in course must match the Release 0 recording, also after its layout is saved as an outline with step names.
- *Preview* of a standard course gives the very same course object learners get. A draft course using new features is previewed in a separate sectioned player, which becomes the learner player in Release 2.
- Extra exercise content follows D52 item by item: a draft per item, *Save* checks it, *Save draft* always works, *Discard*, and a write is refused if a colleague changed it meanwhile. Extra text is saved per language, live, without a draft.

### D61 · Off-site backups: Scaleway (Paris), a read-only login, verified every night
**Decided**: 15 October 2026 · *Decider: SENIC principal (provider); rules: SENIC (build decision)*
- The daily off-site backup (Contract Item 2 §7) goes to **Scaleway Object Storage, Paris (`fr-par`)**: an EU company, so no third-country transfer of the learner data in the dumps; a private bucket with encryption at rest (SSE-ONE, set at creation); a key limited to one Scaleway project that can only read, write and delete objects; about €0.03 a month. Rejected: Hetzner (no encryption at rest), and US providers (Cloudflare, Backblaze, AWS) because the US CLOUD Act reaches data wherever it is stored.
- The backup reads the database with a **read-only role** made with SQL (`scripts/db-backup-role.sql`); it refuses to run with any login that can change the database, so the owner's credentials never sit in GitHub. Sign-in session and sign-in-link tokens are left out of dumps.
- Every run verifies the dump and reads the stored copy back before pruning; dumps are kept 30 days, but the newest 7 always stay. Client-side encryption with `age` is optional (public key in a repo variable, private key offline with named key holders); Neon's point-in-time window is raised from the default 1 day to 7.
- Scaleway is added to the sub-processors (DATA-PROTECTION.md §1 and §7, DPA Annex III); under the DPA (3c) the controller is informed before it processes personal data.

---

## 🟡 Open — must close before kickoff or Week 1

### O1 · Production domain — ✅ CLOSED → `seq-elevate.eu` (apex)
**Decided**: 21 August 2026 · *Decider: SENIC principal*
- Production platform is served at the **apex `seq-elevate.eu`**, with **`www.seq-elevate.eu` → redirect to apex** (Vercel wires the redirect when both are added).
- DNS: apex can't `CNAME` (DNS rule) → add Vercel's **A record** for `seq-elevate.eu`; `www` gets a `CNAME`. `AUTH_URL=https://seq-elevate.eu` (pins host detection + magic-link base). Email (`no-reply@seq-elevate.eu`, SPF/DKIM/MX) is on different record types and is unaffected by the A record.
- ⚠️ **Name check — hyphen vs no-hyphen**: earlier notes (D4, this item's old options) referenced the brand/marketing site as **`seqelevate.eu`** (no hyphen). The domain set up for the platform is **`seq-elevate.eu`** (with hyphen). Confirm these are intentional — if the brand lives on the no-hyphen domain, the hyphenated platform URL could split the brand / confuse learners. Proceeding with `seq-elevate.eu` as instructed; reconcile with the consortium.
- Supersedes the interim staging plan of keeping the app on `senic.world` (D3/D10).

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

### D16 · Demo access — one-click profiles (staging only)
**Decided**: 15 June 2026 · *Decider: client (SENIC principal)*
- `/[locale]/demo` lets a client sign in with one click as a demo profile (Stefan = Admin+Content-Editor, Demo Editor, Demo Teacher, Demo Learner) — bypassing the magic-link email so testers can explore each role on the staging/showcase site.
- Provisions the `User` + `Membership` rows on first use; `stefan@senic.org` also gets editor roles on a normal magic-link login (auth `signIn` event).
- **Code-gated** (`DEMO_ACCESS_CODE`, default `elevate-demo`) and **kill-switchable** (`DEMO_LOGIN_DISABLED=true`).
- ⚠️ **Production action**: this is a deliberate convenience for the showcase deploy with placeholder data. It is effectively a one-click admin login behind a shared code — **set `DEMO_LOGIN_DISABLED=true` on the real production domain** (and rely on magic-link there). Open item until production go-live.

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
- **✅ EU data residency — already in place (verified 2026-06 via the Vercel dashboard)**: the Blob store **`seq-elevate-demo-blob` is region `FRA1` (Frankfurt / AWS eu-central-1, Germany)**, created 15 June. So uploads already reside in the EU — **no new store, no migration**. (An earlier note in this decision mis-stated "US-default"; that predated the store's creation and was corrected against the live dashboard.)
  - **Note**: Blob content is **staff-authored course material** (lesson videos/documents), not learner-uploaded personal data — learners upload nothing. Access is `public` with unguessable random-suffix URLs, appropriate for teaching material. If future content is learner-identifiable, a `private` store (access mode is also set at creation) plus authenticated serving is a small additive change.
  - Vercel Inc. is a US company, so keep Vercel's DPA/SCCs on file; the data itself resides in Germany.
  - **For a separate real-production project later**: create its Blob store in `fra1` as well (region can't be changed after creation), and confirm it's **connected to the project** so `BLOB_READ_WRITE_TOKEN` is set.

### D17 · Course lifecycle lives in the DB, not in code
**Decided**: 16 June 2026 · *Decider: SENIC (build decision)*
- `Course.status` is the **authority** on what learners can see. The bundled provider hardcoded `"published"`; a DB overlay now applies the real status, so editors publish/unpublish without a developer.
- A draft is a **404 for learners**, not merely hidden from the dashboard — deep links are not a back door. Editors preview drafts behind a "Draft preview" banner.
- Courses **created in the CMS** carry their per-locale copy in `Course.meta` (migration `course_meta`) and their teaching text in the existing `Lesson.narrative` rows. Bundled courses are unaffected and keep using the message catalogue.
- **Scope, deliberate**: a CMS-created course ships the four *narrative* stages (context → concept → behaviour → reflection). Simulations, branching scenarios and assessments still require the **interactive structure editor** (see roadmap) and are omitted rather than faked — the authoring UI states this to the editor.
- Consistent with D14 (hybrid CMS: DB now, Strapi later). If Strapi arrives, the status overlay and the DB-course builder are the two seams to revisit.

### D18 · Failure direction for the catalogue: fail open
**Decided**: 16 June 2026 · *Decider: SENIC (build decision)*
- If the database is unreachable, or a `status` value is unrecognised, the catalogue **falls back to showing the course** rather than hiding it. An unexplained empty dashboard is a worse failure for a NEET learner than a course that shouldn't have been listed for a few minutes.
- Consequence, accepted and mitigated: because every DB read on this path is caught, a missing migration would look identical to "nothing created yet". `/dev/cms-check` therefore **reports the error instead of swallowing it**, so a deploy can be verified rather than assumed.

### D19 · Comp Card fields are editable copy, fixed structure
**Decided**: 16 June 2026 · *Decider: SENIC (build decision)*
- Content editors **reword, reorder and hide** the Comp Card questions per language (`Project.compCardTemplate`), so the reflection instrument adapts to each cohort without a developer.
- The **field keys are fixed** — each maps to a column on the `CompCard` table (`wentWell`, `difficult`, `improve`, `behaviour`, `confidence`). Adding a genuinely new field is a **schema change**, not a content change, and the editor UI says so rather than offering a control that would silently fail to store answers.
- The override is untrusted JSON in a DB column, so unknown keys are dropped on read and existing learner answers are never touched by the template.
- Consistency guarantee: the form **and** the printable/exported Comp Card read the same template, so wording/order/visibility match between what a learner fills in and what they take away.

### D20 · Interactive structure: correctness is language-neutral, text is per-locale
**Decided**: 16 June 2026 · *Decider: SENIC (build decision)*
- CMS-created courses author their **simulation / branching scenario / assessment** stages in the DB (`Lesson.structure`), so a course can be built end-to-end without code.
- The **structural facts** — which option is best, a branch's quality, an assessment's correct answer — are stored **once, language-neutral**. Only the human text is per-locale `{ en, de, el }` with fallback. Rationale: if correctness could differ between languages, a translation slip would mis-grade a whole cohort. This deliberately mirrors the bundled model (structure in code, text in messages), not the narrative overlay (independent per-locale copies).
- `validateStructure` gates saving (≥2 options, exactly one best, the correct id must be a real option, text in ≥1 language), so a published CMS course's interactive stages are always coherent — no separate publish-time gate needed.
- **Still bundled-only**: the reflection stage of a CMS course uses generic default journaling prompts (the interactive three are fully authorable). A dedicated reflection-prompt editor is a future nicety, not a gap.

### D21 · The demo CMS course is build-seeded, not hand-authored
**Decided**: 16 June 2026 · *Decider: SENIC (build decision)*
- The client-facing demo course (`demo-speaking-up`) is seeded by `prisma/seed-demo.mjs` during the Vercel build, not clicked in by hand. Rationale: it runs in Vercel's environment (so the Neon credential is never handled outside Vercel), it's idempotent (redeploys refresh it, never duplicate), and it's reviewable code rather than an unreproducible manual artifact.
- Gated by `DEMO_LOGIN_DISABLED=true` (the D16 kill-switch): present on the demo deploy, absent on real prod — so the demo course appears exactly where demo sign-in does and nowhere else.
- The course is authored in English; DE/EL render via the resolver's fallback until translated, which conveniently demonstrates the platform's graceful per-language fallback to clients.

---

## 📝 Notes & change requests

*Anything that arises during the build that doesn't fit a clean decision goes here. Add a date stamp.*

- **13 June 2026** — Consortium kickoff scheduled for 25–26 June 2026, giving ~2 weeks of "Week 0" prep before the contractual 5-week clock starts. SENIC uses this window to stage all infrastructure-only work (auth, DB, CMS, deploy, observability) so kickoff opens with a live staging URL.

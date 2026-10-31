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
  - *Amended by D104 and D106 (Release 4, decided 21 October 2026): named links in paragraphs, key messages, reflection introductions and the references list, made with the Link button and kept when pasted; a text that holds a link is stored as version 2.*
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
- *As built (24 October, Release 3; decided by the integrator):* the 13 October gap is closed by a keepalive route. When the page is left (`pagehide`), what it has of each course with a save on its way or failed that the server hasn't confirmed — every answer a save on its way carries counted as not confirmed, as the page has it — is sent outside Next's queue too, to `POST /api/progress/beacon` with `fetch(keepalive)`, which the browser finishes after the page has gone (`progressBeacons` in `src/store/course-save.ts`; at most 48 KiB, every course together). The route saves it through the save action's own code (`saveCourseProgressPatch`): the signed-in learner from the session cookie, the learner the save was made for, the course in the project, the patch's limits and per-answer refusals, the merge under its locks, never audited. Before that it takes only a POST from this site's own pages (`Sec-Fetch-Site` same-origin and this site's `Origin`, whichever the browser sends, and at least one), a JSON body of at most 64 KiB, and someone signed in whose profile step is done (D79). A save that also arrives through the queue writes the same values: the answers as the page has them, finished lessons and the completion only growing, the first completion date and one badge.
- *Decided by the integrator (24 October 2026, (a) and (b)), as built:* Release 2 keeps the 13 October rule for course and Comp Card saves as a known limit (it is live 10–20 November for staff and test accounts only), and Release 3 closes the gap for the Comp Card too, before the pilot. When the page is left (`pagehide`) while a Comp Card save is on its way or failed, the fields of the card the server hasn't confirmed — every field a save on its way carries counted as not confirmed, as the page has it; never a field the page didn't change, never who sees the card, never a text over 2,000 characters — are sent to `POST /api/progress/beacon` as `{ v: 1, forUser, card }` with `fetch(keepalive)` (`cardBeacon` in `src/store/card-save.ts`), before the courses' and within the same 48 KiB. The route takes it with the same checks as a course save, and saves it through the card's save action (`saveCompCard`): the signed-in learner, the learner the save was made for, the profile step done (D79), only the fields sent written, a text over 2,000 characters refused whole, who sees the card never changed (D80: saving never shares), never audited. A body is a course's save or the card's, never both. The same fields arriving through the queue too write the same values. The card has no outbox (D68).
- *Decided by the integrator (24 October 2026, (d)):* after this round, a case on the save path goes to the known limits in the build log, not into another change, unless it loses a learner's data with one browser, one tab and a normal network, with no special timing.

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
- *Amended by D103–D106 (Release 4, decided 21 October 2026):* a typed address is a quick link exactly when the one address check takes it (an email link with at most a subject), quick links are found only in text outside a named link, and the Link button is D106's.

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
- *Replaced by D66 from the Release 2 deploy (Tue 10 November 2026).*

### D58 · Step names live with the course, per language
**Decided**: 13 October 2026 · *Decider: SENIC (build decision)*
- A lesson's step name is stored per language in `Course.outline`, at most 40 characters, refused rather than cut (like D36). It is never stored in the lesson text, which the lesson editor rewrites on every save.
- Step names never block publishing. In Release 1 they show on the course page, the lesson list and the editor's preview; learners, the dashboard and the facilitator view switch to them together in Release 2.

### D59 · Published courses keep their shape until Release 2 (a deliberate deviation)
**Decided**: 13 October 2026 · *Decider: SENIC (build decision); confirmation asked of the SENIC principal*
- The consortium's default is "reorder or hide on a published course, with a warning". Until Release 2 the learner player ignores the arrangement and resumes learners by count, so on a **published** course these are refused instead: reordering, hiding, adding a lesson, adding extra content or own reflection questions, and deleting a standard lesson. The controls say why. From Release 2 the consortium default applies.
- A lesson learners have — a text lesson, or an exercise saved for them — can be deleted only while the course has **no learners** (D53, on any status, counted again inside the change). The Course row is locked for the delete, which an enrolment's own check waits on, so a first enrolment can't slip in between. A lesson of the course's own, or an exercise lesson with nothing saved for learners, is nobody's yet and can always be deleted, so a course reworked while it has learners can be put back as they had it and published again.
- Removing an exercise learners have (*Remove stage*) is refused while learners are enrolled, whatever the course's status, since the course can be published again.
- *Replaced by D66 from the Release 2 deploy (Tue 10 November 2026).*

### D60 · The learner path is frozen in Release 1
**Decided**: 13 October 2026 · *Decider: SENIC (build decision)*
- What learners get is unchanged: the course loader, the player, its stage screens, the progress store, progress counting and the learner actions are not edited in Release 1. A test checks their file hashes and is removed on purpose in Release 2. A recorded walk through a standard created course (English and German) and a built-in course must match the Release 0 recording, also after its layout is saved as an outline with step names.
- *Preview* of a standard course gives the very same course object learners get. A draft course using new features is previewed in a separate sectioned player, which becomes the learner player in Release 2.
- Extra exercise content follows D52 item by item: a draft per item, *Save* checks it, *Save draft* always works, *Discard*, and a write is refused if a colleague changed it meanwhile. Extra text is saved per language, live, without a draft.
- *The freeze is lifted in Release 2 (D63).*

### D61 · Off-site backups: Scaleway (Paris), a read-only login, verified every night
**Decided**: 15 October 2026 · *Decider: SENIC principal (provider); rules: SENIC (build decision)*
- The daily off-site backup (Contract Item 2 §7) goes to **Scaleway Object Storage, Paris (`fr-par`)**: an EU company, so no third-country transfer of the learner data in the dumps; a private bucket with encryption at rest (SSE-ONE, set at creation); a key limited to one Scaleway project that can only read, write and delete objects; about €0.03 a month. Rejected: Hetzner (no encryption at rest), and US providers (Cloudflare, Backblaze, AWS) because the US CLOUD Act reaches data wherever it is stored.
- The backup reads the database with a **read-only role** made with SQL (`scripts/db-backup-role.sql`); it refuses to run with any login that can change the database, so the owner's credentials never sit in GitHub. Sign-in session and sign-in-link tokens are left out of dumps.
- Every run verifies the dump and reads the stored copy back before pruning; dumps are kept 30 days, but the newest 7 always stay. Client-side encryption with `age` is optional (public key in a repo variable, private key offline with named key holders); Neon's point-in-time window is raised from the default 1 day to 7.
- Scaleway is added to the sub-processors (DATA-PROTECTION.md §1 and §7, DPA Annex III); under the DPA (3c) the controller is informed before it processes personal data.

### D62 · A learner's answers and progress, per lesson and per item (amends D37, D49, D56)
**Decided**: 20 October 2026 · *Decider: SENIC principal ("Start Release 2", spec §8; owner defaults §8.10); rules: SENIC (build decision)*
- **One home for each answer.** Two nullable JSON columns on the enrolment: `sectionsCompleted` (lessons of the course's own the learner finished) and `responses` (every answer that has no column of its own, by `lesson id/content id`). The four standard answers — practice, scenario, the three standard reflection questions and the quick check of the standard lessons (`…/main`) — stay in their Release 1 columns, so older readers keep working and no answer is ever stored twice (D56). No default, no backfill, no index (migration `20261021120000_enrollment_sections_responses`). A standard course writes nothing new: its two new columns stay empty.
- **Saves are patches, merged on the server.** The page sends only what changed since the last save the server confirmed, worked out when the save is sent, not when it was scheduled. The server merges it under a lock on the Course row (`KEY SHARE`, or `FOR UPDATE` taken first when the save creates the course's badge, so two learners finishing together can't deadlock) and then on the enrolment row (`FOR UPDATE`); never a Lesson row. Reflection and self-assessment answers merge question by question; practice, scenario and quick check replace the whole answer (D49: the latest check counts). A save that changes nothing writes nothing, so "last active" doesn't move. *Reason:* Release 1's whole-row save let a stale tab un-complete a course or overwrite answers given in another tab.
- **Progress only grows.** Finished lessons and the completion date never shrink: in the code, and through a database trigger on the two columns older builds write (`stagesCompleted`, `completedAt`), so an old tab or a rolled-back build can't take a completion back. *Cost:* resetting a learner's progress means deleting the enrolment (Release 3's reset).
- **Refused per answer, never cut, and the learner is told.** An answer over a limit (5,000 characters per reflection question; ids of 100 characters; 10 questions, 12 statements, 100 quiz answers per item; 1,000,000 characters of stored answers and 500 finished lessons of the course's own per enrolment) is refused for that answer only, and the rest of the save goes through. A note under the item says it couldn't be saved; a reflection answer over 5,000 characters says so as it is typed and isn't sent until it is shorter.
- **The old save action is kept** under its name (`saveCourseProgress`), for pages loaded before the deploy: it keeps only the standard lessons (it can never write a lesson of the course's own into the standard-lesson column), unions them with what is stored, keeps any stored completion and never touches the new columns. The store names it once so the build keeps it. It goes only after the pilot, by a decision of its own.
- **Course status.** A learner's save is not stopped by the course's status: a learner whose course is unpublished mid-session keeps their answers. *Amended in the build:* a save never **creates** an enrolment in a course that was never published (not published and no publish date) — under D67 one stray learner would freeze a draft's lessons; to a learner such a course doesn't exist. A learner already enrolled keeps saving whatever the status.
- **Not audited**, as learner saves never were: the audit log has no precedent for them, and its rows outlive account erasure.
- *As built:* the badge written by the save that completes a course and by the completion screen at the same moment is inserted only if missing (`INSERT … ON CONFLICT DO NOTHING`), so neither write fails. A save waiting for one course is now sent at once when another course's save is scheduled, instead of being dropped (`pending-save.ts`).
- *As built (23 October):* what a save sends isn't known on the server until that save is confirmed: it may still be written while it is on its way, and one that fails (a dropped connection) may have been. An answer a save on its way carries that the page has changed since, and an answer whose save failed — until a save of it is confirmed or the course loads again — is sent as the page has it, so an answer changed back to what the server was known to hold is saved. A save that fails once the page has changed since it was worked out is followed by another if something is left; failing with the page unchanged, it is tried again (1, 2, 4, 8 s) and then left until the next change. The outbox (D68) keeps, beside such an answer, what the server holds if the failed save was written, and brings the answer back over either. A refused answer that comes back unchanged isn't sent again, and the learner is told again.

### D63 · One learner player; each lesson drawn by its Release 1 screen or the sectioned view (supersedes D60)
**Decided**: 20 October 2026 · *Decider: SENIC principal (spec §8; owner default 1, "exactly as today"); rules: SENIC (build decision)*
- **One player for every course.** Lessons come in the course's order; hidden lessons and lessons with nothing to show are left out; step names (D58) appear in the step bar, Back and the counter (now also on phones). A standard lesson with only its main content keeps its Release 1 stage screen; a lesson of the course's own, or any lesson with extra content, is drawn by the sectioned view (the Release 1 preview's, now store-backed). Hiding or reordering never changes how a lesson is drawn; extra content added to a live standard lesson switches only that lesson, and its answer keeps its key. A course with no lesson to show says so and never completes or gives a badge.
- **Preview is the learner player** for every course and status, with nothing saved, so an editor sees what learners get. Only preview opens a given lesson (`?lesson=`). The Release 1 sectioned preview player and its course loader are deleted.
- **"Exactly as today"** for built-in and standard courses: the same lessons, order, titles, content, saved answers, position, progress, completion and badges, with the markup differing only by a closed list that the recorded walk checks against the Release 0 recording: Continue shown before an answer (D1), a done step named "<name>, done" (D2), reflection boxes named by their question (D3), practice options saying which one is chosen (D4) and, once renamed, the steps' names (D5).
- *As built:* because D2 renames the done step, one look-up in a never-lost test was changed from "Context" to "Context, done", and those tests now recognise a save by its new body (a patch); no assertion changed. Both were accepted at integration. The learner page's footer, which belongs to no stream, was fixed so that the whole page passes axe at 320 px: its legal links are 24 px targets and their landmark is named in the page's language.
- **Kill switch** `R2_LEARNER_PLAYER=off`: learners and preview get exactly the Release 1 learner view of every course, counting follows, saves continue, and publishing goes back to Release 1's rules. *Amended in the build:* under the switch, a created course whose lessons that view doesn't hold (say, only lessons of its own) is completed only once the learner has done every lesson of its Release 2 plan, so the switch can't hand out a completion and badge for standard lessons the course doesn't have. A Vercel rollback to Release 1 can't be guarded in code; GO-LIVE.md says what to do first.
- D60's freeze test is removed on purpose; the recordings are pinned by SHA-256 instead (Release 0's, and Release 2's own walk through a course as built).
- *Reason:* hiding or reordering never changes how a lesson looks; built-in courses never touch new code; one path handles navigation, resume and telemetry; "today's stage components are reused per block" (plan).

### D64 · The lessons learners get, and how progress counts them (amends D50)
**Decided**: 20 October 2026 · *Decider: SENIC principal (spec §8; owner default 5); rules: SENIC (build decision)*
- **One lesson plan** feeds the player, the dashboard bars and "Your journey", the facilitator view, the statistics, the course page and publishing, with one rule for "has something to show". A golden test keeps the player's lessons equal to the plan for every kind of course, in English, German and Greek; every standard course gets exactly its Release 1 lessons.
- **Progress** is the finished lessons out of the lessons learners get now, plus finished lessons no longer shown (hidden, or emptied): hiding never lowers anyone's percentage. A completed course stays at 100% (D50). Progress drops only when a lesson is added or shown again for a learner still in progress (the editor confirms this with the count, D66), or when an empty lesson of the course's own gets content (a content edit, D33; known limit). A course left with no lesson to show is never "complete" for a learner who didn't complete it.
- **Where it shows:** "Your journey" uses the course's step names, with one line for finished lessons no longer in the course; the dashboard's main card is the course the learner was last busy in, else the first published course. The facilitator's *Currently on* shows the step name, and time per lesson is the seven standard rows plus *Other lessons*, adding up to the time on task. Statistics add an *Other lessons* funnel bar, table entry and time column for learners on a course's own lessons, and the funnel keeps a learner on the steps they finished. A step name written only in another language carries its `lang`.
- *Reason:* the player and the reports can't disagree, and hiding never lowers progress.

### D65 · Resume, order and Continue (Q4)
**Decided**: 20 October 2026 · *Decider: SENIC principal (spec §8, Q4; owner default 8); rules: SENIC (build decision)*
- **Resume** at the first lesson learners get that isn't done. A signed-in learner's page arrives already there (the position comes from the server), then checks once when their progress has loaded; that check never moves a learner who has already done something. All lessons done but the course not completed opens the last lesson, never an automatic completion. A lesson not done that sits before done ones says "You haven't done this lesson yet. It's new, or it has moved." (the spec's "added after you started" was wrong for a lesson that was only moved).
- **In order, can go back:** the step bar reaches only up to the first lesson not done (a done lesson moved past it is ticked but can't be opened); Back always works; the last Continue goes to a lesson still to do and says so on the screen.
- **Continue is always shown**, with a hint above it saying what it waits for. Pressed with something missing, it names the item and what it needs, marks it, puts focus on the exact place (the question, a scenario's follow-up, a quick check's first unanswered question or *Check answers*) and scrolls only as far as needed, below the sticky header — instantly with reduced motion. Text, reflection and self-assessment never block.
- **Answers come back:** practice and scenario answers are restored on Back and on reload. *Try another* and *Try different choices* work on screen only: the saved answer and the facilitator's result stay until a new answer is given.
- *Reason:* learners carry on where they stopped, can't skip ahead past what they haven't done, and always know what Continue waits for (requirement 4, WCAG 2.2 AA).

### D66 · Publishing and changing courses with learners (replaces D57 and D59; Q6, Q7)
**Decided**: 20 October 2026 · *Decider: SENIC principal (spec §8; owner default 3); rules: SENIC (build decision)*
- **Publishing** is refused only when the lesson list or a lesson's content can't be read, or when no lesson would be shown; the refusal is audited. A course with its own lessons, a new order, hidden or deleted standard lessons or extra content publishes as built.
- **On a course with learners** (D53, counted under the Course row lock): adding, moving, hiding or showing a lesson, adding or moving content and removing text need a confirmation the server checks. The page says how many learners are taking the course (and how many finished) and what happens to them; a page that didn't know asks first with the server's numbers. Confirmed changes are audited with `{learners, confirmed}`. Renames, text and question edits, video and documents stay live at once (D33).
- **Delete:** refused on a published course with learners (Hide is offered where hiding is possible); on an unpublished course with learners, allowed only when no learner has anything in that lesson. A question learners get can't be removed while the course has learners (it can still be edited); *Remove stage* is refused with learners, lessons of the course's own included. Hiding or deleting the only lesson learners see on a published course is refused.
- *As built:* the *Add guided practice / applied scenario / quick check* slot, whose first *Save stage* adds the lesson, is held to *Add lesson*'s rules (the limit, the confirmation, the cut-off). Removing the only content of a lesson is allowed; its confirmation says the lesson leaves learners' course until it has content again.
- **Q7:** at most 15 lessons, hidden ones included; the warning comes when learners would see more than 12.
- What happens to learners mid-course follows spec §7.4 (reorder, hide, add, show, new content). Kill switches: `R2_PUBLISH_GUARD=on` re-applies Release 1's publish rules without touching the player; `R2_LEARNER_PLAYER=off` (D63) does too.

### D67 · No restructuring of courses with learners from 1 December (Q6)
**Decided**: 20 October 2026 · *Decider: SENIC principal (spec §8; owner default 4); scope widened in the build under the owner's standing instruction*
- From `2026-12-01T00:00+01:00` (`RESTRUCTURE_CLOSED_FROM`: an ISO date, or `off`; an invalid value means the default and one log line), adding, moving and removing lessons and content is refused with the date on **any course with learners, published or not**. The spec named published courses only; that let an editor unpublish, restructure with a confirmation and publish again. Deleting a lesson nobody has anything in, on an unpublished course with learners, closes too.
- Hide and Show (asking first), renames, text and question edits, video and documents stay open. A course nobody has started is never closed.
- *Reason:* enforced, because process alone failed once (plan §7 risk). If late it could have moved to Release 3 (20 Nov); it shipped in Release 2.

### D68 · A deploy doesn't drop learners' saves
**Decided**: 20 October 2026 · *Decider: SENIC principal (spec §8; owner action §8.10.11); rules: SENIC (build decision)*
- The owner sets `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` for Production by Fri 23 October, in a quiet redeploy of its own before Release 2, so a server action keeps its id from one build to the next. Action exports keep their names.
- A save answered "unknown action" (a page from an older build) is kept in a per-tab outbox in the browser (`sessionStorage`, per learner and course) and the page shows "A new version is available…" with a *Reload* button. After the reload the outbox is applied as the learner's own changes and cleared once nothing is left to send.
- *As built:* the outbox **replaces** what it held with everything not yet confirmed at the moment of failure, rather than merging (merging brought old answers back). Each entry keeps what the server held of each answer when it was kept, and an answer comes back only while the server still holds that, so an answer saved elsewhere meanwhile wins; finished lessons and the completion always come back. Signing out, or another account signing in, clears every outbox entry of the tab: privacy over the narrow case of a page from a gone build whose learner signs out before reloading.
- *As built (23 October):* a page hidden or left (`pagehide`; `visibilitychange` to hidden, after which a phone may discard the tab) with a course save on its way, or one that failed, keeps what the server hasn't confirmed in the tab's outbox too: Next sends a page's server actions one at a time, so a save may wait behind another and never leave a page that goes, and the one on its way may be written with its answer reaching no page. Every answer a save on its way carries counts as not confirmed. Beside each answer the entry keeps what the server held and each value a save not confirmed may have left there (at most eight), and the answer comes back over any of them. While there is an entry it follows what is confirmed, and it is cleared once nothing the server would take is left and no save is on its way.
- *As built (24 October):* signing out from the page first sends every course and Comp Card save still waiting and waits for them, and for the save on its way, up to 3 s (`src/store/sign-out.ts`); then it signs out, and every outbox entry of the tab is cleared before the session ends. The page that goes then keeps nothing in the tab, and once the store has let go of a learner (signed out here or in another tab, another account signed in) a save's late answer keeps nothing of theirs either.
- *Reason:* action ids are salted with a key that changes with every build, and a save that keeps failing was dropped after four retries.
- *As built (Release 3, D79):* a course's progress sent in fill mode (only what the account lacks) is taken only from Release 2 pages still open after the deploy. Release 3's "Add it to my account" doesn't use it.

### D69 · Guests keep one course in this browser (Release 2)
**Decided**: 20 October 2026 · *Decider: SENIC principal (spec §8; owner default 6)*
- Within that course a guest gets per-lesson and per-item answers, restore and resume, as a signed-in learner does.
- On sign-in the course moves into the account only when the account has no progress in it, and only fills what the account lacks; when the course then loads, the account's answers come first (D37: the account wins).
- *As built:* "Add it to my account" applies this per part in one server transaction (D79): the course moves whole, only into an account with no progress in it; an account that already holds all of it says so; any other keeps its own, and the course stays in the browser. What a tab still a guest saved in it while it was being added stays in the browser too. Fill mode, a builder's default of 22 October, was withdrawn before confirmation.
- *Reason:* pilot learners sign in (Release 3's sign-up step); a guest store of several courses needs other fixes first.

### D70 · Scope notes for Release 2
**Decided**: 20 October 2026 · *Decider: SENIC principal (spec §8; owner default 2); "Active in the last 24h" settled in the build under the owner's standing instruction*
- **Comp Card completion:** Release 2 saves everything the per-course Comp Card sections need (Dec–Jan) and adds no display.
- The facilitator's quick-check and practice scores and the Comp Card evidence read the standard lessons' answers (`…/main`) only.
- Statistics stay per learner on their latest enrolment until Release 3; figures for each lesson of a course's own come after launch.
- Q9 ("start from the full template") was already built; Release 2 adds a test that its empty exercise lessons aren't shown to learners.
- **"Active in the last 24h"** on *Support learners* now counts learners whose *Last active* is within the 24 hours before the page was made, by the server's clock. Release 1 counted everyone with any progress at all under that label. Statistics' *Last seen* also counts opening a course, so the two can differ. The staff guide says so.

### D71 · How Release 3 is built and shipped
**Decided**: 21 October 2026 · *Decider: SENIC principal ("Start Release 3", Release 3 spec §16; owner confirmation 1, default applied)*
- `r2` merged `main` once before `r3` was branched (`f02ef9e`). Only the integrator merges `r2` (until 10 Nov) or `main` (after) into `r3`, at fixed points; nothing goes from `r3` into `r2`. `r3` reaches `main` on Fri 20 Nov, after Release 2 has been live for at least 8 days; if Release 2 slips, Release 3 slips by as many days.
- `main` is frozen from Mon 16 Nov except for emergency fixes, each merged into `r3` the same day. What deploys is the commit that passed the release check and the rehearsal (or a merge of it, tested again).
- `r3` is not pushed before the deploy merge (D100). Its previews are deployed from the local worktree with the Vercel CLI, with the database given explicitly.
- Migrations are additive and named `20261120…`.
- *As built:* four migrations, not two. `20261120090000_r3_role_partner_admin` (the new role); `20261120090100_r3_people_privacy_content` (one explicit transaction, `lock_timeout` 5 s, so a failure leaves nothing of it); `20261120090200_r3_course_project_columns` (`Course.readyLocales`, `Project.safeguarding`, one statement each, split out so no migration locks the Project or Course table together with User); `20261120090300_r3_sharing_and_guardian_triggers` (two triggers, D80 and D101, added at integration). `migrate-deploy.mjs` names a failed migration and says whether it applied nothing or may be partly applied (GO-LIVE §1a).
- *As built:* `r2` was merged into `r3` at `983be2d` on 22 Oct (Release 2 verified, with `main`'s session rule, the same as D97). The merge of `main` on 11 Nov and the last merge point on 19 Nov are still to come.
- *As built:* `r2` was merged into `r3` again at `491e5a5` on 23 Oct (`152e7bb`): Release 2's course save rule (D62's 23 October line), with Release 3's read again after guest work moved into a course kept as it was.
- *As built:* `r2` was merged into `r3` again at `828e647` on 23 Oct (`a630a94`): what a page hidden or left keeps of a course save on its way (D68's 23 October line), with Release 3's read again after guest work moved into a course kept as it was.
- *As built:* `r2` was merged into `r3` again at `919063a` on 24 Oct (`296ef63`): signing out sends the course and Comp Card saves waiting first, and keeps nothing of the learner in the tab (D68's 24 October line).
- *As built:* `r2` was merged into `r3` again at `b883ac5` on 24 Oct (`12482f2`): Release 2 keeps D37's 13 October rule for course and Comp Card saves as a known limit (the integrator's decision (a), D37's 24 October lines).
- *As built:* `r2` was merged into `r3` again at `67466b0` on 27 Oct: a staff page's access notice offers a visitor who is signed out the way to sign in, back to the page, in the notice's language (English, marked so, on Release 3's English-only staff notices, D99); a guest whose browser holds nothing of theirs yet is welcomed, not welcomed back.
- *Changed by the owner (21 Oct):* Release 4 started on 21 Oct on branches of its own, not after 13 Nov. It asks nothing of Release 3 and rebases on `r3`; it follows D100 too.

### D72 · One profile row per person per project
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16)*
- `ProjectProfile` holds the person's country, organisation, the profile step's answers and the test-account mark. It is the only thing scoping reads. `Membership.organisationId` stays in the schema but is no longer written or read for access.
- *As built:* migration B fills the profile of everyone who held a membership, from the organisation their memberships agreed on. A profile records where its organisation came from (`organisationSource`: `admin`, `partner-admin`, `country`, `backfill` or `released`).
- *Reason:* one row says who belongs where, whatever roles a person holds or loses.

### D73 · Country → organisation is data
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16); consortium default Q24 (answers due 27 Oct; the built default applies until then)*
- `CountryMapping` maps each country (Germany, Cyprus, Belgium, Greece, Other) to one organisation. An ADMIN sets it on Organisations & cohorts. The default is Q24's: Germany → Pro Arbeit, Cyprus → Synthesis, Greece → University of Macedonia, Belgium and Other → DIESIS.
- *As built:* the migration inserts the default only for the seeded organisation ids; on a fresh database the seed inserts it (the seed runs after the migrations). `setCountryMapping` with "place unplaced learners" places only learners of that country who have no organisation. The screen shows each change from the action's own answer.
- *If the answer differs:* an ADMIN changes the mapping on the screen; no code.

### D74 · Who sees whom
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16; owner confirmation 2, default applied); consortium default Q25 (whole organisation)*
- An ADMIN (DIESIS, SENIC) sees the whole project, learners with no organisation included. A partner admin and a facilitator see the learners of their own organisation: the whole organisation, not one cohort. Staff with no organisation, editors and learners see no learner data. A DIESIS facilitator sees DIESIS's learners (Belgium and Other).
- *As built:* an ADMIN's people list covers anyone with a membership or a profile in the project. An organisation's people never include an ADMIN or an address on `ADMIN_EMAILS`.
- *If Q25 says cohort only:* a cohort scope kind in the same module (+1 day). *If DIESIS facilitators must see everyone:* a setting listing the organisations whose facilitators see the project, read-only in effect (+0.5 day).

### D75 · One scoping module, failing closed; the session carries no roles
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16)*
- `src/lib/scope.ts` decides every staff read and every staff write about another person. The scope is a required argument; "none" matches nothing. Roles and the organisation are read on every request, never put in the session.
- A guard test (`src/lib/scope-guard.test.ts`) reads the sources: every read of learner or people data goes through a scope builder, every write of a person's organisation goes through `setPersonOrganisation`, and anything it can't follow fails.
- *As built:* the guard's relation list is longer than the spec's; a function counts as scoped through a helper in the same file, or when it is called only from scoped functions; an organisation written through a relation, a nested write or `Object.assign` is refused outside `setPersonOrganisation`. `getViewer` lets Next's own signals through, so a page is never built once as "nobody". A failed read of the viewer gives "none", logged without personal data.
- *As built (22 October, SS4):* a `Scope` is made only by `src/lib/scope.ts`: its type carries a brand no other module can name, its fields are read-only and every scope is frozen; the scope of chosen roles and settings is not exported (tests reach it as `testOnlyScopeFor`). The guard fails, outside tests and the module, for the test-only factories, an assertion to a Scope under any spelling, an any or never where one is expected (also inside an array or a promise), an object literal there, a Scope changed or copied by `Object.assign` and the like, a generic function of `src/` that makes its type parameter's value (an assertion, a spread, `Object.assign`, an any) when a Scope comes out of it, a type predicate or an overload answering one, and a server action that takes a Scope or a Viewer from its caller.
- *As built (22 October, after the second review):* a Scope is also checked when it is used: the scope module keeps every scope it makes (by identity), and every function of it that takes a Scope throws (`NotAScopeError`) for any other value before reading it — no filter is built and no row counted for it. So an object from JSON or posted by the browser, a copy (a spread, `Object.assign`, a structured clone), or a value a generic class or callback built is never read as a scope, whatever the type check and the guard saw. The guard also reads a Viewer taken through `Pick`, `Partial`, `Omit` or `Readonly`, and every "use server" module of `src/` exports its actions where they are declared (no export list, `export *` or `export default` of a value).

### D76 · The partner admin role
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16); consortium defaults Q25 (partner admins edit and translate) and Q28 (the partner admin signs off a translation)*
- `PARTNER_ADMIN` includes Editor and Facilitator. It manages its own organisation's people: it gives only the Learner and Facilitator roles, and changes or removes only people who hold nothing else, so one partner admin can't lock out another. It never sees or changes an ADMIN, signs off translations (D90), and is given only by an ADMIN.
- *As built:* a partner admin adds people to its own organisation only, and claims an existing account only when it holds nothing (D101). An address on `ADMIN_EMAILS` is refused before it is looked up. It may change its own learners' names, never their country or organisation (an ADMIN's). It deletes one of its organisation's cohorts only when it is shown everyone in the cohort. It creates and deletes no organisation, maps no country, and has no data tools and no safeguarding settings.
- Facilitators no longer publish or withdraw lesson documents: a course's editors do, and each change is audited.
- *If partner admins must not edit courses:* drop Editor from the role's implied roles (one line); sign-off stays.

### D77 · Partner access is off until the production security review starts
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16; owner confirmations 3 and 9, defaults applied)*
- `R3_PARTNER_ACCESS` must be `on` for a partner admin or a partner facilitator to see any learner. The owner sets it, with a redeploy, at the start of the production security review (Mon 23 Nov), while only marked test accounts hold partner roles with an organisation. Real staff get their organisations, and partner staff are invited, only after the review passes (Wed 25 Nov).
- From the moment partner staff hold Facilitator or Partner admin, or real learners exist, problems are fixed forward with the switches (GO-LIVE §11), never by going back to Release 2. Before that, going back to Release 2 is allowed only after the pre-rollback step: no Partner admin membership left (`scripts/r3-check.ts` counts them).

### D78 · The profile step
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16); consortium defaults Q16 (`PROFILE_CONSENT` off), Q17 (a first name or nickname), Q18 (`AGE_RULE`: 16), Q24 (an admin changes the country)*
- One screen, `/welcome`, for every signed-in account without a complete profile. It is asked for in the hub and the five workspace layouts (learner, facilitator, statistics, admin, content), never in the proxy or the root layout; the legal pages, the account page, `/help`, sign-out and the data download stay open. When in doubt it sends the person to the screen.
- Fields: a first name or nickname (1–50 characters, on one line), the country, the Terms (version and time stored), the privacy notice (linked, not accepted), the age statement (the minimum age, or "invited, with a parent's or guardian's permission recorded by the inviter"), and a consent box that is built but off.
- Name and country are changed later only by an admin (a partner admin: its own learners' names). After the first completion the action takes only a new Terms version, consent, and a name when the stored one is blank. A new English Terms version brings the screen back with only the Terms box; a translation never does.
- *As built:* an `AGE_RULE` under 13, or one that can't be read, means 16 (logged once, without the value). `PROFILE_CONSENT` reads as off while the consent text's version starts with "draft-". A later visit keeps a consent already given; only an explicit "no" withdraws it. The age tick counts only for the statement it was given for. The Terms version stored is the English Terms text's own version.
- *As built:* a partner-admin-set organisation that doesn't match the country picked is released for an ADMIN to confirm (D101), at the first completion and whenever the person becomes a learner later.

### D79 · Learner membership and guest work wait for the profile; guest work moves only when claimed (amends D25, D37, D53)
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16)*
- The Learner membership is created by the profile step, not by the browser. Before the profile is complete nothing of the person's learning is saved (they are told), and nothing moves from the browser into the account.
- After it, a browser holding guest work asks "Add it to my account" or "Remove it from this browser", and moves nothing unasked (shared computers).
- *As built:* "Added" shows only once the work is in the account, and the browser's copy is removed then. Activity records wait until the person's data has loaded.
- *As built (Release 3, 22 and 23 October):* "Add it to my account" sends the browser's guest work to the server once, and the server decides each part in one transaction, as the account is under its locks (D37, D69, D80): the course moves only into an account with no progress in it; the Comp Card only into an account with no card, or a blank one (no answer, the confidence untouched) that isn't shared, and as "Only me" (moving never shares); badges as a union, each given as the badge award gives it. A part the account already holds is "already" there, and nothing is added twice. A course the account has progress in, a Comp Card with something of the account's own in it, or a shared one keep the account's, and the guest's stays in the browser; so does a course no one can open any more. A text too long to add (a Comp Card answer over 2,000 characters, a reflection answer over 5,000) or work too big for one save means nothing is written, and the offer shows the texts to be shortened; work too big for one save is found so by the browser, by the server's own measure, before anything is sent (23 October). Another account signed in on the browser means nothing is written and the browser keeps all of it. The browser then removes only the parts the server says are in the account, and only as it read them, whoever is signed in by then. What a tab still a guest saved while the work was being added isn't added: the page says so (23 October), and it stays in the browser, offered with whatever else stays there; added again, a part the account now holds keeps the account's (D69, D80). The page says what became of each part, and the offer asks for the work to be added before anything else is started in the account. Each claim's outcome per part is logged as counts, without personal data. A guest's page on which someone signs in in another tab stays the guest's and says so: any other page loads in full, as the account's; it isn't refreshed; it saves to the browser only over what it last saved, and once another tab adds, removes or changes the work it stops and offers a reload.
- *Decided by the integrator (24 October 2026, (c)), as built:* the course saves (`saveCourseProgressPatch`, and Release 1's `saveCourseProgress`) and the Comp Card's save (`saveCompCard`) refuse a signed-in person whose profile step isn't done themselves, whatever `R3_PROFILE_GATE` says, as `POST /api/progress/beacon` does: answered "profile-incomplete" (the route: 403), never thrown, and nothing written; whose the save is comes first (another account's is still "other-account"). A Release 3 page whose person's profile stopped being complete since it loaded (new Terms) keeps what is on screen and says what it says before the profile step ("Finish your profile to save your progress", with the way to it); a page loaded before Release 3 gets the same refusal, and doesn't try it again. No real learner has an account before 1 December.
- *As built (24 October, under (c)):* the badge award (`awardBadgeAction`) refuses the same way, after whose the award is, in the award's own shape (`{ ok: false, reason: "profile-incomplete" }`): no badge is given, and a Release 3 page shows the profile step's note, as for a refused save. So do the activity records facilitators are shown (`recordCourseOpened`, `recordStageTime`, `recordVideoCueAnswer`): "profile-incomplete", nothing written. Taken before the profile step, by rule: the Comp Card's sharing back to "Only me" (D80), the reading-help settings (D38) and the profile step itself.

### D80 · Comp Card privacy (amends D19)
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16; owner confirmation 4, default applied); consortium default Q16 (sharing is consent-based)*
- Two choices: "Only me" (the default, in the schema, the server and the browser) and "Me and the facilitators at ‹organisation›". A card counts as shared only with a sharing date and the learner's organisation at that moment, both written by `setCompCardSharing`. Saving the card never changes its sharing. Every card was reset to "Only me" by migration B. Any later change of the learner's organisation unshares it (D101).
- The mentor option is gone from every screen and write; the enum value goes after the pilot (D99). Each field holds up to 2,000 characters: longer text is refused, never cut. Every field is optional in a save, so a field left out keeps its text.
- A sharing change is logged by the card's id (sharing and withdrawal are both recorded), with the version of the sharing wording. A learner invited under the guardian rule shares only when the inviting organisation records that the permission covers it.
- *As built:* migration D adds a trigger: a card whose privacy is written as anything but "shared with facilitators", by any code, loses its sharing date and organisation. The account page shows a shared card and takes it back to "Only me" in one click, also while the profile step waits for new Terms. A guest's card is always "Only me".
- *As built (23 October):* a page saves only the fields the learner changed on it from what the server is known to hold (what loaded, what "Add it to my account" answered, what a save confirmed; a field whose save wasn't confirmed goes with the next one, and when the page has changed since that save was sent, a save follows on its own once it fails). A card that loads isn't saved back, and a page opened before another tab or device changed the card never writes its older copy of a field it didn't change: of two pages editing the same field, the last save of it stays. A signed-in page reads the account's card and badges again when the browser's guest card or badges change in another tab (added to the account there, removed or changed), and keeps what was changed on it and isn't saved yet; a sharing choice made there is about the card it then shows.
- *Depends on:* Q16 (the sharing date and version are the consent record, "Only me" the withdrawal); counsel confirms the guardian rule (Art. 8 GDPR).

### D81 · Who sees a shared Comp Card
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16; owner confirmation 2, default applied); DIESIS default O-1*
- The facilitators and partner admins of the organisation it was shared with, and an ADMIN only for the ADMIN's own organisation. SENIC's admins see no card text. Nobody sets their own organisation, and every change is in the log.
- *As built:* the filter is applied on the server (`src/lib/comp-card-visibility.ts`). A confidence the card template hides reads as empty; a failed template read shows an empty roster rather than hidden fields. The screen says "Nothing shared with you." or "Shared with you. Nothing is filled in yet.". The privacy notice says a shared card is seen only by the facilitators at the learner's organisation.
- *If DIESIS's admins must see every shared card:* one condition, and the learner's label becomes "Me, the facilitators at ‹organisation› and DIESIS".

### D82 · Exercise choices and results are progress
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16)*
- Scenario choices, practice and quiz results are always visible to the learner's organisation, whatever the Comp Card choice. The scenario line moves out of the Comp Card into Activity. Learners are told so on the Comp Card, the profile step and the account page.
- *As built:* what staff always see is listed in full in those three places and the privacy notice: name and email, country, progress, last activity, time per lesson, quiz and video-question results, exercise choices, and whether a guardian's permission is recorded.
- *Depends on:* counsel's open item on scenario choices. *If the choice must follow the card:* hide it when the card isn't shared (+0.5 day).

### D83 · Statistics count real learners from 1 December (amends D53 for statistics only; D70)
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16; owner confirmation 5, default applied); consortium default Q19*
- A separate filter: no current staff role, never a staff role, not a test account, and only enrolments, activity and badges from `STATS_FROM` (unset: 1 Dec 2026, 00:00 Brussels time). The roster, notes and the editor's counts keep D53. The admin Learners figure uses the filter without the date.
- *As built:* with a date, a learner counts once they have an enrolment in a project course since it. The Statistics page says counting starts on 1 December, and when it is empty it says why (no learners yet, a failed read, or an account that sees no learners). The admin figure carries the note "Staff, former staff and test accounts left out."
- Known limit: running-total activity records started before the date are left out whole.

### D84 · "Ever held a staff role" is recorded by a trigger
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16)*
- `StaffHistory` is filled by a trigger on `Membership` for every role but Learner, plus a one-off backfill from current memberships, staff-only log actions, note authors and the demo staff addresses. Viewers who left no trace are covered by the date and the review lists on Admin → Data.

### D85 · Test accounts (Q19)
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16); consortium default Q19 (filter, and delete marked test accounts)*
- ADMINs mark, reset and erase test accounts on Admin → Data. Reset deletes the person's sessions first, then their enrolments and badges, and keeps the account and profile. Marked accounts leave the statistics at once and are erased by the go-live clean-up. Partner admins can't do any of this.
- *If all trial records must go:* the run also resets the learner data of accounts in `StaffHistory` (+0.5 day).

### D86 · Erasure is complete and one transaction (amends D12)
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16)*
- Erasure locks the user row first, then deletes in one transaction: the account and everything linked to it, the person's activity records, the log of their Comp Card's sharing, their sign-in links (whatever the case of the address) and their rate-limit records (keyed by id and by email). Other log rows lose the person's id; one `account.deleted` row keeps it, without name or address, so an erasure can be applied again after a restore.
- *Depends on:* A12 (log retention) for later pruning of that row.

### D87 · The data download says what it holds, and holds the activity (amends D12)
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16)*
- Added: the profile, sharing, activity records, log entries about the person (action and date), sessions and pending sign-in links (count and expiry, never a token) and staff history. Notes about the person are signed by organisation, never by name; notes the person wrote are counted, not copied. Learners read notes only in the download; the account page says they are there.
- *As built:* a note is signed "a facilitator at ‹organisation›" while its author is still in the organisation they wrote it in, otherwise "a member of staff". An organisation recorded on a membership before 20 Nov 2026 is labelled as no longer used. A shared card carries the version of the sharing wording.
- *Depends on:* counsel (Art. 15(4) for notes written; naming authors).

### D88 · Admin data tools and the go-live clean-up
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16); scoping map question 5 (default: ADMIN only)*
- On Admin → Data, for an ADMIN with a completed profile only: find anyone by email; export (a form posted from the page, origin checked) and erase, each with a request reference `REQ-YYYY-NNN` from DIESIS's register; mark and reset test accounts; review lists; the log, in Brussels time and in words; and a logged clean-up run (dry run first) that erases marked test accounts (reference `CLEANUP-<run>`), ends every showcase sign-in session, purges expired sessions and sign-in links, and deletes queued course files (D92). The run asks for `ERASE <n> TEST ACCOUNTS`.
- Nobody edits the production database by hand: `prisma/purge-demo.mjs` is deleted; `docs/data-management.md` is the runbook.
- *As built:* the page reads its lists and log from each action's own answer. On deploy day a first run with nothing marked ends the showcase sessions (GO-LIVE §2b, step 0).
- *If partner admins must handle requests for their organisation:* the same actions with the scope check (+0.5 day), recommended against while DIESIS is the controller.

### D89 · Staff notes outlive their author, unsigned
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16); DIESIS default A12*
- A note's or a validation's author is set to none when the author's account is erased. *If DIESIS wants them deleted:* one line in the erasure.

### D90 · The "German / Greek version ready" switch (Q28; amends D51)
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16; owner confirmations 6 and 12, defaults applied); consortium default Q28*
- `Course.readyLocales`. Existing created courses start not ready; built-in courses are always ready. A learner using a language that isn't ready gets the whole course in English, with a note, marked as English. Preview shows the requested language with a banner. A partner admin or an ADMIN switches a language on, with its coverage and limits shown, audited; until partner admins are invited (25 Nov) an ADMIN does it at the partner's written request. A live language is never switched off automatically. `R3_LANGUAGE_READY=off` counts every language as switched on.
- English is the source language: a created course is first published only with complete English.
- *As built:* a live language's chip on Manage courses says "live". The completion screen, the dashboard's step names and badge, the facilitator's current course, the scenario choice and the Comp Card's course title carry the language they are shown in.

### D91 · YouTube only after a click; other media only from our own store (Q27, A7)
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16); consortium default Q27*
- The one player shows a gate: nothing from YouTube loads until the viewer presses play, then the privacy-enhanced youtube-nocookie player loads. No thumbnail; nothing is remembered; a press plays only the video it was for. The server works out the provider and accepts videos, captions, posters and documents only from the platform's own store (`BLOB_PUBLIC_HOST` on production) or a YouTube link; rows already stored on other hosts show as links out.
- *As built:* the content security policy admits the same one store the server accepts; on production without `BLOB_PUBLIC_HOST`, or with a value that isn't one host name, it admits none, and no upload can be attached.
- *If other hosts are wanted:* each behind the same gate and in the policy (+0.5 day per host).

### D92 · Course files go with their record, a week later; they stay public by link
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16; owner confirmation 7, default applied)*
- A removed or replaced file is queued in the editor's own transaction and deleted by the logged admin run once it is 7 days old and nothing refers to it; on production only, from the platform's own store only. `R3_BLOB_DELETE=off` keeps queued files.
- *As built:* a file counts as in use when any address names the same file (host case, query, fragment and encoding aside), so the run only ever keeps more.

### D93 · Safeguarding contacts are an admin setting; 112 is in code
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16)*
- `Project.safeguarding`: up to three entries per country (the organisation's contact and help lines), edited by ADMINs on `/admin/safeguarding`. A box after the main content of learner and account pages and the profile step, `/help`, the first footer link on every page, and a line beside every reflection; never empty (112 and a fallback line).
- *As built:* 112 is a phone link. A reflection's line says facilitators don't read what is written there and links to help (the recorded walk's one difference, R3-D1).
- *Depends on:* the partners' and DIESIS's contacts (by 20 Nov; a go/no-go item).

### D94 · Legal texts are versioned files; only final text is committed
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16; O7)*
- One file per document per language, in a Markdown subset rendered by the platform's own parser; version and last-updated date shown, the Terms version stored with each acceptance. A test refuses placeholders.
- *As built:* a text written before counsel's shows "Interim version · last updated …"; counsel's texts show their version. A line break in a text is a line break on the page. A document with no text answers "not found" and isn't linked; the legal notice is listed once its English text exists.

### D95 · Security headers without a nonce
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16; owner confirmation 8, default applied)*
- A content security policy, `X-Frame-Options`, `nosniff`, `strict-origin-when-cross-origin` and a Permissions-Policy, all from `next.config.ts`. Plausible's and Sentry's hosts only when they are switched on. `R3_CSP=report-only` reports instead of blocking.
- *As built:* the policy is written when the site is built, so a change of `BLOB_PUBLIC_HOST`, `R3_CSP` or the Plausible and Sentry settings needs a redeploy that builds again (GO-LIVE §1). A nonce policy is a hardening item after launch.

### D96 · The rate limiter
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16)*
- Every key is stored as a keyed hash (HMAC with `RATE_LIMIT_SECRET`, else a key derived from `AUTH_SECRET`). Windows are compared in epoch seconds. When the limiter can't count, staff-only limits refuse (decided from the key's prefix) and sign-in links are allowed.

### D97 · The session response carries only id, email and name
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16)*
- The session callback answers exactly `{ user: { id, email, name }, expires }`. Roles and the organisation are read from the database on every request (D75).
- *As built:* `main` took the same rule on 21 Oct; it came into `r3` with the merge of `r2`.

### D98 · Demo sign-in is opt-in and never runs on production (amends D16, D23)
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16; owner confirmation 10, default applied)*
- It runs only with `DEMO_LOGIN_ENABLED=true` and a private `DEMO_ACCESS_CODE` of at least 12 characters (no default in the code), and never where `VERCEL_ENV` is `production`. Never with production's database or a branch of it. The admin demo profile is `demo-admin@seq-elevate.eu`. Showcase sessions are ended by the clean-up run; rotating `AUTH_SECRET` ends no database session.
- *As built:* demo learners get the organisation Germany maps to; demo staff get none, so the demo facilitator sees nobody until an admin links it. `DEMO_LOGIN_DISABLED` is no longer read; production keeps it `true` for a rollback to Release 2.

### D99 · Scope notes for Release 3
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16)*
- Not in Release 3: spec §1.2. German and Greek staff screens stay English (Support learners excepted) and are marked as English under `/de` and `/el`. The `FACILITATOR_AND_MENTOR` enum value and Release 2's old `saveCourseProgress` action are removed after the pilot, each by a decision of its own.

### D100 · The repository is public: what a change enforces is said, not what it closes
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16; owner confirmations 1 and 11, defaults applied)*
- `r3` is not pushed before the deploy merge. Review findings, and tests that show a weakness while it is still live, stay in the private drafts folder or on local branches. Commit messages, `DECISIONS.md` and `BUILDLOG.md` state the rule a change enforces until it is live; the full account is added after the deploy.
- After launch a security fix is developed on an unpushed branch and reaches GitHub only in the merge that deploys it; if learner data is exposed meanwhile, `R3_PARTNER_ACCESS` is switched off first. Release 4 follows the same rule.
- *Depends on:* whether the repository must stay public (the owner asks the consortium; default: public, with this rule).

### D101 · One writer of a person's organisation; any change unshares the Comp Card
**Decided**: 21 October 2026 · *Decider: SENIC principal (spec §16); consortium default Q24*
- `setPersonOrganisation` is the only code that writes a profile's organisation. It unshares the Comp Card, clears cohorts of other organisations, records who set the organisation and logs the change. A database trigger unshares the card for any other writer.
- `addMember` never changes an existing organisation. It sets one only for a new person or a claimable account: no organisation, no completed profile and no learner data (no enrolment, Comp Card or badge, no activity record, no note or validation about them).
- A partner-admin-set organisation that doesn't match the person's country is released for an ADMIN to confirm: at the first completion of the profile step, and whenever the person becomes a learner later (made Learner only, or a Learner again after Remove). The release is logged (`profile.organisation_released`) and listed for ADMINs. Nobody changes their own organisation.
- *As built:* a guardian's permission belongs to the organisation that recorded it: a change of organisation clears both records (in the code, and by migration D's trigger). Manage people says when an invited under-16's permission isn't recorded by their organisation, which records its own by adding them again with the tick.
- *Depends on:* Q24.

### D102 · How Release 4 is built and shipped (amends Release 3's spec §17.7; keeps D100's rule)
**Decided**: 21 October 2026 · *Decider: SENIC principal (Release 4 spec §8; owner confirmation 1, the owner's yes of 21 October 2026, with Release 3's integrator's acknowledgement recorded in `BUILDLOG.md`)*
- **Branches.** Local branches from `r3`: `r4` (the shared commit, then Part A: links in text), `r4b` (from the shared commit: Part B's schema, further reading and a language per document or link) and `r4r` (from `r4b`: the references screens), merged into one another only at the checkpoints (spec §1.3). Release 3's later fixes reach them by merge, by hash (D102 as built, 23 October); `main` is merged in after Release 3's deploy.
- **Never pushed before the deploy merge.** The repository is public (D100), and a pushed branch would build a Vercel preview whose build migrates the Preview database; previews are Vercel CLI deployments with an explicit database.
- **The earlier start amends Release 3's §17.7** ("after Fri 13 Nov") on five conditions: (1) before Fri 13 November Release 4 asks nothing of Release 3's integrator or streams, and after it Release 4's integrator, not Release 3's, picks up Release 3's fixes; (2) it never shares Release 3's worktrees, databases or ports; (3) before Mon 16 November its only edits to files Release 3 holds under contract are on its own local branches and additive (new models and one relation line each in `Lesson`, `LessonDocument` and `Course`; new message namespaces), and Stream E's `src/lib/cms/types.ts` and `e2e/r3-actions.spec.ts` are not edited before then; (4) every conflict is Release 4's to resolve; (5) Release 4 takes over the Stream E files listed in spec §9.7 at the hand-over (it came on 23 October: D102 as built).
- **One migration**, named after Release 3's, rehearsed on a Neon branch by the owner's deputy (spec §2.7).
- **Deploy** Thu 26 November 2026, in the morning, only after Release 4's independent security review has passed; never Mon 23, Tue 24 or Wed 25 November, Mon 30 November or Tue 1 December; the fallbacks are Fri 27 November in the morning, then Thu 3 December. Release 4 adds its own go/no-go items to Mon 30 November (spec §9.9).
- **Cut first.** If anything slips, Release 4 is cut before anything else; its work never delays Release 3.
- *Depends on:* the plan's cut rule; Release 3's dates; the owner's confirmation and Release 3's integrator's acknowledgement (both given). Without them, Part A would have gone ahead and Part B's schema, migration and message keys would have waited for Mon 16 November.

### D103 · One address check for every link (Q13)
**Decided**: 21 October 2026 · *Decider: SENIC principal (Release 4 spec §8; owner confirmation 2, its default applying without an answer by Wed 28 October, 12:00); consortium default Q13*
- `checkLinkHref` (`src/lib/rich-text/link-url.ts`) takes **https, http and mailto** (a `mailto:` with at most a `subject` query), normalised, of at most **2,048 characters**, with **no user name or password** and **a host with a dot**. It refuses **Outlook safe links** (they carry the recipient's mailbox address) and, for new links, **our own file store** (the exact `BLOB_PUBLIC_HOST`; the `*.public.blob.vercel-storage.com` family only while that is unset).
- It is the one check everywhere a link is made or drawn: the Link form, the editor's mark (as it is parsed and drawn), paste, the sanitiser on save, in the editor and on every render, the plain-text copy, quick links, "Add a link" and every read of a stored further-reading address.
- *As built:* the length guards and the address as every engine writes it (D103–D107 as built).
- *Depends on:* Q13. If http isn't wanted, new links (form, paste, save, "Add a link") refuse it through one flag, and typed http addresses stay quick links (D55); if email links aren't wanted, the same for mailto.

### D104 · Named links in lesson text (amends D36, D55)
**Decided**: 21 October 2026; amended 22 October 2026 · *Decider: SENIC principal (Release 4 spec §8; owner confirmation 3, its default applying without an answer by Wed 28 October, 12:00); the amendment: the owner's decision of 22 October 2026 ("Yes, show the site": the site box, D105, and rule G, D103–D107 as built)*
- **Where.** A named link can be made in paragraphs, key messages, reflection introductions and the references list. List points, compare sides, titles and exercise texts keep quick links only (D55). No link is made while typing.
- **Stored** as a link mark holding its address (`href`) only, one link per text node, in a doc stored as version 2 only when it holds a link, with its `text` "label (address)", so code that reads only `text` shows the address.
- **Refused on save, never cut:** a link the address check refuses, or whose words show another site's address than it opens (rule G, D103–D107 as built: sites compared by registrable domain; touching links read as one), is refused with a message naming the block and the link. The editor names these problems as they arise and never saves a text without a link the author still sees. On render a refused link is drawn as its words.
- **Drawn** as one `<a>` per link, never nested; quick links only in unlinked text.
- *Depends on:* nothing.

### D105 · How links open (Q13)
**Decided**: 21 October 2026; amended 22 October 2026 · *Decider: SENIC principal (Release 4 spec §8; owner confirmation 4, its default applying without an answer by Wed 28 October, 12:00); consortium default Q13; the amendment: the owner's decision of 22 October 2026 (the site box)*
- Every link, web or email, typed or named, opens in a **new tab** with `noopener noreferrer`, as links have since 13 October (D55) and as the reply's Q13 says, so a learner whose browser hands `mailto:` to a web mail service keeps the lesson's tab and their answers in it.
- **What the link says it does**, heard but not shown, in the interface's language and marked with it: "(opens in a new tab)" for a web link, "(opens your email program)" for an email link. No icon.
- **The site box** (the owner's amendment): every named link learners get shows the site it opens in a small box after its words (D103–D107 as built).
- Learners see no warning about `http://`; editors do.
- *Depends on:* Q13. If links must open in the same tab, `target` and the hidden words go for every link, and the recorded walk gets a declared change.

### D106 · The Link button and pasting (amends D36's paste bullet)
**Decided**: 21 October 2026 · *Decider: SENIC principal (Release 4 spec §8; owner confirmation 5, its default applying without an answer by Wed 28 October, 12:00)*
- The editor's own link mark (no new dependency); **Link** and **Remove link** in the toolbar, Ctrl+K or ⌘K; an inline form in English, like the toolbar.
- **Paste keeps the links the check and the rule take** (http too, with a note), unwraps an Outlook safe link and a Google redirect to the address they carry, and never keeps a safe link itself. Word bookmarks, footnote anchors, `#` and `file:` links, relative links, refused schemes, links to our own files and links whose words show another address become their words. The author is told how many links weren't kept, and why.
- *As built:* D106–D112 as built.
- *Depends on:* the partners' real Word and Google Docs clipboards and the hands-on paste of them (spec §9.8, item 3), the only ground left to change the link rule (the stop rule, D103–D107 as built).

### D107 · Further reading is its own record, hidden until shown, never content (Q15)
**Decided**: 21 October 2026 · *Decider: SENIC principal (Release 4 spec §8; owner confirmation 6, its default applying without an answer by Wed 28 October, 12:00); consortium default Q15*
- A lesson's further reading is `LessonLink` rows: a title, an address, a description and the languages it is for; at most **30** a lesson, a title of at most **200** characters and a description of at most **300**; refused, never cut.
- An address on our own file store or a safe link is refused, and so is a title that shows another address than the link opens. Every stored address is checked again when it is read.
- New links are **hidden until shown** to learners.
- Learners get the list **after the lesson's own content, before Continue** (as built: in a standard lesson, drawn by its stage screen, after the stage, its Continue included). It is never a lesson's content: it never changes what learners must do or what counts. No click is counted.
- *Depends on:* Q15. If links are to be visible at once, `addLessonLink` creates them shown (one line), and the toggle stays.

### D108 · A language per document and link (amends Release 3's known limit that a lesson's documents are in one language)
**Decided**: 21 October 2026 · *Decider: SENIC principal (Release 4 spec §8; owner confirmation 9, its default applying without an answer by Wed 28 October, 12:00)*
- `languages` on each document and further-reading link, `[]` for every language.
- Learners get the items for every language, for the language of their pages, and for the language the course text is shown in, so a German-only worksheet reaches German learners while the course is still shown in English.
- What counts (lessons, progress, completion) doesn't depend on language. A lesson left with only other-language documents shows them, each marked with its language. Staff see every item.
- *Depends on:* Release 3's language switch (D90). If items are to follow only the language the course text is shown in, `forLanguage` takes one language, and partners are told that German-only items then reach nobody until German is switched on for the course. If partners want one language per item only, the boxes become one choice (the screen only).

### D109 · References & bibliography, one list per created course (Q14)
**Decided**: 21 October 2026 · *Decider: SENIC principal (Release 4 spec §8; owner confirmation 7, its default applying without an answer by Wed 28 October, 12:00); consortium default Q14 ("per course, free text, APA 7")*
- A table of its own (no `Course` column, so neither the migration nor a save locks `Course`); one rich-text list per language, with English as the fallback; live on save; for created courses only.
- Its own learner page, linked from the player (a new tab, which says to close it) and from the completion screen; laid out as a reference list (hanging indent).
- *Depends on:* Q14. If references are per lesson, nothing is built for it: the guide shows a "References" text piece at the end of a lesson with the Link button, and the references screens (`r4r`) aren't merged (the table stays, unused). Another citation style changes the guide's example only.

### D110 · Who may change further reading, languages and references
**Decided**: 21 October 2026 · *Decider: SENIC principal (Release 4 spec §8)*
- Editors, partner admins and ADMINs (`canEditContent`) only; facilitators never; project-wide, with no organisation scope.
- Every write checks the project, the course and the lesson, and answers "not found" otherwise.
- Audited without titles, addresses or list text. No author column: no personal data, and nothing for the data download or erasure.
- *Depends on:* Q25 (partner admins edit content). If they don't, D76's one line applies here too.

### D111 · Switches and rollback
**Decided**: 21 October 2026 · *Decider: SENIC principal (Release 4 spec §8)*
- `R4_FURTHER_READING` and `R4_ITEM_LANGUAGE`. Nothing switches off the address check, the draft filter or hidden-until-shown; links in text have no switch.
- A rollback to Release 3 is data-safe at any time. A deployment keeps the switch values it was built with, so Release 3's switch values today are compared with the rollback target's first; if any changed, Release 3's commit is redeployed with today's environment instead of an instant rollback (spec §7.2).
- Release 3's own rule stays: once partner staff hold their roles or real learners exist, nothing goes back below Release 3 (D77).
- *Depends on:* nothing.

### D112 · Scope notes for Release 4
**Decided**: 21 October 2026 · *Decider: SENIC principal (Release 4 spec §8)*
- Not in Release 4: spec §1.2. Typed quick links to our own files keep working; the self-assessment introduction still has no quick links; authoring tools stay English until after launch.
- *Depends on:* nothing.

### D102 as built · Release 3's hand-over came on 23 October; Release 3's later fixes reach Release 4 by merge
**Decided**: 23 October 2026 · *Decider: Release 4's integrator, under D102's conditions 1, 4 and 5 (Release 3's integration finished on 23 October 2026)*. D102 itself is above.
- **The hand-over, now.** Release 3's integration finished on Fri 23 October 2026 (`r3` at `d6a39cf`: integration, polish, the one-step guest claim, follow-ups), so its hand-over of Stream E's files to Release 4 happens now instead of Fri 13 November, by the integrator: `src/components/rich-text/QuickLink.tsx`; the markup assertions of `src/components/course/{NarrativeStage,AssessmentStage,SimulationStage}.test.ts`; `src/app/actions/lesson.ts` (`getLessonMedia`) and `src/app/actions/sections.ts` (`deleteSection`); `src/lib/cms/{types,course-admin,course-admin-types,course-derive}.ts`; `src/components/role/LessonDocumentManager.tsx`; `src/components/course/CoursePlayer.tsx` and the learner course page; `docs/partner-guide-lessons.md`; `e2e/fixtures/r3-action-table/e.ts` (the `getLessonMedia` row); and the rest of the lists in spec §9.2–9.3 and §9.7.
- **Later Release 3 fixes reach Release 4 by merge**, where D102 (and D71's note) said rebase: `d6a39cf` is merged into `r4` (`cab9461`), `r4b` (`51845f5`) and `r4r` (`5434310`), so every commit `BUILDLOG.md` and this log cite keeps its hash. A later Release 3 commit is merged the same way, named by its hash (never a moving branch head), by Release 4's integrator, who resolves every conflict (conditions 1 and 4); Release 3's integrator does nothing for Release 4.
- **A conflict keeps both releases' rules**, resolved once and alike on the three branches: quick links (`linkify.ts`) measure a web host, or an email address's domain, against DNS's limits as typed, every code point counted, before anything parses it (Release 3), and on `r4` are links exactly when the one address check takes them (D103); the text editor's own words are English and its text carries its language (Release 3), Release 4's Link form and paste notes among the editor's words; the message files are the union of both releases' keys; `BUILDLOG.md` and this log keep Release 3's entries, then Release 4's.
- Unchanged: the branches stay local until the deploy merge (D100, D102), and the link rule and site box keep their frozen blobs on all three branches (D103–D107 as built).

### D103–D107 as built (D104 and D105 amended) · Learners see the site each named link opens; link text is refused only when it shows another site's address
**Decided**: 22 October 2026; built and frozen 23 October 2026 · *Deciders: the site box: SENIC principal, the owner's decision of 22 October 2026 via the chat question ("Yes, show the site": the link-rules review's items 11–13, each answered with its default: show each named link's site, narrow D104 to rule G only with the box, international names in punycode); the rest: Release 4's integrator (build decisions under the link-rules review's plan)*. D103–D107 themselves are above. From 23 October the rule and the box change only under the stop rule below (BUILDLOG: the blobs and the measured targets).
- **The site box (D105 as amended; the owner's decision).** Every named link learners get (paragraphs, key messages, reflection introductions, text pieces, the references list, and further-reading titles) shows the site it opens in a small box after its words, inside the link. Still no icon.
  - *The site* is the one D104 compares: the host without one leading "www.", taken to its registrable domain (the host itself for an IP address and under it, jp, no, pl and us), in ASCII; an international name in punycode ("xn--…") for Release 4, its own letters after launch.
  - *Email links* show their address's domain's site, told the same way: "PayPal support" over support@paypal.com.evil.example shows evil.example. In further reading, an email link's bare address stays under its title instead.
  - *Left out* only when the whole of the link's words is its address: a web link's with or without its scheme, one leading "www." and one trailing slash, the host in any letter case; an email link's bare address, with or without "mailto:". Words that begin with the address and go on keep the box. Quick links, whose words are the address typed, show none.
  - *For screen readers* the box is part of the link's name: its words, a ", " that is heard but not shown, the site, then what the link does: "the guide, example.org (opens in a new tab)". Email links, which open in a new tab too, say "(opens your email program)" (D105; built 24 October, with Release 3's hand-over of `QuickLink.tsx`, D102 as built). These words are the interface's, in its language and marked with it, inside course text of another language too.
  - *Its place:* the box stays beside its link's words. It is isolated left to right; every link in lesson text carries an invisible left-to-right mark inside each end, never copied, stored or heard; a run of blank characters in a link's words is drawn as one space. It keeps its look in forced colours, high contrast, the dyslexia font and print. Authors see it in the block preview; the text they type in shows none.
- **D104 as built: rule G** *(the integrator, within the owner's item 12)*. Link text shows an address where it shows a name after a scheme or two slashes at a word's start; a "www." name of three labels or more; a name a path, query, fragment or port follows; an email address; or a name of Latin letters ending in a common top-level domain in lower case (46: com, net, org, edu, gov, int, info, biz, io, app, eu and the countries of the partners and their neighbours, not pl). A user name before a host after a scheme, or a label mixing Latin with Greek or Cyrillic letters, shows somewhere else whatever the link opens.
  - Text is read as learners see it (NFC, without what shows nothing or a combining mark left over, the ideographic, fullwidth and halfwidth ideographic full stops read as dots) and once more in NFKC; a name is read in the letters of ASCII, Latin-1, Latin Extended-A and -B, Greek and Cyrillic.
  - Such text is refused wherever links are made when it shows another site than the link opens, with one message: it "shows a different address than the link opens".
  - Unchanged: sites compared by registrable domain (the ICANN section of the Public Suffix List, tldts-icann 7.4.2), a public suffix named by itself showing every site under it, a common top-level domain in front of a host's site showing that name, and touching links read as one, compared with all their links at once.
  - Words that show no address by this rule keep their link, and the box shows where it goes: a name whose top-level domain is in capitals or title case ("PAYPAL.COM", "Amazon.Co.UK"), one of another top-level domain, a file's name, a title, an abbreviation, words that name no site.
- **D103 as built: the length guards** *(the integrator)*. An address over 2,048 characters is refused before it is parsed, and again if its normalised form is longer. A web host, or an email address's domain, that DNS can't hold (as DNS writes it, a label over 63 characters or a host over 253) is refused; one longer than that as typed, every character between its full stops counted, is refused before the address is parsed. In link text, a label longer than DNS allows stands for itself. A web address is written as the URL standard writes it in every engine (a path's "^" and "|" as typed), so the server and the learner's browser accept the same addresses, with the same site and box. A text is checked in time in proportion to its length: within 10 ms a text and 0.5 s a 1 MB save.
- **D106 and D107 as built** *(the integrator)*. Paste reads a link's words by the same rule: a link whose address the check takes, but whose words show another site's address, is pasted as its words alone, counted in the paste note. A further-reading title is read, once cleaned, as link text is, and refused with "The title shows a different address than the link opens"; its web link takes the box. The references list is lesson text, saved through `richTextForSave` and drawn by `RichTextView`, so with Part A its links follow the same rule and show the same box.
- **Stop rule** (the link-rules review, verdict §7). The rule or the box changes only for a missing, wrong, hidden or imitable box; an accepted address with a scheme, "www." or a path, or a host in lower case ending in a common top-level domain, over another site; a check over its budget; a false refusal in the partners' real clipboards or the hands-on paste at more than 1 link in 50, or for a service partners use repeatedly; or a must-fix of Release 4's security review. Look-alike or capitalised words over another site, with the box shown, are known limits (BUILDLOG) and are never patched.
- *Reason:* only the box covers words that name no site, or a site named in the sentence around them, which no rule reading a link's words can catch; the narrowed rule refuses what still shows another site by its look, and stops refusing titles, abbreviations and file names.

### D106–D112 as built · Links in text and further reading, languages and references, merged on `r4` at the checkpoint
**Decided**: 24 October 2026 · *Decider: Release 4's integrator (build decisions within D106–D112, spec §8; the checkpoint merges of spec §1.3)*. D106–D112 themselves are above; the link rule and the site box are D103–D107 as built, above.
- **The checkpoint merges, now.** With Release 3's hand-over on 23 October (D102 as built), both parts were built, reviewed and fixed by 24 October, so the merges of spec §1.3 came then: `r4r` into `r4b` (`32a7d22`), `r4b` into `r4` (`af17827`). `r4` holds both parts and is the branch that ships (§1.3, "A and B green"); `r4b` and `r4r` take no further work. The independent security review (§9.4) reviews the merged `r4`, both parts at once, and the deploy waits for it as before; a fix it asks for is made on `r4`. A Release 3 or `main` commit is merged into `r4` by its hash (D102 as built).
- **D106 as built: the Link button and pasting.** A link is the editor's own mark, `link`, holding its address only (not inclusive, so typing after a link doesn't extend it); the toolbar's **Link** and **Remove link**, Ctrl+K or ⌘K, open an inline form in English like the toolbar, whose "Text to show" carries the language the text is written in (WCAG 3.1.2). The form completes a bare email address or host, unwraps an Outlook safe link and a Google redirect to the address it carries, warns once about `http://`, names each refusal, and returns the focus to the text. Paste reads a reviewer's marks first, as the review accepted them (Word's tracked deletions and comments left out, its insertions kept as text), then keeps each link the address check and the link rule take, with its blanks outside it, and turns every other link into its words; the editor says how many links weren't kept and why, and how many use `http://`. The editor never shows a link its save would drop.
- **D107 as built: further reading.** A lesson's further-reading links are `LessonLink` rows: a title of 1–200 characters, an address the check takes that isn't on our own file store, a description of at most 300, the languages it is for; at most 30 a lesson; refused, never cut; new links hidden until **Show to learners** (Q15). "Add a link" sits beside "Upload document" in the lesson's card, "Documents and further reading", on the course page. Every stored address is checked again as it is read: learners never get a row the check refuses, and staff see it as text. Learners get the list after the lesson's own content: in a lesson drawn piece by piece after its text and before **Continue**, in a standard lesson drawn by its stage screen after the stage, its Continue included (§4.5, R4-E9); the partner guide says so. Each title shows the site it opens in its box; an email link keeps its bare address under its title. Links never make a lesson appear and never count: deleting a lesson deletes its links (the database cascades them whatever code deletes it), the confirmation lists them and the audit row counts them; the lesson's content version counts their ids, so a page opened before a link was added can't delete the lesson unseen; a link's last change is the course's last edit.
- **D108 as built: a language per document or link.** `languages` holds distinct values of en, de and el, `[]` for every language (all three are stored as `[]`). Learners get an item for every language, or for the language of their pages or the language the course text is shown in (`forLanguage`). One rule decides a lesson's documents for both kinds of lesson and for what the course page says of it (`lessonDocumentsFor`): when a lesson shows nothing else and none of its documents is for the learner's languages, it shows all of them, each marked with its language ("In German"), so a lesson that counts is never empty. Which lessons there are, progress and completion read every published document, whatever its language. Staff see every item, with its languages; a document's languages are set on its row, and an upload's before it is made.
- **D109 as built: references & bibliography.** One `CourseBibliography` row per created course, `{ v: 1, locales }`, one list per language in the lesson-text format, saved through `richTextForSave` (at most 10,000 characters a language; refused, never cut) and live on save. Learners get the list in the language the course text is shown in, else English, else the first written, marked with its language when it isn't the page's. Its own page, `/learner/course/<course>/references`, linked from the player's top bar (a new tab, which says to close it) and the completion screen (the same tab, with "Back to the course"); an editor's preview keeps the preview. The player gets only whether a list exists, never its text. The page is "not found", with a tab title naming no course, for a built-in course, a course without a list, and a draft for anyone who can't edit it. The editor sits on the course page below the title and subtitle, without indent (the list's layout hangs every entry); two saves from the same base: one saved, the other "changed-elsewhere". "Last edited" counts the list's last save.
- **D110 as built: who may change them.** Every write of further reading, a document's languages and the references list is for editors, partner admins and ADMINs (`canEditContent`) and checks the project, the course and the lesson, answering "not found" otherwise; facilitators and learners are refused, and so is everyone for another project's row. Audit rows name ids and languages, never a title, an address or a list's text. Release 3's action table holds every export (`r4.ts`, `r4r.ts`), and `r3-actions` fails a new export without its row.
- **D111 as built: switches and rollback.** `R4_FURTHER_READING=off`: learners and preview get no further-reading list and no references link, and the references page is "not found"; `R4_ITEM_LANGUAGE=off`: every published document and link shows in every language. Each is on unless it says exactly "off", read on every request of a deployment. Nothing switches off the address check, the draft filter or hidden-until-shown. A rollback to Release 3 needs no data step: Release 3's code draws a version-2 paragraph from its text, "label (address)" with the address a quick link, ignores further reading and references, shows every document in every language, keeps a version-2 paragraph as text when another block is saved, and deletes a lesson with its links (R4-I3 and R4-F1 on the build Release 4 rolls back to; the deputy repeats R4-I3 in the rehearsal, spec 2.7).
- **D112 as built: scope.** As spec §1.2: links in list points, compare sides, titles and exercise texts stay quick links; authoring tools (the toolbar, the Link form, the document and link manager, the references editor) stay English; references only for created courses; no click counting and no request from our server to a linked site. Release 4's known limits are in `BUILDLOG.md`.

### D113 · Every build and server runs Node 22 (`package.json` engines)
**Decided**: 22 October 2026 (built with D104's rule G, `1f7f6d3`); recorded 24 October 2026 · *Decider: Release 4's integrator (build decision)*
- `package.json` names `"engines": { "node": "22.x" }`: local builds, CI (already Node 22) and every Vercel build and function run Node 22, as the link rule was built and measured on (Node 22.19).
- **Why.** The link rule's tables and classes are read through the runtime's Unicode (letters, marks and signs, NFC and NFKC, the URL parser's international names: Unicode 16 in Node 22), and the server's check was measured against the learner's Chrome on Node 22.19: the check, the site and the box answer alike, and where the two engines differ it is only on characters Node 22 doesn't assign, which the server's check refuses and which it decides (D103–D107 as built). Another Node major version would read some characters differently from what was measured.
- **The Vercel project's own Node.js version agrees with it.** Vercel takes `engines.node` over the project's "Node.js Version" setting, so a deployment of Release 4 runs Node 22 whatever that setting says. The setting is 22.x too (the owner sets it so before Release 4's deploy, spec §9.6), so a deployment without the line (a redeploy of Release 3's commit, D111) runs the same Node as Release 4. The two change only together.
- **Moving to another major version** is a decision of its own: the link tests, the corpus tests and the Node-against-Chrome comparison are run again on it first, and the line and the project's setting change in one step.
- *Depends on:* Vercel supporting Node 22 for builds and functions.

### D114 · The consortium's answers of 27 October (amends D78's name field)
**Decided**: 27 October 2026 (DIESIS's answers to the reply of 20 October); recorded 31 October 2026 · *Decider: the consortium (DIESIS)*
- **Q17, full name.** The profile step asks for the person's full name (first and last name), because partners match learners with their own records. The rule stays 1–50 characters with no line breaks or hidden characters; the privacy text says "your full name". Amends D78's "first name or nickname".
- **Defaults confirmed:** Q2, Q4–Q8 (the two built-in courses are archived), Q16 (learning under public-interest education or contract; consent only for optional sharing: `PROFILE_CONSENT` stays off, and Comp Card sharing is the consent record, D80), Q18 (16; `AGE_RULE` unset), Q19, Q20, Q24, Q25, Q26, Q28, Q29.
- **Q27:** videos are uploaded and subtitled; DIESIS works in English, the other partners translate.
- **Q12:** no 1–5 confidence question at the end of every course; partners add confidence to a self-assessment section of their own. The per-course Comp Card sections (December–January) carry no confidence line.
- **Q10, Q11:** the per-course Comp Card sections are approved with every section, quiz included; the learner can tick to put quiz scores on the printed card. December–January work, in neither Release 3 nor Release 4.
- **Q14:** two lists: the sources used to create a course (Release 4's references) and reading material for learners (Release 4's further reading); any citation style, each item with its link.
- **Q21–Q23:** an account inactive for 12 months is deleted after warnings; staff accounts on leaving or at the end of the five-year period; the platform stays available until five years after the funder's final payment (expected September–December 2027). Replaces the 1 July 2028 proposal. Not built yet: no account can fall due before October 2027.
- **Q9, Q13, Q15** came back as questions; their defaults apply and are explained to the consortium.
- *Depends on:* nothing further.

### D115 · Releases 2, 3 and 4 go live together (amends D71's and D102's dates)
**Decided**: 31 October 2026 · *Decider: SENIC principal*
- Releases 2, 3 and 4 deploy together as soon as the release check and the rehearsal pass: `main` is fast-forwarded to the tested `r4` commit. The dates of 10, 20 and 26 November are replaced, so partners test every feature on the live site before the pilot.
- Before the push: an on-demand backup is green; all six migrations are rehearsed together on a Neon branch of production with `backfill-course-badges.mjs` and the three checks (`r2-progress-check`, `r3-check`, `r4-check`); `BLOB_PUBLIC_HOST` is set on production; production has no demo sign-in variables.
- Release 3's production security review and Release 4's independent security review run on the live code before any real participant signs in (pilot 1 December). Until Release 3's review passes, `R3_PARTNER_ACCESS` stays off and no partner admin is invited (D77); partner staff work as editors, and as learners with test accounts.
- Rollback: the kill switches first; a Vercel instant rollback to the Release 1 deployment only while no `PARTNER_ADMIN` membership exists and no real learner has signed in, and it is not rehearsed; after that, fix forward.
- *Depends on:* no real participant signing in before 1 December.

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

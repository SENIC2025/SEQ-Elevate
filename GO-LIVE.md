# SEQ Elevate — production go-live runbook

This is the checklist to take SEQ Elevate from the **demo deploy**
(`seq-elevate-demo.vercel.app`, demo login on, placeholder data) to a
**real production launch** serving NEET learners.

**Decided (21 Aug 2026):** hosting stays on **Vercel** (D22); production **reuses
the existing demo Vercel project** flipped to production mode (D23); public host
is the apex **`seq-elevate.eu`** (O1). Because prod reuses the demo project/DB,
follow the **cutover hygiene in §2a** before the first real learner.

Legend: **[SENIC]** engineering can do · **[Dashboard]** set in Vercel/Resend UI ·
**[Consortium]** owned by the programme.

---

## 1. Environment variables (Vercel → production project → Settings → Environment Variables)

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Neon **pooled** connection string | Already set for the app. EU region. |
| `DIRECT_URL` | *(optional)* Neon **direct** string | Only if the auto-derived direct endpoint (pooled host minus `-pooler`) is wrong. Used for migrations. |
| `AUTH_SECRET` | **a fresh strong secret** | Generate: `openssl rand -base64 33`. **Must not** be the dev placeholder. Rotating it signs everyone out. |
| `AUTH_URL` | `https://seq-elevate.eu` | The canonical production URL (decided — apex, O1). Pins host detection + magic-link base. |
| `ADMIN_EMAILS` | `a@partner.eu, b@partner.eu` | **Admin bootstrap.** Comma/semicolon/space-separated emails that get ADMIN + Content-Editor (D25). Applies on their next sign-in **or page load** after a redeploy — no sign-out needed (D26). They then add everyone else via *Manage people*. |
| `RESEND_API_KEY` | `re_…` restricted **sending** key | From Resend. Sending-only scope. |
| `EMAIL_FROM` | `SEQ Elevate <no-reply@your-domain>` | Must be on a **verified** Resend domain (see §4). |
| `DEMO_LOGIN_ENABLED`, `DEMO_ACCESS_CODE` | **unset on production** | One-click demo sign-in is opt-in (D98): it runs only where `DEMO_LOGIN_ENABLED=true` **and** a private `DEMO_ACCESS_CODE` of 12 or more characters are set, and never on the production deployment (`VERCEL_ENV=production`), whatever they say. Set them only on a showcase preview with a database of its own (§2). |
| `DEMO_LOGIN_DISABLED` | `true` | No longer read by the live code (D98). Keep it on production: the Release 1 deployment, the one rollback target (§11), reads it. |
| `RATE_LIMIT_SECRET` | *(optional)* | Key for the rate limiter's keyed hashes (D96). Unset: a key derived from `AUTH_SECRET` is used. Changing either starts every counter again (harmless). |
| `SIGNIN_EMAILS_PER_IP_15MIN` | *(unset)* = 30 | Sign-in emails one client (its network address; IPv6 by /64) may ask for in 15 minutes (D116). A whole number of at least 1; anything else means 30, logged once. |
| `SIGNIN_EMAILS_PER_HOUR` | *(unset)* = 200 | Sign-in emails the whole site sends in an hour (D116); set it with the Resend plan's sending quota in mind. A whole number of at least 1; anything else means 200, logged once. |
| `BLOB_READ_WRITE_TOKEN` | auto-set by Vercel Blob | Present once a Blob store is connected. **Use a Frankfurt (`fra1`) store — see §5.** |
| `BLOB_PUBLIC_HOST` | the Blob store's public host, e.g. `abc123xyz.public.blob.vercel-storage.com` (no `https://`, no path) | **Required on production** (Release 3, D91): the one store lesson videos, captions, posters and documents may come from, and the one the content security policy admits. Without it no upload can be attached on production. **Read when the site is built** for the policy (below). |
| `R3_CSP` | *(unset)* | `report-only` makes the content security policy report instead of block (a Release 3 rollback switch, §11). **Read when the site is built** (below). |
| `R3_PARTNER_ACCESS` | *(unset)* until Release 3's security review passes | `on` lets partner admins and partner facilitators see their own organisation's learners (D77). Set by the owner, with a redeploy, once Release 3's production security review has passed (D115, §1a step 6); until then no partner admin is invited. Unset again if a scoping problem appears (§11). |
| `STATS_FROM` | *(unset)* | When statistics start counting: unset is 1 Dec 2026, 00:00 Brussels; an ISO date that moment; `off` no date. Only a preview for QA sets a past date. |
| `PROFILE_CONSENT` | *(unset)* = `off` (Q16, confirmed on 27 Oct: D114) | `optional` or `required` shows the separate consent box on the profile step (Q16), but only once the consent text is final: while its version (`profile.consent.version` in the messages) starts with `draft-`, the box stays off and the log says so once. Any other value means `off`, logged once without the value. |
| `AGE_RULE` | *(unset)* = 16 | The minimum age to sign up alone: a number of 13 or more, or `digital-consent` (Belgium 13, Cyprus 14, Greece 15, Germany 16, other 16), per the lawful basis (Q18). Anything else means 16, logged once without the value. |
| `R3_PROFILE_GATE` | *(unset)* | `off`: nobody is sent to the profile step, and nothing of anyone without a complete profile is saved (they are told). A rollback switch (§11). |
| `R3_LANGUAGE_READY` | *(unset)* | `off`: every language counts as switched on (Release 2's field-by-field mix). A rollback switch (§11). |
| `R3_BLOB_DELETE` | *(unset)* | `off`: the clean-up run keeps the course files waiting to be deleted (they stay queued). A rollback switch (§11). |
| `R2_LEARNER_PLAYER` | *(unset)* | `off`: learners get every course as Release 1 showed it, its standard lessons (Release 2's rollback switch, §11). |
| `R4_FURTHER_READING` | *(unset)* | `off`: learners and the preview get no further-reading list and no references link, and the references page answers "not found"; editors keep editing and nothing is deleted (D111). A rollback switch (§11). |
| `R4_ITEM_LANGUAGE` | *(unset)* | `off`: every published document and further-reading link shows in every language, as documents did before Release 4 (D111). A rollback switch (§11). |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | your domain | Enables cookieless analytics. Optional. **Read when the site is built** (below). |
| `CMS_SOURCE` | *(unset = `local`)* | Leave unset; the in-app DB CMS is the content source. Only set to `strapi` if Strapi is ever adopted. |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | *(paste DSN to activate)* | Sentry is already wired + inert; set both to your DSN and redeploy. See §6. |

> After changing env vars, **redeploy** so they take effect.

> **Read when the site is built, not when a page is served** (Release 3): `BLOB_PUBLIC_HOST`, `R3_CSP`, `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` / `NEXT_PUBLIC_PLAUSIBLE_SRC` and `NEXT_PUBLIC_SENTRY_DSN` (with `SENTRY_DSN`) are written into the content security policy when the site is built (`next.config.ts` → `src/lib/security-headers.ts`), and the `NEXT_PUBLIC_…` ones into the pages' scripts too. A change takes effect only with a **redeploy that builds again** (Deployments → the latest Production deployment → Redeploy). **Promote** and instant rollback reuse a deployment as it was built, with the values it was built with. `BLOB_PUBLIC_HOST` matters twice: the server checks every attached file against it on each save, but the policy that lets browsers load those files is the built one, so until the redeploy a changed value lets a file be attached that pages then don't show. After the redeploy, check with `curl -sI https://seq-elevate.eu/en`: the `Content-Security-Policy` line (`Content-Security-Policy-Report-Only` with `R3_CSP=report-only`) names the Blob host, and Plausible's and Sentry's hosts only when they are switched on.

---

## 1a. The go-live of Releases 2, 3 and 4 (Sat 31 Oct 2026)  **[Owner] + [SENIC]**  *(Decisions D115, D77)*

Releases 2, 3 and 4 went live together on Sat 31 Oct 2026 (D115), in place of the dated plan of 10, 20 and 26 November, so partners test every feature on the live site before the pilot. BUILDLOG's go-live entry records each step. The owner (or the named deputy) runs every database step; the build never connects to anything but the database Vercel gives it.

**Done on 31 Oct**

1. **Before the push.** The rehearsal (§1b) passed on the commit deployed, and an on-demand backup was green (BACKUP.md). On production (§1): `BLOB_PUBLIC_HOST` set (without it no upload can be attached); neither `DEMO_LOGIN_ENABLED` nor `DEMO_ACCESS_CODE`; Node.js 22.x (D113). `PROFILE_CONSENT`, `AGE_RULE`, `R3_PARTNER_ACCESS`, `STATS_FROM` and every rollback switch stay unset (§1).
2. **The deploy.** `main` was fast-forwarded to the tested `r4` commit and pushed. `vercel-build` applied the six migrations (Release 2's `20261021120000_enrollment_sections_responses`; Release 3's `20261120090000_r3_role_partner_admin`, `20261120090100_r3_people_privacy_content`, `20261120090200_r3_course_project_columns` and `20261120090300_r3_sharing_and_guardian_triggers`; Release 4's `20261126090000_r4_further_reading`), back-filled badges, skipped the demo seed and built.
3. **Checks signed out:** the security headers on every page (`curl -sI https://seq-elevate.eu/en`), the policy admitting the Blob host; `/en`, `/de`, `/el`, sign-in, `/en/help` (shows 112), the privacy page (it says "your full name") and the terms answer; the data download answers 401; `/en/demo` shows "not found"; `/en/welcome` sends a visitor who is signed out to sign-in; sign-in links are built on `seq-elevate.eu`.
4. **An ADMIN, before anyone else completes a profile:** completed their own profile; checked the five rows of the country mapping on Organisations & cohorts; marked the three showcase accounts as test accounts (Admin → Data); in a draft course, attached an uploaded PDF (`BLOB_PUBLIC_HOST` works), added a further-reading link (Preview as learner shows it with its site's box), and saw the YouTube gate before any YouTube load.

**Still to come, before the pilot on Tue 1 Dec**

5. **The security reviews**, on the live code, by Daniele Tappa (DIESIS): Release 3's production security review and Release 4's independent security review, both before 1 Dec (D115). Until Release 3's has passed, `R3_PARTNER_ACCESS` stays unset and no partner admin is invited (D77): partner staff work as editors, and as learners with test accounts marked as such (§2b).
6. **Once Release 3's review has passed:** the owner sets `R3_PARTNER_ACCESS=on` with a redeploy; an ADMIN sets the organisations of real staff; partner admins are invited. If it fails: fix, and review again; the switch stays unset.
7. **Until partner admins are invited:** an ADMIN (DIESIS or SENIC) switches German or Greek on for a course at the partner's written request, and enters safeguarding contacts as they arrive.
8. **Partner QA** on the live site, with test accounts marked as such: every feature, the guest-work walk of §1b step 3 among them.
9. **Mon 30 Nov:** the go-live clean-up run (§2b, step 4) and the go/no-go.
10. **Tue 1 Dec:** the pilot starts; statistics count from then (`STATS_FROM` unset).

**If a migration fails** on a deploy, the build fails and the deployment before it keeps serving. The build log's `[migrate-deploy]` lines name the migration and say whether it applied nothing or may be partly applied. Prisma records the migration as failed, and every later build (a retry, a revert, a fix) fails with P3009 until it is resolved: the owner runs `npx prisma migrate resolve --rolled-back <the failed migration's folder name>` against the **DIRECT** endpoint, notes it in BUILDLOG, removes the cause (a lock timeout: deploy again at a quieter moment) and deploys again.

## 1b. The rehearsal before a deploy with migrations  **[Owner] + [SENIC]**  *(Decisions D115, D71, D77)*

On a Neon **branch** of production. The build never connects to production.

Before the go-live of 31 Oct 2026, the six migrations were rehearsed together on a branch of production (`golive-rehearsal`, deleted after a day): `migrate-deploy.mjs` applied them in 4.7 s, then `backfill-course-badges.mjs` ran and `r2-progress-check`, `r3-check` and `r4-check` each held (BUILDLOG). A later deploy that adds a migration is rehearsed the same way, on a fresh branch:

1. **The migrations, timed.** With the branch's `DATABASE_URL` and `DIRECT_URL`: `node prisma/migrate-deploy.mjs` (note how long it takes in BUILDLOG), then `node prisma/backfill-course-badges.mjs`, then the checks: `npx tsx scripts/r2-progress-check.ts`, `npx tsx scripts/r3-check.ts` and `npx tsx scripts/r4-check.ts`. Stop on any check that doesn't hold.
2. **A preview of the branch,** when the change needs walks by hand: deployed from the local worktree with the Vercel CLI, with the branch's `DATABASE_URL` and `DIRECT_URL` given explicitly for both the build and the run (never the Preview defaults: the build migrates whatever database it is given), `BLOB_PUBLIC_HOST`, neither `DEMO_LOGIN_ENABLED` nor `DEMO_ACCESS_CODE`, and Vercel Deployment Protection on.
3. **Guest work, by hand** (D79), on that preview or, before the pilot, on the live site with test accounts marked as such, each in a fresh browser profile:
   - **guest, sign-up, Add:** as a guest, play a course part way, write a reflection answer and a Comp Card answer; sign up with a new test address (the email link opens in another tab) and complete the profile step; the offer names the course, the Comp Card and the badges and says to add them first. "Add it to my account" says "Added to your account."; the course, the Comp Card ("Only me") and any badge are in the account; reloaded, nothing is offered;
   - **a tab kept the guest's:** keep the guest's tab open while signing in in the other one; it says it stays the guest's. Open the Comp Card from its dashboard: the page loads in full as the account's, which offers the work. In a second try, add the work in the signed-in tab while the guest's tab is still open: the guest's tab says the work was changed in another tab, and finishing a lesson there brings nothing back into the offer;
   - **an account that already has work:** sign in as a test account with progress in the course and an answer on its Comp Card, after playing that course and writing a Comp Card answer as a guest in this browser. "Add" says the account keeps its own progress and its own Comp Card, the badge (if any) is added, and nothing of the account's changes; "Remove it from this browser" clears what stays.
   Note each outcome in BUILDLOG; the server log's `[guest-claim]` lines count them.
4. The branch is deleted once nothing needs it. If `main` gains a migration after the rehearsal, it is repeated on a fresh branch before the deploy.

---

## 2. Demo sign-in is off unless a showcase switches it on  **[Dashboard]**  *(Decision D98)*

One-click demo sign-in (`/demo`) and the seeded demo course run only on a
deployment that opts in, with **both** `DEMO_LOGIN_ENABLED=true` and a private
`DEMO_ACCESS_CODE` of at least 12 characters, and **never** on the production
deployment (`VERCEL_ENV=production`), whatever the variables say
(`src/lib/demo-gate.ts`; the demo seed applies the same conditions).

- **Production:** set neither variable. Sign-in is by email link only, and
  `/en/demo` shows "not found".
- **A showcase preview:** only with a database of its own. Never on a deployment
  whose database is production or a branch of production (the rehearsal and
  review previews included): they set neither variable.
- No demo profile uses a real person's address (the admin profile is
  `demo-admin@seq-elevate.eu`).
- Keep `DEMO_LOGIN_DISABLED=true` on production anyway: the live code doesn't
  read it, but the Release 1 deployment, the one rollback target (§11), does.

---

## 2a. Cutover hygiene — because production reuses the demo project  **[Dashboard] + [SENIC]**  *(Decisions D23, D88)*

Production shares the demo project's database and Blob store, so isolation is by
these steps, not by separate infrastructure. Do them **before the first real
learner**, and keep to one rule throughout: **nobody edits the production
database by hand.** Every change to people's data goes through the platform,
where it is checked and logged.

1. **Demo sign-in off on production** (§2): neither `DEMO_LOGIN_ENABLED` nor
   `DEMO_ACCESS_CODE` is set, and `/en/demo` shows "not found".
2. **End every showcase sign-in session on deploy day.** Sessions are rows in
   the database, looked up by the cookie: rotating `AUTH_SECRET` does not end
   them. The sessions of one-click demo sign-in (Admin → Data calls them
   showcase sign-in sessions; their token starts `demo-`) end when a clean-up
   run deletes every such row, expired or not. The first run does only that, on
   deploy day, before anyone marks an account (§2b, step 0). Rotating
   `AUTH_SECRET` is optional hygiene; it ends no database session.
3. **Remove demo and test accounts through the platform.** On **Admin → Data**
   (`/admin/data`), mark the demo profiles' accounts and every other test
   account as test accounts (the review lists there find them), then erase them
   with the clean-up run (§2b). Each erasure is complete (activity records,
   sign-in links and rate-limit counters included) and leaves one record that an
   account was deleted, so it can be applied again after a restore (BACKUP.md).
4. **Archive the demo course.** An editor archives `demo-speaking-up` with
   **Archive** on Manage courses. Course files removed from lessons are queued and
   deleted by the clean-up run once they are 7 days old and nothing uses them.

After these, real learner records and any leftover test records share one
database, governed by the platform's roles and scoping. If the consortium later
wants hard infrastructure isolation, migrating to a separate clean project/DB is
an option (reverses D23).

---

## 2b. Go-live data clean-up  **[SENIC] with DIESIS watching**  *(Decisions D85, D88, D92)*

The clean-up tool is on **Admin → Data** (`/admin/data`), for ADMINs only. The
runbook is [docs/data-management.md](docs/data-management.md); in short:

| Step | Who | When |
|---|---|---|
| 0. **End the showcase sign-in sessions.** A dry run on production must show **0** marked test accounts and **0** course files to delete; then run it with `ERASE 0 TEST ACCOUNTS`. It erases no account and deletes no file: it ends every showcase sign-in session and purges expired sessions and sign-in links. The owner's `r3-check` then counts no `demo-` session. Because it erases nothing, it needs no rehearsal. | SENIC (an ADMIN); the owner runs `r3-check` | Deploy day (Sat 31 Oct), right after the smoke test, **before anyone marks an account** |
| 1. **Mark** test accounts (one at a time, or ticked on the review lists) | SENIC or DIESIS | During partner QA |
| 2. **Dry run** on production: counts per table of what a run would delete, each account it would erase with its roles (a staff role is pointed out), the accounts it would leave and why, and the trial courses still live | SENIC, DIESIS watching | After partner QA (Fri 27 Nov) |
| 3. **Rehearsal**: the same run for real on a fresh Neon branch of production, through a preview deployed against that branch (never production's own deployment) | The owner (database steps) and SENIC | The same day |
| 4. **Run** on production: type `ERASE <n> TEST ACCOUNTS`, with n the number the dry run shows | SENIC, DIESIS watching | Mon 30 Nov, morning |

The run erases the marked test accounts (one transaction each, reference
`CLEANUP-<run>`), deletes every showcase sign-in session and every expired
session and sign-in link, and deletes queued course files that are 7 days old
and unused.
It is recorded as `data.cleanup_run` with its counts, and shown in the log on
the same page. It can be run again; a second run does only what has become due
since. After the pilot starts it is run monthly (docs/data-management.md).
Editors archive trial courses; statistics ignore course status on purpose.

---

## 3. Domain + DNS — **`seq-elevate.eu` (apex)**  **[Consortium/SENIC owns DNS] [SENIC assists]**  *(Decision O1 — closed)*

Production host is the **apex `seq-elevate.eu`** (decided), with **`www` redirecting to it**.

1. In Vercel → the project → **Domains**: add **`seq-elevate.eu`** *and* **`www.seq-elevate.eu`**. Vercel offers to auto-redirect `www` → apex — accept it.
2. In DNS for `seq-elevate.eu`:
   - **Apex** can't use a `CNAME` (DNS rule) → add the **A record** Vercel shows (Vercel's anycast IP, currently `76.76.21.21` — use whatever the dashboard displays).
   - **`www`** → add the **`CNAME`** Vercel shows (`cname.vercel-dns.com`).
   - Vercel auto-verifies and issues the SSL certificate.
3. Set **`AUTH_URL=https://seq-elevate.eu`** and **redeploy**.
4. Email is unaffected: `no-reply@seq-elevate.eu` (SPF/DKIM/MX, §4) uses different record types than the A record — mail keeps working.

> ⚠️ **Hyphen check**: the consortium's brand/marketing site was noted as `seqelevate.eu` (no hyphen). The platform domain is `seq-elevate.eu` (with hyphen). Confirm both are intentional so the brand isn't split — see DECISIONS O1.

---

## 4. Email deliverability (magic-link sign-in)  **[Consortium DNS] [Dashboard]**

Sign-in is passwordless — if email doesn't deliver, no one can log in.
- In Resend: add and **verify** the sending domain (add the DKIM + SPF/return-path DNS records Resend provides).
- Point `EMAIL_FROM` at an address on that verified domain.
- Send a test sign-in to a real inbox (incl. Outlook/Gmail) and confirm it lands **in the inbox, not spam**.

### When an email doesn't arrive — how to find out why

All platform email (sign-in links and invitations) goes through **Resend**, from `EMAIL_FROM` (currently `SEQ Elevate <no-reply@senic.world>`), using `RESEND_API_KEY`.

1. **Ask the platform.** In *Manage people*, click **Resend invitation** on the person. The screen now reports the truth: either *"sent"* (Resend accepted it) or *"couldn't be sent — the email service said: …"* with Resend's own reason. (Before 29 Sep 2026 a refused invitation was wrongly reported as sent — D27 addendum.)
2. **If it says sent → Resend has it; check delivery.** Resend dashboard → **Emails** → search the address. *Delivered* = it reached their mail server → check **spam/junk/quarantine** (organisation mailboxes often quarantine first contact). *Bounced* = the address is wrong or doesn't exist. *Delayed* = their server is deferring; Resend retries.
3. **Server log.** Vercel → the project → **Logs**, search `[email]`: every send is recorded as *"Resend accepted the … email to …@domain (id …)"* (the id matches Resend's dashboard) or *"Resend refused … — reason"*. Only the recipient's domain is logged, never the full address.
4. **Safe test anytime:** sign in (or invite) with `delivered@resend.dev` — Resend's test inbox; nobody receives anything and it shows up in the dashboard.

**Deliverability tip:** emails come from `senic.world` but link to `seq-elevate.eu`; some spam filters dislike that mismatch. Verifying `seq-elevate.eu` in Resend and setting `EMAIL_FROM=SEQ Elevate <no-reply@seq-elevate.eu>` removes it.

---

## 5. File storage region — **EU / Frankfurt (already done)**  **[Dashboard]**  *(Decision D13)*

✅ **Verified:** the Blob store `seq-elevate-demo-blob` is region **`FRA1`
(Frankfurt / AWS eu-central-1, Germany)**. Uploads already reside in the EU —
nothing to do here for the current deployment. Keep **Vercel's DPA/SCCs** on
file (Vercel Inc. is US-domiciled; the data is in Germany).

Only if you stand up a **separate real-production project** later:
1. Create its Blob store in region **Frankfurt (`fra1`)** — region can't be changed after creation.
2. **Connect it to that project** so `BLOB_READ_WRITE_TOKEN` is set, then redeploy.

**Is upload storage working? (29 Sep 2026)** "Connected" in the Vercel Storage
tab is not enough: a running deployment only sees env vars that existed when it
was **built**. To check what the live site itself sees, sign in as an admin and
open **`https://seq-elevate.eu/api/storage/status`**:
- `"storage":"ready"` → uploads work (`"source"` says whether the token has the
  standard name `BLOB_READ_WRITE_TOKEN` or a prefixed one — both work, D29).
- `"storage":"missing"` → the Production deployment has no Blob token: Vercel →
  Storage → the Blob store → connect it to this project with **Production**
  ticked, then **redeploy** (Deployments → latest Production → Redeploy).
The video/document upload panels show the same answer ("File storage
connected" or a plain explanation) before anyone picks a file.

---

## 6. Error monitoring / observability — **wired, activate with a DSN**  **[Dashboard]**

Sentry is fully wired and **inert until a DSN is set** (server + edge via
`src/instrumentation.ts`, browser via `src/instrumentation-client.ts`, plus
`captureException` in both error boundaries). To turn it on:
1. Create a Sentry project → copy its **DSN**.
2. In Vercel, set **`SENTRY_DSN`** and **`NEXT_PUBLIC_SENTRY_DSN`** to that same DSN value.
3. Redeploy. That's it — errors start reporting.

Notes:
- Privacy-conservative by default: **no PII, no performance tracing, no session
  replay** (replay would record a vulnerable learner's screen — only enable it
  deliberately, with a DPIA). Raise `tracesSampleRate` if you want performance data.
- With no DSN, the Sentry client SDK is **tree-shaken out** — zero cost to learners.
- Readable stack traces (source-map upload) are **not** wired, to keep the
  Turbopack build clean. To add them later: enable `withSentryConfig` and set
  `SENTRY_AUTH_TOKEN`.

---

## 7. Data protection & legal  **[Consortium]**

- **DPIA** completed and signed off (required — vulnerable-youth target group). *(O6)*
- **Safeguarding policy** referenced from the platform's Privacy page. *(O6)*
- **Privacy policy + Terms** final wording written by counsel and dropped into
  `src/data/legal.ts` (SENIC has built the render surface; every consortium
  field is boxed "To be completed before launch"). *(O7)*
- DE/EL translations of the legal pages.
- Cookie + Accessibility statements are **already written and accurate** — review only.

---

## 8. Content & people  **[Consortium]**

- At least one **real course** authored + published in the CMS (the engine + code-free authoring are done). *(O3)*
- Real **organisations / cohorts** created (Admin → Organisations & cohorts).
- **Facilitators** added (Admin → People) — they sign in via magic link.
- Pilot **launch date** set. *(O4)*

### Onboarding model — no self-service role picker  *(Decision D25)*

Sign-in **is** sign-up (passwordless: the first magic-link click creates the account). Roles are **granted, never self-selected** — a public "choose admin" would expose all learner PII + GDPR controls. The chain:

1. **Bootstrap admins** — set `ADMIN_EMAILS` (§1) to the consortium's admin emails and **redeploy**. They sign in via magic link (or just reload, if already signed in) → Admin + Content-Editor.
2. **Everyone lands on "Your workspaces"** (D26) — cards for exactly what their roles allow: *Create courses*, *Manage courses*, *Manage people*, *Support learners*, *Statistics*, *My learning*. A switcher in the top bar moves between them. Learners, who only have *My learning*, skip the hub and go straight to their courses.
3. **Admins add everyone else** — *Manage people*: add trainers/teachers/learners by email with a role (+ org + cohort). By default they get an **invitation email** (EN/DE/EL, chosen per person) with a one-click **Join SEQ Elevate** button valid 7 days (D27); the list shows **Invited** → **Joined**, with **Resend invitation**. Admins can add other admins here too.
4. New users not on the list and not added by an admin sign in with **no elevated role** — they get *My learning* only.

> Note: an ADMIN sees **project-wide** data (all organisations). Partner admins and facilitators see only their own organisation's learners, once `R3_PARTNER_ACCESS` is on (DATA-PROTECTION §3).

---

## 9. Recommended before first real cohort  **[SENIC]**

- [x] Legal-page render surface + footer — **done**
- [x] Rate-limiting on sign-in + uploads — **done**
- [x] Sentry wiring — **done**; activate by setting the DSN env vars (§6)
- [ ] Security reviews on the live code before 1 Dec (§1a step 5): Release 3's production security review and Release 4's independent security review (D115)
- [x] **Daily off-site DB backups, 30-day retention** — `.github/workflows/db-backup.yml` (see [BACKUP.md](BACKUP.md)); active since 20 Oct 2026 (Scaleway Paris, D61; first verified run that day). Neon point-in-time restore is the second layer: 1 day by default on Launch — set the History window to 7 days (BACKUP.md, B1); the Free plan is fixed at 6 hours.
- [ ] **Hosting substitution approved** by the consortium (Vercel/Neon vs the proposal's Hetzner) — send [HOSTING-SUBSTITUTION.md](HOSTING-SUBSTITUTION.md). Needed for a clean Item 2 invoice.
- [ ] (Optional) external WCAG 2.2 AA audit — internal audit passes today *(O5)*

---

## 10. Pre-launch verification (run against the production URL)

1. `/en/demo` shows "not found" (demo sign-in never runs on production, §2).
2. Magic-link sign-in delivers to a real inbox and logs you in.
3. A learner can open a published course, play all 7 stages, and complete it.
4. Account page: export **and** delete work (GDPR self-service). **Admin → Data**: a dry run of the clean-up shows its counts (§2b).
5. `/en/legal/privacy|terms|cookies|accessibility` all render.
6. Admin can create an org + cohort and add a person.
7. Analytics dashboard loads for a facilitator.

---

## 11. Rollback

Vercel keeps every deployment, and **Promote** (an instant rollback) puts an older one back at once. The database migrations are additive, so putting code back needs no database change.

### Releases 2, 3 and 4 (live since Sat 31 Oct 2026), in this order  *(Decisions D115, D77, D111)*

1. **The switches first**, with a redeploy of the same code (they are read on every request):
   - `R3_PROFILE_GATE=off` for a loop at the profile step; `R3_LANGUAGE_READY=off` for a broken language choice; `R3_BLOB_DELETE=off` if deletions misfire; `R3_PARTNER_ACCESS` unset if partner staff see what they shouldn't (they then see no learner);
   - `R4_FURTHER_READING=off` for further reading or references; `R4_ITEM_LANGUAGE=off` for documents' and links' languages. Nothing switches off the address check, the draft filter or links hidden until shown (D111);
   - `R2_LEARNER_PLAYER=off` for courses as built: learners then get every course as Release 1 showed it, its standard lessons. A course whose lessons that view doesn't hold (lessons of its own, or none left to show) can't be finished under the switch: its completion and badge wait until the learner has done its real lessons, once the switch is unset again;
   - `R3_CSP=report-only` is read when the site is built (§1): its redeploy must build again, and a promoted older deployment keeps the policy it was built with.
2. **The Release 1 deployment** (instant rollback to the deployment that served before 31 Oct), only while **no `PARTNER_ADMIN` membership exists** (`scripts/r3-check.ts` counts them) **and no real learner has signed in**. It is not rehearsed. `DEMO_LOGIN_DISABLED` stays `true` (Release 1 reads it). What Releases 2–4 added stays in the database. Release 1 lets learners finish a course with lessons of its own by going through its standard lessons, and the database keeps a completion for good: before promoting it, unpublish every published course with lessons of its own (Manage courses), and publish them again after rolling forward.
3. **After that: fix forward only.** The switches of step 1, then a fix deployed the normal way. Never a deployment older than the live one.

---

## 12. Cost lifecycle — pay for the pilot, drop to ~€0 when passive  *(Decision D24)*

The platform has a short **active** phase (~120 learners, ~1 year) then a long **passive** phase. Match the database plan to that; Vercel Pro is already paid, so the only new cost is Neon.

| Phase | Neon plan | Cost | Action |
|---|---|---|---|
| **Active** (pilot) | **Launch** (usage-based) | ~$15/mo (~€165 for the year) | Default for go-live — no cap, no cold-start lag, includes point-in-time recovery |
| **Passive** (project ended) | **Free** | **$0** | Downgrade when activity drops off |

**When activity goes passive — downgrade, don't cancel:**
1. Neon dashboard → the project → **Settings / Billing** → change plan **Launch → Free**. Same database, same connection string, **no migration, no code change**. (120 learners' data is tens of MB — far inside Free's 0.5 GB.)
2. That's it — cost drops to $0; the platform stays live (Free auto-sleeps and wakes on the next visit).
3. **Never "cancel"/delete the Neon project** while the app is live — that destroys the database. To fully mothball later: `pg_dump` the DB, take the Vercel deployment offline → true €0, redeployable if ever needed.

> Total new cost across the whole lifecycle ≈ **€150–200 for the pilot year, then ≈ €0**. A Hostinger VPS (~€400–600) was considered and rejected: it never drops to zero, still needs patching when idle, and would force a Blob→S3 rewrite (D24).

---

*Realistic critical path: the SENIC engineering items are ~1–2 days. The launch
gating items are the **consortium** ones — domain, DPIA + legal text, verified
email domain, and at least one real course.*

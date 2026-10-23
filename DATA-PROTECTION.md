# SEQ Elevate — data-protection technical description (for the DPIA / processing register)

This document is SENIC's **technical** description of how the SEQ Elevate
platform processes personal data. It supports the DPIA and the record of
processing activities of the data controller, **DIESIS** [For DIESIS / its
adviser: legal name]. It is not legal advice.

**Roles (consortium answer K1):**
- **DIESIS** is the data controller.
- **SENIC** develops and operates the platform as DIESIS's processor.
- Staff of the partner organisations (Pro Arbeit, Synthesis, University of
  Macedonia) view learner data on DIESIS's behalf, under an annex to the
  consortium agreement.
- The partners are responsible themselves for the participant lists they keep
  outside the platform. [For DIESIS / its adviser: confirm how the partners'
  role is described. SENIC's plan assumes they are independent controllers for
  those lists.]

Fields that belong to the **data controller** (legal basis, retention periods,
controller identity) are marked **[Controller]** or **[For DIESIS / its
adviser]**. DIESIS completes them with its legal adviser. Facts SENIC still
checks in a provider dashboard are marked **[SENIC to confirm]**; fixes SENIC
has taken on are marked **[SENIC action]**. "The letter" means SENIC's letter to
the consortium of 13 October 2026, which records the consortium's answers
(K1–K11) and SENIC's suggested defaults (Q-numbers).

_Last updated: 2026-10-22. Describes the platform as Release 3 deploys it on
20 Nov 2026, before the 1 Dec 2026 pilot. Where a part takes effect later, the
date is given: partner staff see learners from the production security review
(23 Nov 2026, invitations from 25 Nov); statistics count from 1 Dec 2026; the
go-live clean-up runs on 30 Nov 2026. Maintained by SENIC (developer and
operator; processor)._

---

## 1. How and where is the platform technically operated?

**Cloud (public cloud, managed services).** It is **not** on-premises and not a
dedicated/private cloud. From the perspective of DIESIS, the controller, it is
provided as **Software-as-a-Service**, operated by SENIC on the following
managed-cloud providers (sub-processors):

| Component | Provider | Hosting location | Personal data involved |
|---|---|---|---|
| Application / compute (serverless) | **Vercel** (Vercel Inc., US) | **EU — Frankfurt (`fra1`)**, pinned in `vercel.json` (29 Sep 2026; previously Vercel's default `iad1`, US East) | Processes requests in transit, and keeps request logs (note 1) |
| Primary database (PostgreSQL) | **Neon** (Neon Inc., US) | **EU — Frankfurt (AWS eu-central-1)** | All stored personal data |
| File/media storage (uploaded documents & lesson videos) | **Vercel Blob** | **EU — Frankfurt (`fra1`, AWS eu-central-1)** | **Staff-authored course media only** — learners upload nothing. Files are stored at public addresses (note 2) |
| Transactional email (sign-in links and invitations) | **Resend** (Resend Inc., US) | US | Recipient email address; for invitations also their optional name, role, and the inviting admin's name (or email) (note 3) |
| Off-site database backups, daily since 20 Oct 2026 (kept 30 days; the newest 7 copies are always kept) | **Scaleway** (Scaleway SAS, France, EU) | **EU — Paris (`fr-par`)** | A full copy of the database except session and sign-in-token rows, in a private bucket encrypted at rest (note 4) |
| Backup runner (runs the nightly backup job), source code, automated tests | **GitHub** (GitHub Inc., US) | [SENIC to confirm. The workflow uses a GitHub-hosted runner and does not choose where it runs (`.github/workflows/db-backup.yml:49`).] | The full database dump exists briefly on a temporary GitHub-hosted runner during each nightly run (note 5) |
| Web analytics (**not active today**; only if activated) | **Plausible** (Plausible Insights OÜ, Estonia, EU) | EU | None while inactive [to confirm]; cookieless if activated (note 6) |
| Error monitoring (**not active today**; only if activated) | **Sentry** (Functional Software Inc., US) | — [to confirm if activated] | None while inactive [to confirm]; see note 7 if activated |

**Notes to the table**

1. **Vercel request logs.** [SENIC to confirm in the Vercel dashboard: what the
   logs record (normally the IP address, the browser and the requested address)
   and how long the current plan keeps them.] The address of a sign-in or
   invitation link contains the email address and the one-time token, so both
   can appear in these logs.
2. **Vercel Blob.**
   - Files are stored at public addresses (`src/components/role/useBlobUpload.ts:106`).
   - Each address includes a random part, so it cannot be guessed
     (`src/app/api/document/upload/route.ts:44`).
   - But anyone who has a file's link can open it. That includes documents not
     yet shown to learners.
   - A file removed from a lesson (a document removed, a video cleared or
     replaced, a lesson deleted) is queued. The ADMIN clean-up run deletes it
     from the store once it is 7 days old and nothing uses it again; until then
     it stays reachable by its address. Only the production deployment deletes
     files, and only from its own store (`src/lib/account-data.ts`,
     `deletePendingFiles`; D92).
3. **Resend.**
   - Sign-in emails are in English, with the privacy notice linked in the
     language the person signed in from. Invitations are in English, German or
     Greek.
   - Both load the logo from the platform's own address. So when the mail
     program shows images, opening an email sends a request to Vercel.
   - The sender is `no-reply@senic.world` unless the server setting
     `EMAIL_FROM` changes it (`src/auth.ts:46`). [SENIC to confirm the
     production sender.]
   - [SENIC to confirm: open and click tracking are switched off in Resend.]
4. **Scaleway backups.**
   - Daily since 20 Oct 2026. Copies are kept 30 days; the newest 7 copies are
     always kept, so if backups stop, an older copy can remain until new ones
     replace it. Deletion runs only at the end of a successful nightly backup
     (see §5).
   - **Contents:** a full copy of the database, except the rows of the session
     and sign-in-token tables (and Neon's own `neon_auth` schema, which the app
     does not use). That includes accounts, all learning data, staff notes, and
     the audit and activity log (`scripts/db-backup.sh:121-126`).
   - **Encryption:** the bucket is private and encrypted at rest (SSE-ONE).
     Dumps would also be encrypted before upload if an age key were set; as of
     20 October 2026 none is (client-side encryption off; BACKUP.md part D).
   - Uploaded files in Vercel Blob are not backed up.
5. **GitHub.**
   - Every night the full database dump is made on a temporary GitHub-hosted
     virtual machine (runner).
   - It is checked and test-restored there. Only then is it encrypted (if an age
     key is set) and uploaded to Scaleway (`.github/workflows/db-backup.yml:107-146`;
     `BACKUP.md:211-214`). So the dump is unencrypted on the runner for the
     duration of the run.
   - GitHub also stores, as repository secrets, the read-only database login
     and the backup bucket's key (`.github/workflows/db-backup.yml:16-23`).
     People with write access to the repository can change them
     (`BACKUP.md:219-220`).
   - The repository is public. Its run logs show only sizes, counts and the
     PostgreSQL version (`BACKUP.md:33-36`).
   - GitHub Inc. is a US company.
   - [For DIESIS / its adviser: approve GitHub as a sub-processor. The letter
     gives no default; SENIC's plan already lists it.]
6. **Plausible (not active today).**
   - Loads only if the setting `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` is set
     (`src/components/Analytics.tsx:11-27`).
   - Activation is listed as pending (`HOSTING-SUBSTITUTION.md:30`).
     [SENIC to confirm: the setting is unset.]
   - If it is activated, it is cookieless, and Plausible states that it stores
     no IP addresses.
   - [For DIESIS / its adviser: whether to activate it. The letter gives no
     default.]
7. **Sentry (not active today).**
   - Inactive while no DSN is set [SENIC to confirm the DSN is unset].
   - If activated, it is set not to send default personal data such as IP
     address, cookies and user details, and to use no tracing and no session
     replay (`src/instrumentation-client.ts:14-25`; `src/instrumentation.ts:19-34`).
   - An error report can still contain personal data that appears in an error
     message or page address.
   - [For DIESIS / its adviser: whether to activate it. The letter gives no
     default.]

> **File storage residency (D13):** file uploads use the Vercel Blob store
> `seq-elevate-demo-blob`, region **`FRA1` (Frankfurt → AWS eu-central-1,
> Germany)** — **verified in the dashboard**. The store holds **staff-authored
> course media only** (lesson videos/documents); learners upload no files.
> Learner **records** (database) are EU-hosted (Neon, Frankfurt). Keep Vercel's
> DPA/SCCs on file (Vercel Inc. is US-domiciled; the data resides in the EU).

**Not a sub-processor, but contacted by the learner's browser once they press play: YouTube (Google).**
- Where a lesson uses a YouTube video, nothing from YouTube loads until the
  viewer presses **Play video (loads YouTube)** on the platform's own panel. The
  panel says that YouTube (Google) then receives the IP address and browser
  details and may set cookies, and links the privacy notice. Only after the
  press does the player load, from the privacy-enhanced youtube-nocookie.com
  domain. No thumbnail is shown before, and the press isn't remembered: each
  video asks again (`src/components/course/InteractiveVideoPlayer.tsx`; D91).
- After the press, Google receives the learner's IP address and can set
  cookies.
- [For DIESIS / its adviser: SENIC's suggested default (Q27) is to upload
  videos to the platform, with subtitles, and to use YouTube only behind the
  panel, as built and as the privacy and cookie pages say.]
- Lesson videos, captions, posters and documents can be attached only from the
  platform's own file store (`BLOB_PUBLIC_HOST` on production) or as a YouTube
  link; the server refuses other websites (`src/lib/media-url.ts`;
  `src/app/actions/lesson.ts`). A file attached from another website before
  20 Nov 2026 is shown as a link out, which the learner opens only by choice.

**Transfers.** Resend handles email addresses in the US. Vercel, Neon and GitHub
(and Sentry, if activated) are US companies with access to data hosted in the
EU; where GitHub's runner runs is [to confirm]. Each needs an Art. 28
agreement (see §7). [For DIESIS / its adviser: whether each case is a
third-country transfer, and the transfer tool for each provider, for example
SCCs, or whether the provider is certified under the EU–US Data Privacy
Framework.]

---

## 2. Type of data processing (operations that take place)

| Operation | Applies | Where / how |
|---|---|---|
| Organisation & sorting | ✅ | Learners grouped into organisations & cohorts; courses/documents ordered |
| Storage | ✅ | PostgreSQL (Neon, EU) + file storage (Blob) + daily off-site backup copies (Scaleway, Paris; kept 30 days, the newest 7 always kept), each made on a GitHub-hosted runner; guest progress kept in the learner's own browser (local storage) |
| Provision / making available | ✅ | Serving content and a learner's own data back to them and to authorised staff |
| Retention | ✅ | Learner records are kept with no time limit set yet, and no scheduled job deletes them: `vercel.json` has none, and `Cohort.endsAt` is stored but not used. An ADMIN's clean-up run, before launch and then monthly, erases accounts marked as test accounts, ends demo sessions, purges expired sessions and sign-in links, and deletes queued course files (`docs/data-management.md`). Retention period **[Controller]** [For DIESIS / its adviser: retention, see §5.] |
| Retrieval | ✅ | Reading a learner's progress / Comp Card |
| Querying | ✅ | Database queries (parameterised, via Prisma) |
| Modification | ✅ | Updating progress, reflections, roles, cohort assignments |
| Transmission | ✅ | Sign-in and invitation emails (Resend); a person's data export to themselves, or by an ADMIN for a request in DIESIS's register; the nightly backup to Scaleway through GitHub; the learner's browser contacting YouTube where a lesson embeds a YouTube video |
| Distribution | ✅ by organisation | Staff see learner data by organisation, filtered on the server (`src/lib/scope.ts`; D74): DIESIS's and SENIC's admins see every learner; partner admins and partner facilitators see the learners of their own organisation, from the production security review (23 Nov 2026) when `R3_PARTNER_ACCESS` is switched on; staff with no organisation, editors and learners see none. For each learner they see what §2b row 4 lists. The Comp Card is shown only when the learner has shared it, and then only to the facilitators and partner admins of the organisation it was shared with and to an admin of that organisation; SENIC's admins see no Comp Card text (`src/lib/comp-card-visibility.ts`; D80, D81). |
| Matching | ⚠️ limited | Staff dashboards put labels on individual learners who have not completed the course: "needs attention" (progress above 0% and below 50%) and "stuck" (no activity for more than 72 hours). The dashboards also show each learner's assessment score (`src/lib/server-queries.ts:267`; `src/lib/analytics-real.ts:132-136`). The labels are only displayed; the platform takes no automatic action on them. [For DIESIS / its adviser: whether these labels count as profiling that must be disclosed. The letter gives no default.] |
| Linking | ✅ | Linking a user to their enrolments, cohort and organisation |
| Deletion / destruction | ✅ | Self-service account deletion, which deletes linked records (see §2b, retention note). On **Admin → Data**, ADMINs (DIESIS, SENIC) export or erase any account for a request in DIESIS's register (reference `REQ-YYYY-NNN`), and mark, reset and erase test accounts; every use is logged (`src/app/actions/admin-data.ts`; `docs/data-management.md`). "Remove from project" only takes away roles and keeps the account and all its data (`src/app/actions/admin.ts:300-310`); the person's session is not ended, and they get a learner role again on their next signed-in page load (`src/lib/learner-membership.ts:32-37`; `src/app/actions/learner.ts:107-120`). |
| Restriction | ✅ | The Comp Card's sharing choice: "Only me" (the default) stops sharing at any time, from the Comp Card or the account page; each sharing change is logged with the version of the wording shown (D80). Content publish/unpublish. A consent box on the sign-up screen is built and switched off (`PROFILE_CONSENT`); it shows only once a final consent text exists. [For DIESIS / its adviser: SENIC's suggested default (Q16) uses consent only for optional sharing; the Comp Card's sharing choice is then that consent, and "Only me" its withdrawal.] |

---

## 2b. Work processes — what personal data is used at each step

The personal data actually stored is deliberately minimal.
- The platform's own database stores no passwords (sign-in is a one-time email
  link), IP addresses, geolocation or biometric data.
- IP addresses do reach Vercel's request logs, and they reach Google where a
  lesson embeds a YouTube video (see §1).
- The platform sets no advertising cookies. Where a lesson uses a YouTube
  video, YouTube can set its own cookies once the learner presses play (§1).
  All cookies and browser storage are listed in §8.
- The platform does not ask for special-category data. But the free-text fields
  (course reflections, Comp Card, staff notes and evidence) cannot technically
  stop a learner or staff member from writing it. Young people may disclose
  health, family or other sensitive matters there. SENIC's technical part of the
  DPIA treats this as possible.
- [For DIESIS / its adviser: whether the "easy-read (dyslexia-friendlier) font"
  setting (`prisma/schema.prisma:181`) counts as health data. The letter gives
  no default.]

| # | Process | Personal data used | Operation(s) |
|---|---|---|---|
| 1 | **Account creation & sign-in** | The email address. A one-time link is sent through Resend, and the link itself carries the email address and token.<br>**Sign-up step (D78):** before anything else, every account answers a one-time screen: a first name or nickname (1 to 50 characters), the country, acceptance of the Terms of use (the version and the time are stored), and the age statement: "I am ‹minimum age› or older", or, for someone a partner organisation invited after recording a parent's or guardian's permission, "‹organisation› invited me and has my parent's or guardian's permission". The privacy notice is linked, not accepted. A consent box is built and switched off (`PROFILE_CONSENT`). The minimum age is 16 unless `AGE_RULE` sets another (`digital-consent`: Belgium 13, Cyprus 14, Greece 15, Germany 16). Accounts made before 20 Nov 2026 see the screen on their next visit; a new English version of the Terms brings back only the Terms box. No learner role is given, and nothing of the person's learning is saved, until the screen is complete (`src/app/actions/profile.ts`; `src/lib/profile.ts`).<br>**Names and country:** the person gives them once. Afterwards only an admin changes them on request (a partner admin: the names of its own learners), on Manage people, and each change is logged. Nobody can change an email address in the app.<br>[For DIESIS / its adviser: SENIC's suggested defaults are: a first name or nickname is enough (Q17); minimum age 16 for self-registration, younger learners only when invited by a partner that holds guardian consent offline (Q18); the national digital-consent ages (Belgium 13, Cyprus 14, Greece 15, Germany 16) matter only if consent is the lawful basis (letter, K3).] | Storage, transmission, retrieval |
| 2 | **Working through a course** | Stages completed, choices in exercises and in the branching scenario, whether simulation answers were right, assessment answers, and **the free-text answers to the course reflection questions** (`prisma/schema.prisma:346-371`) | Storage, modification, retention |
| 3 | **Comp Card (self-reflection)** | Free-text reflections the learner writes (up to 2,000 characters per field; longer text is refused, never cut) + a 1–5 confidence rating + **one sharing choice per card**: "Only me" (the default) or "Me and the facilitators at &lt;organisation&gt;".<br>A card counts as shared only from the moment the learner chooses to share it, and only with the organisation they belong to then: the platform stores that date, that organisation and the version of the sharing wording, and logs each change by the card's id (`src/app/actions/learner.ts`, `setCompCardSharing`; D80). Every card was set to "Only me" on 20 Nov 2026, and a change of the learner's organisation sets it back to "Only me" (D101). A learner invited under the guardian rule shares only once their organisation records that the guardian's permission covers it. A guest's card stays in the browser, "Only me". | Storage, modification, restriction |
| 4 | **Facilitator support** | Partner facilitators and partner admins see the learners of their own organisation (all its cohorts); DIESIS's and SENIC's admins see every learner, including those with no organisation; staff with no organisation see none. This is enforced on the server for every page and action (`src/lib/scope.ts`; D74, D75), and for partner staff only once `R3_PARTNER_ACCESS` is switched on, at the production security review (23 Nov 2026); real partner staff are invited after it passes (from 25 Nov). For each learner they see: name and email; country; progress, current course and lesson, last activity, and time per lesson; how many in-video questions the learner answered, and how many correctly; assessment and practice scores, and the scenario choice; whether a guardian's permission is recorded; and the Comp Card only if the learner shared it with their organisation (row 3) (`src/lib/server-queries.ts`; `src/components/role/RealFacilitatorView.tsx`). Learners are told this list on the sign-up screen, the Comp Card and their account page.<br>A learner's organisation comes from the country they give, through a mapping DIESIS's admins set, or from the partner organisation that added them; only an admin changes it, and every change is logged.<br>[For DIESIS / its adviser: SENIC's suggested default (Q25) is that facilitators see their whole organisation, as built. Country mapping (Q24), as built: Germany = Pro Arbeit, Cyprus = Synthesis, Greece = University of Macedonia, Belgium and Other = DIESIS.] | Retrieval, provision |
| 5 | **Admin / cohort management** | Email, name, role(s), country and organisation (the person's profile), cohort, and for a learner invited under the guardian rule the date the guardian's permission was recorded. DIESIS's and SENIC's admins manage everyone; a partner admin manages the learners and facilitators of its own organisation only (D76). | Organisation, modification, linking |
| 6 | **Activity events (learning analytics)** | Event records linked to the learner's user id: when they open a course; seconds spent on each stage; whether each in-video question was answered correctly (`src/app/actions/telemetry.ts:18-79`; `src/app/actions/video.ts:19-60`). These are personal data. They are stored in the same table as the audit log. They are in the person's data download, and are deleted with the account (or by a test account's reset). Nothing is recorded for guests. | Storage, retention, deletion |
| 7 | **Analytics dashboard** | Facilitators, partner admins and admins see, for the learners of their scope (row 4) who have started at least one course: a table with one row per learner (name, or email if there is no name; cohort; progress; seconds per lesson; hours since last activity; assessment score; and a done / stuck / active status); a progress funnel; and a heatmap of when learners open courses, by weekday and 4-hour block (`src/app/[locale]/analytics/page.tsx`; `src/lib/analytics-real.ts`).<br>Statistics leave out anyone who holds or ever held a staff role (recorded by a database trigger, D84) and accounts marked as test accounts, and count only enrolments, activity and badges from 1 Dec 2026 (`STATS_FROM`; D83).<br>[For DIESIS / its adviser: SENIC's suggested default for test data (Q19) is to hide it from statistics and delete accounts marked as test accounts.] | Retrieval, provision |
| 8 | **GDPR self-service** | **Export:** a JSON file with the account (including when the address was first confirmed and last changed) and profile (country, organisation, Terms version and time, age statement, consent, the date a guardian's permission was recorded, the test-account mark, and whether and since when the person held a staff role); memberships; course progress and reflections; the Comp Card and how it is shared; badges; the activity events; the log entries about the person (action and date, not who); sessions and pending sign-in links (count and expiry, never a token); and the staff notes and validations about the learner, signed "a facilitator at ‹organisation›" while the author is still in the organisation they wrote it in (otherwise "a member of staff"). An organisation recorded on a membership before 20 November 2026 is labelled as no longer used; a shared Comp Card carries the version of the sharing wording it was shared under. For staff, how many notes and validations they wrote, not their text (`src/lib/gdpr-export.ts`).<br>The same file goes to an ADMIN who exports it for a request in DIESIS's register (a form on Admin → Data; logged with the reference).<br>**Delete:** see the retention note below. | Transmission, deletion |
| 9 | **Accessibility preferences** | Text size, easy-read font and contrast settings on the user record. A copy is also kept in the browser's local storage and stays there after sign-out (`src/components/a11y/AccessibilityProvider.tsx:32,36-44`). [For DIESIS / its adviser: see the easy-read question above this table.] | Storage, modification |
| 10 | **Invitation email** | An admin, or a partner admin for its own organisation, adds someone and (by default) emails them a one-click join link: their email, optional name, role, and the inviter's name (or email), sent via Resend. Only they can trigger it; the link expires after 7 days | Transmission |
| 11 | **Staff notes and competence validations** | A facilitator's free-text note about a learner (up to 2000 characters), and the validation of a skill area with free-text evidence (`src/app/actions/facilitator.ts:51-117`). Learners cannot see these in the app, only in their export, where they are signed "a facilitator at ‹organisation›" (while the author is still in that organisation; otherwise "a member of staff"), never by name. There is no screen for reading notes. When the author's account is erased, their notes stay, unsigned (D89). | Storage, retrieval |
| 12 | **Guest use (no account)** | Progress, reflections and Comp Card text are kept only in the browser's local storage, with no expiry. When someone signs in on that browser and has completed the sign-up step, the platform asks whether the guest work is theirs: "Add it to my account" moves each part into the account only where the account has none of its own (a course it has progress in, and a Comp Card with answers of its own, are kept, and so is a card it shares; the browser keeps the rest), "Remove it from this browser" deletes it, and nothing moves unasked (D79; `src/components/learner/GuestWorkPrompt.tsx`). A guest's Comp Card is always "Only me". | Storage, linking |
| 13 | **Sign-in, sessions and abuse protection** | Session records (token and expiry; no IP or browser), valid for 30 days and renewed on use. Sign-in token records holding the email address, valid 24 hours for sign-in and 7 days for invitations; used tokens are deleted; expired ones, and expired sessions, are deleted by the ADMIN clean-up run. Rate-limit records are stored under a keyed hash (HMAC with a server secret) of the email address or the internal user id, so neither can be read back from them; rows older than two hours are deleted as new ones are written (`src/lib/rate-limit.ts`). | Storage, deletion |
| 14 | **Audit log of staff actions** | Records who added, invited, removed or changed the role of whom; organisation and cohort changes; that a note or validation was created (not about whom); exports and deletions; content saves, and lesson documents added, removed, published and withdrawn. It stores user ids, not names. ADMINs read its data and account records (exports and erasures, resets and test marks, organisation and country changes, clean-up runs) on Admin → Data, with the admin's address and never a learner's name. It has no retention limit. It does **not** record sign-ins, failed sign-ins or staff viewing learner data. | Storage |

Retention note:
- Erasing an account (the person's own "Delete my account", or an ADMIN's
  erasure for a request) is one database transaction
  (`src/lib/account-data.ts`, `eraseAccount`). It deletes the user record and
  everything linked to it: memberships, profile, sessions, course progress,
  Comp Card, badges, staff notes and validations about the person, and also
  their activity events, the log of their Comp Card's sharing, their pending
  sign-in links (whatever the case of the address) and their rate-limit
  records.
- Other audit rows about the person lose the person's user id. One record that
  an account was deleted keeps it, without name or address, so that the erasure
  can be applied again after a restore from backup (§5).
- Notes and validations a **staff member** wrote about learners stay when the
  staff member's account is erased, without the author (D89, SENIC's default).
- Backups keep the data until they are pruned (§5).
- [For DIESIS / its adviser: whether staff notes about a learner must survive
  when the staff member leaves. Built default: they stay, unsigned; deleting
  them instead is a one-line change.]

---

## 3. Is data disclosed to recipients other than DIESIS (the controller)?

**Yes — two distinct categories:**

**(a) Partner staff acting on DIESIS's behalf, through role-based access.**
- Staff of Pro Arbeit, Synthesis and University of Macedonia, and DIESIS's own
  staff, who hold a **Facilitator**, **Partner admin** or **Admin** role can
  view learner data in the platform: partner staff only their own
  organisation's learners. SENIC staff who hold an Admin role for support can
  too, as processor (§4), without Comp Card text.
- Partner staff act on DIESIS's behalf under an annex to the consortium
  agreement (K1). [For DIESIS / its adviser: the annex wording and how the
  partners' role is described.]
- What they see is set out in §2b rows 3, 4 and 7. All of it is filtered on
  the server, by the viewer's organisation and the learner's Comp Card choice.
- This is **access-controlled retrieval**, not data actively sent to them.
- Content editors see only the number of learners, not their data
  (`src/lib/cms/course-admin.ts:111,180`).
- The partners are responsible themselves for the participant lists they keep
  outside the platform (Q20). [For DIESIS / its adviser: confirm.]

> **[Controller] governance note — decided (K6): each partner sees only its own
> participants.**
> - Organisation scoping is built (Release 3, 20 Nov 2026). It is enforced on
>   the server and refuses access when in doubt (D75).
> - Partner staff see learners only once `R3_PARTNER_ACCESS` is switched on for
>   the production security review (23 Nov 2026), and real partner staff are
>   invited only after it passes (from 25 Nov; D77).
> - [For DIESIS: who keeps the record of who holds Facilitator, Partner admin
>   or Admin roles. SENIC suggests DIESIS.]
> - Admins named in the server setting `ADMIN_EMAILS` cannot be demoted from the
>   admin screens; changing them needs SENIC (`src/lib/auth-helpers.ts:51-71`).
> - [For DIESIS / its adviser: Q24 and Q25, see §2b row 4.]

**(b) Sub-processors — _active storage/processing on SENIC's instruction_.**
The providers in §1 (Vercel, Neon, Resend, Scaleway, GitHub; Plausible and
Sentry only if activated) store and process data solely to run the service,
under sub-processor agreements [SENIC to confirm: each is accepted and on
file].

**Transfer method:** (online) retrieval by authorised staff acting on DIESIS's
behalf (a); processing by sub-processors under contract (b). No bulk export or
sale, and no advertising. Where a lesson uses a YouTube video, Google's player
and cookies load only after the learner presses play (see §1).

---

## 4. Third-party / remote maintenance

1. **Does third-party access to personal data occur through maintenance?** **Yes.**
   SENIC operates and maintains the platform. **Service is provided via remote
   access** (Vercel, Neon, Resend, Scaleway and GitHub accounts, over HTTPS) —
   **no on-site access**.
2. **What the service covers:** software maintenance & updates, security
   patching, database administration, deployment/release management, monitoring,
   troubleshooting.
3. **Person/company commissioned:** **SENIC** (developer & operator). Underlying
   infrastructure sub-processors: Vercel, Neon, Resend, Scaleway, GitHub;
   Plausible and Sentry only if activated.
4. **Registered office in a third country?** **[SENIC to supply: legal seat.]**
   US-based: **Vercel Inc.**, **Neon Inc.**, **Resend Inc.**, **GitHub Inc.**
   (and Sentry if activated). EU-based: **Scaleway SAS** (France), and
   **Plausible** (Estonia) if activated. The database itself is hosted in the
   **EU**. [For DIESIS / its adviser: the transfer tool for each US provider,
   see §1.]
5. **Access rights of the maintainer:** **Administrative / maximum privileges**
   to the hosting environment (necessary to operate it). Day-to-day the app's
   own RBAC governs in-app data access.
6. **Contractual data-protection arrangement (DPA)?** **Required — see §7.** A
   controller–processor agreement between DIESIS and SENIC, starting from
   DPA-TEMPLATE.md and due for signature by 24 Nov 2026, plus agreements with
   each sub-processor.
7. **Is the service monitored?** The in-app audit log records staff actions
   (§2b row 14), lesson document changes among them. It does not record
   sign-ins, failed sign-ins or staff viewing learner data. ADMINs read its data
   and account records on Admin → Data; it has no retention limit. Provider
   dashboards keep their own access logs.
8. **Remote-access method:** **Internet / HTTPS with explicit per-account
   authorisation** (provider accounts; [SENIC to confirm: two-factor
   authentication is switched on for every provider account]). No ISDN, no
   permanent open/VPN tunnel.

---

## 5. Retention & storage periods

- **Regulated?** **Not yet — [Controller] to set.** [For DIESIS / its adviser:
  retention. SENIC's suggested default (letter, Q21–Q23) is:
  - "programme" means the whole project;
  - learners' accounts, progress, Comp Cards and activity are deleted from the
    platform on 1 July 2028;
  - anonymous statistics and partners' own records are kept to 2032, pending
    confirmation of when the 5-year period starts (SENIC's plan adds that groups
    under 5 are suppressed in the statistics);
  - people who join later are deleted after 12 months without activity;
  - staff accounts are deleted when the person leaves, or in July 2028.

  The rule must also cover the activity and audit log, unused sign-in tokens,
  uploaded files and backups.]

  [SENIC note: the platform does not record sign-in times today (§2b row 14).
  "12 months without activity" would be measured from learning activity events
  unless SENIC adds a last-seen date.]

  Likely a mix of **statutory** (any programme record-keeping obligation) and
  **contractual** (Erasmus+/programme terms). The platform does not impose a
  period of its own.
- **Regular automatic deletion within time limits?** **Not yet** — there is no
  scheduled purge. Erasure, by the person or by an ADMIN for a request, is
  implemented and complete (§2b, retention note). An ADMIN's clean-up run,
  before launch and monthly during the pilot (`docs/data-management.md`),
  deletes expired sessions and sign-in links, every demo session, the accounts
  marked as test accounts, and course files removed from lessons more than 7
  days earlier that nothing uses.
- **Data-deletion policy document?** **Not yet formalised — [Controller] to
  produce.** The platform supports self-service and ADMIN erasure and data
  export, and `docs/data-management.md` describes how requests, test accounts
  and the clean-up are handled, so the policy can be enforced once defined. Once DIESIS
  sets the rule, SENIC builds scheduled deletion with these safeguards:
  - a dry run that DIESIS approves before the first large deletion;
  - warnings to learners 30 and 7 days ahead;
  - an anonymous statistics snapshot handed to DIESIS as a file.

  It must be in place well before the first deletion date.
- **Backups:**
  - Daily off-site copies are kept 30 days; the newest 7 copies are always
    kept, so if backups stop, an older copy can remain until new ones replace
    it (`scripts/db-backup.sh:28-29,249-265`). Deletion runs only at the end of
    a successful nightly backup (`.github/workflows/db-backup.yml:138-156`).
    - While every nightly run succeeds, erased data leaves the backups within
      about 31 days.
    - If the nightly runs stop, no copy is deleted until they resume. Even
      then, the newest 7 stay whatever their age.
    - GitHub switches off scheduled runs in a public repository after 60 days
      without activity in it (`BACKUP.md:140-143`).
  - Each dump is also on the GitHub-hosted runner, unencrypted, while it is
    made, checked and test-restored.
  - Uploaded files are not included in the backup.
  - Neon's own point-in-time history is 6 hours on the current (Free) plan, and
    7 days after the move to the paid (Launch) plan before participants start
    (`BACKUP.md:11-14`) **[to confirm once set]**.
  - The documented restore procedure applies again, before restored data is
    used, every erasure recorded after the dump's date (BACKUP.md, step R10).
    Each erasure leaves an `account.deleted` record with the erased account's
    id, and every daily dump carries these records, so the newest available
    dump lists them; only erasures made in the last day before a total loss of
    the database are at risk. Corrections are applied again from DIESIS's
    register of requests.

---

## 6. Technical & organisational measures (TOMs) — SENIC

Provided in response to the request for SENIC's TOMs. All are implemented today
unless marked _planned_.

**Access control & authentication**
- Passwordless sign-in (one-time email link); **no passwords stored**.
- Project-scoped **role-based access control** (Learner / Facilitator / Content-Editor / Partner admin / Admin), checked on the server for every action.
  - Organisation scoping: one module decides every staff read and every staff write about another person, by the viewer's organisation, and refuses when in doubt; a test reads the code for any read or write that bypasses it (D75).
  - Comp Card text is filtered on the server by the learner's sharing choice (D80, D81).
  - Partner staff see learners only once `R3_PARTNER_ACCESS` is on (from the production security review, 23 Nov 2026).
- Server-side authorisation on all data-mutating operations and file-upload token issuance.
- Rate limits on sign-in, invitations, adding people and uploads (`src/lib/rate-limit.ts`).
  - Every key is stored as a keyed hash (HMAC with a server secret) of the email address or the internal user id.
  - When the limiter can't count, sign-in links are allowed (so learners can still sign in) and every staff-only limit refuses.

**Data minimisation & privacy by design**
- Minimal identity data: the email address, and from the sign-up step a first name or nickname, the country, the Terms acceptance and the age statement (§2b row 1). See §2b on IP addresses, cookies and free text.
- Cookieless Plausible analytics is built in but not active. [For DIESIS / its adviser: whether to activate it, and whether any cookie consent is needed, in particular for YouTube.]
- Comp Card: "Only me" by default; shared only by the learner's own choice, with their organisation's facilitators; filtered on the server. Course reflection answers are not shown to staff.
- Error monitoring (Sentry) is built in but not active. If it is activated, it is set not to send default personal data and to use no tracing or session replay (see §1).

**Data subject rights**
- Self-service data export (**JSON only**; contents in §2b row 8) and account deletion.
- Erasure removes the person's records and unlinks the log rows about them (§2b, retention note).
- Learners cannot change their own name or country: an admin changes them on request (Manage people, "Change details"), and each change is logged. Nobody can change an email address in the app.
- ADMINs (DIESIS, SENIC) export or erase any account on Admin → Data for a request logged in DIESIS's register: the export needs the request's reference (`REQ-YYYY-NNN`) and comes only from the platform's own page; an erasure needs the address typed again and the reference. Every use is logged and shown in the log on the same page. Partner admins cannot.
- Procedure: requests go to DIESIS, which records them in its register; SENIC carries them out on DIESIS's instruction (`docs/data-management.md`). [For DIESIS: the internal deadline, and how requests from people who cannot sign in are verified (K3).]

**Encryption & residency**
- HTTPS for the site; TLS to the database [SENIC to confirm: the connection string requires TLS].
- **Encryption at rest** for the database, file storage and off-site backups (provider-managed). Backups would also be encrypted before upload if an age key were set; as of 20 October 2026 none is. On the runner the dump is unencrypted while it is made, checked and test-restored.
- Primary learner records are in the **EU (Frankfurt)** and backups in the **EU (Paris)**. Outside the EU: emails pass through Resend (US); the backup dump is made on a GitHub-hosted runner [location to confirm]; the location of Vercel's request logs is [to confirm].

**Integrity, availability & operations**
- Version-controlled code; automated CI (type-check, lint, unit + end-to-end tests, automated accessibility checks) gating every change.
- Database schema changes via reviewed, versioned migrations.
- **Backups:** Neon point-in-time restore (history window 6 hours on the current Free plan; 7 days after the move to the paid Launch plan before participants start **[to confirm once set]**) and a **daily off-site backup** to Scaleway (Paris), kept 30 days, with the newest 7 copies always kept (so if backups stop, an older copy can remain until new ones replace it). Taken with a **read-only** database role, sign-in tokens left out, verified on every run (size, tables, every data block; the stored copy read back and compared). Active since **20 October 2026** (first verified run).
  - Each night the backup is made, checked and test-restored on a GitHub-hosted runner. The nightly test restore has been on since 20 Oct 2026 (`BACKUP.md:211-214`).
  - BACKUP.md also asks for a manual test restore into a Neon branch every quarter. None has been done yet, because the backups started on 20 Oct 2026. SENIC's plan puts the first restore drill in the week of 23–27 Nov 2026.
- **Audit log** of staff actions (§2b row 14), lesson document changes among them. It does not record sign-ins, failed sign-ins or staff viewing learner data, and it has no retention limit (§4, item 7). Its data and account records are shown to ADMINs on Admin → Data.
- **WCAG 2.2 AA** accessibility (relevant for equitable access; internally tested).

**Security headers**
- Every response carries a content security policy (without a nonce), `X-Frame-Options`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a Permissions-Policy (`next.config.ts`; `src/lib/security-headers.ts`; D95). The policy admits only the platform's own file store and, once switched on, Plausible and Sentry. [SENIC action: verify them on the production host on deploy day (GO-LIVE.md §1a).]

**Known gaps**
- The code contains a demo sign-in for showcase deployments, which bypasses the email sign-in. It runs only where it is switched on with a private access code, and never on the production deployment (D98); the clean-up run ends every demo session.
- Test deployments that do not send email write sign-in details, including the email address, to their logs instead. [SENIC action: use only test addresses there.]
- Uploaded files are public to anyone who has the link (§1).

**In place from 20 Nov 2026 (Release 3):**
- Comp Card "Only me" by default, filtered on the server;
- a sign-up screen (name or nickname, country, Terms, age statement);
- partner admins and facilitators limited to their own organisation, from the production security review (23 Nov);
- statistics without staff, former staff and test accounts, counting from 1 Dec 2026;
- YouTube only after a click; lesson media only from the platform's own store;
- safeguarding contacts shown to learners, with 112 always;
- security headers (above).

The legal notice page is built; it is listed and linked once DIESIS's details and counsel's text are in (D94).

_Later:_ scheduled retention deletion, in place before the first deletion date.
_On request:_ an external penetration test.
_Only if DIESIS decides:_ Plausible, Sentry.

---

## 7. Data-processing agreements to put in place

For the controller's file:

1. **Controller ↔ Processor DPA** — between **DIESIS** [For DIESIS / its
   adviser: legal name], the controller, and **SENIC**, the processor operating
   the platform. It starts from DPA-TEMPLATE.md and is due for signature by
   24 Nov 2026.
2. **Partner annex** to the consortium agreement, under which partner staff
   view learner data on DIESIS's behalf. [For DIESIS / its adviser: the
   wording.]
3. **Sub-processor DPAs / SCCs**, held by SENIC and disclosed to the controller:
   - **Vercel** (hosting + Blob storage) — US company; compute pinned to Frankfurt (`fra1`), **Blob store in Frankfurt (`fra1`)** → DPA + SCCs.
   - **Neon** (database) — US company, EU-hosted data → DPA + SCCs.
   - **Resend** (sign-in and invitation emails) — US → SCCs.
   - **Scaleway** (off-site backups) — EU (France), data in Paris → Scaleway's
     standard DPA (accepted with its terms); no third-country transfer.
   - **GitHub** (backup runner, code, automated tests) — US company, so an
     agreement and a transfer tool are needed. [For DIESIS / its adviser:
     approve it.]
   - **Plausible** — EU (Estonia); only if activated [to confirm].
   - **Sentry** — US company; only if activated [to confirm].
4. **Blob region:** the Blob store `seq-elevate-demo-blob` is in Frankfurt
   (`fra1`), verified in the dashboard in June 2026 (D13). [SENIC to confirm:
   production uses this store, and Vercel's DPA and SCCs are on file.] Learners
   upload nothing.

SENIC will provide its current TOMs (§6) and the executed sub-processor DPAs on
request.

---

## 8. Cookies and browser storage

| Name | Type | Set by | Purpose | Lifetime |
|---|---|---|---|---|
| `__Secure-authjs.session-token` | Cookie | Auth.js (sign-in framework) | Keeps the user signed in | 30 days, renewed on use; 7 days for demo sign-ins |
| `__Host-authjs.csrf-token` | Cookie | Auth.js | Protects the sign-in form | Session only |
| `__Secure-authjs.callback-url` | Cookie | Auth.js | Returns the user to the right page after sign-in | Session only |
| `NEXT_LOCALE` | Cookie | The platform | Remembers the language. Set only when the page language differs from the browser's language or from an earlier choice | Session only |
| `seq-elevate-demo-state-v1` | Local storage | The platform | Guest progress, including free text (§2b row 12) | No expiry |
| `seq-elevate-a11y-v1` | Local storage | The platform | Accessibility settings (§2b row 9) | No expiry |
| `seq-elevate-project-v1` | Local storage | The platform | The project id | No expiry |

Third-party cookies come only from YouTube, once a learner presses play on a
YouTube video (§1), and from another website a learner chooses to open from a
link out (a file attached from it before 20 Nov 2026; §1).

---

## 9. Decisions for DIESIS and its adviser

Every **[For DIESIS / its adviser]** item in this document, with SENIC's
suggested default where the letter gives one:

- **Lawful basis** (Q16, by 30 Oct 2026). SENIC's suggested default: "learning
  under public-interest education or contract; consent only for optional
  sharing".
- **Minimum age and age gate** (Q18). Default: 16 for self-registration;
  younger learners only when invited by a partner holding guardian consent.
- **Name** (Q17). Default: a first name or nickname is enough, plus a Terms
  checkbox and age confirmation.
- **Retention** (Q21–Q23). Default as in §5.
- **What facilitators can see** (Q25). Default: their whole organisation.
  **Country mapping** (Q24) as in §2b row 4.
- **Test data** (Q19). Default: hide it, and delete marked test accounts.
- **YouTube** (Q27). Default: upload videos to the platform, with subtitles.
- **Whether "Remove" blocks sign-in** (Q29). Default: no, the platform is open.
- **Partners' role for their own participant lists** (Q20). SENIC's plan:
  independent controllers.
- **GitHub as a sub-processor; whether to activate Plausible and Sentry.** No
  default.
- **Transfer tool for each US provider.** No default.
- **Whether "needs attention" and "stuck" count as profiling.** No default.
- **Whether the easy-read setting is health data.** No default.
- **Whether staff notes about a learner survive when the staff member leaves.**
  Built default: they stay, without the author.
- **Request procedure and internal deadline for data requests** (K3). No
  default in the letter; SENIC's suggestion is in §6 (Data subject rights).
- **Who keeps the record of Facilitator and Admin role holders.** SENIC
  suggests DIESIS.
- **Supervisory authority.** Presumably Belgian; the adviser confirms.
- **Breach-notice target in the agreement with SENIC.** No default.
- **Governing law and courts in the agreement with SENIC.** No default.
- **Partner annex wording.**
- **Legal-notice items** for the site's legal notice (DIESIS's legal details,
  programme reference, contacts), drafted separately by SENIC.

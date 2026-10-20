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

_Last updated: 2026-10-20. Describes the platform at code version 54084cb.
Changes planned for Release 3 (20 Nov 2026, before the 1 Dec 2026 pilot) are
marked "Planned from 20 November". Maintained by SENIC (developer and operator;
processor)._

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
   - Removing a document from a lesson does not delete the file
     (`src/app/actions/lesson.ts:175-180`). [SENIC action: delete files when
     they are removed.]
3. **Resend.**
   - Sign-in emails are in English only. Invitations are in English, German or
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

**Not a sub-processor, but contacted by the learner's browser: YouTube (Google).**
- Where an author pastes a YouTube link, the lesson loads YouTube's player from
  www.youtube.com as soon as the video is shown. It loads without a click, and
  not from the privacy-enhanced youtube-nocookie.com domain
  (`src/components/course/InteractiveVideoPlayer.tsx:107-113,399-414`).
- Google then receives the learner's IP address and can set cookies.
- **Planned from 20 November:** YouTube loads only after a click. [For DIESIS /
  its adviser: SENIC's suggested default (Q27) is to upload videos to the
  platform, with subtitles. Otherwise click-to-load, plus a mention in the
  privacy and cookie pages.]
- Authors can also paste links to video, captions and documents hosted on other
  websites (`src/lib/media-url.ts:21-34`; `src/app/actions/lesson.ts:142-173`).
  The learner's browser then loads those directly.

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
| Retention | ✅ | Today learner records are kept with no time limit, and nothing deletes them automatically: `vercel.json` has no scheduled job, and `Cohort.endsAt` is stored but not used. Retention period **[Controller]** [For DIESIS / its adviser: retention, see §5.] |
| Retrieval | ✅ | Reading a learner's progress / Comp Card |
| Querying | ✅ | Database queries (parameterised, via Prisma) |
| Modification | ✅ | Updating progress, reflections, roles, cohort assignments |
| Transmission | ✅ | Sign-in and invitation emails (Resend); a learner's data export to themselves; the nightly backup to Scaleway through GitHub; the learner's browser contacting YouTube where a lesson embeds a YouTube video |
| Distribution | ⚠️ yes | **Today:** every facilitator and admin in the project can see each learner's progress, scores, time per stage and scenario choice. They also see the Comp Card answers "what went well", "what I'd improve" and confidence, **whatever the learner chose**. The learner makes one choice per card. On screen, "Only me" hides only "what was difficult"; "behaviour" is hidden unless the learner chose "my facilitator and mentor" (`src/components/role/RealFacilitatorView.tsx:116-117,159-170`). Today this visibility is applied on the staff screen, not on the server.<br>**Planned from 20 November:** "Only me" becomes the default and hides the whole card, with the filtering done on the server. Partner staff see only learners of their own organisation. DIESIS (and SENIC, for support) see all learners. |
| Matching | ⚠️ limited | Staff dashboards put labels on individual learners who have not completed the course: "needs attention" (progress above 0% and below 50%) and "stuck" (no activity for more than 72 hours). The dashboards also show each learner's assessment score (`src/lib/server-queries.ts:267`; `src/lib/analytics-real.ts:132-136`). The labels are only displayed; the platform takes no automatic action on them. [For DIESIS / its adviser: whether these labels count as profiling that must be disclosed. The letter gives no default.] |
| Linking | ✅ | Linking a user to their enrolments, cohort and organisation |
| Deletion / destruction | ✅ | Self-service account deletion, which deletes linked records (see §5). Admins have no tool to erase or export another person's data. "Remove from project" only takes away roles and keeps the account and all its data (`src/app/actions/admin.ts:300-310`); the person's session is not ended, and they get a learner role again on their next signed-in page load (`src/lib/learner-membership.ts:32-37`; `src/app/actions/learner.ts:107-120`).<br>**Planned from 20 November:** admins can reset or erase accounts marked as test accounts. |
| Restriction | ✅ | The Comp Card privacy setting (see Distribution) and content publish/unpublish. There is **no consent-withdrawal function**; only a code comment mentions one (`prisma/schema.prisma:537`). [For DIESIS / its adviser: SENIC's suggested default (Q16) uses consent only for optional sharing. If that is chosen, SENIC suggests the Comp Card setting serves as the way to withdraw.] |

---

## 2b. Work processes — what personal data is used at each step

The personal data actually stored is deliberately minimal.
- The platform's own database stores no passwords (sign-in is a one-time email
  link), IP addresses, geolocation or biometric data.
- IP addresses do reach Vercel's request logs, and they reach Google where a
  lesson embeds a YouTube video (see §1).
- The platform sets no advertising cookies. Where YouTube is embedded, YouTube
  sets its own cookies; click-to-load is planned from 20 November. All cookies
  and browser storage are listed in §8.
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
| 1 | **Account creation & sign-in** | The email address. A one-time link is sent through Resend, and the link itself carries the email address and token.<br>**Today anyone with an email address can register**, with no age check and no Terms acceptance. The first page they open after signing in creates a learner membership (`src/components/auth/SignInForm.tsx:51-58`; `src/app/actions/learner.ts:107-121`).<br>**Names:** a name is stored only if an admin enters one when adding or inviting the person. An admin can change a name only by adding the person again with the new name. Learners cannot set or correct their own name, and nobody can change an email address in the app (`src/app/actions/admin.ts:204-208`).<br>**Planned from 20 November:** a one-time sign-up screen asks for a name, country, acceptance of the Terms and confirmation of the minimum age, with a link to the privacy notice. Existing accounts see it on their next visit.<br>[For DIESIS / its adviser: SENIC's suggested defaults are: a first name or nickname is enough (Q17); minimum age 16 for self-registration, younger learners only when invited by a partner that holds guardian consent offline (Q18); the national digital-consent ages (Belgium 13, Cyprus 14, Greece 15, Germany 16) matter only if consent is the lawful basis (letter, K3).] | Storage, transmission, retrieval |
| 2 | **Working through a course** | Stages completed, choices in exercises and in the branching scenario, whether simulation answers were right, assessment answers, and **the free-text answers to the course reflection questions** (`prisma/schema.prisma:346-371`) | Storage, modification, retention |
| 3 | **Comp Card (self-reflection)** | Free-text reflections the learner writes + a 1–5 confidence rating + **one privacy choice per card**.<br>**Today** there are three options: "Only me"; "Me and my facilitator"; "Me, my facilitator and mentor", although no mentor role exists. The default is "Me and my facilitator" (`prisma/schema.prisma:387`; `src/app/actions/learner.ts:291`). The platform sets no length limit of its own on Comp Card text (`src/app/actions/learner.ts:282-298`).<br>**Planned from 20 November:** two options, "Only me" (the default) and "Me and the facilitators at &lt;organisation&gt;". Existing cards are reset to "Only me". | Storage, modification, restriction |
| 4 | **Facilitator support** | **Today any facilitator sees every learner in the project**, not only their own cohort or organisation (`src/lib/facilitator-access.ts:15-16`; `src/lib/server-queries.ts:120-134`). For each learner they see: name and email; progress, current course and stage, last activity, and time per stage; how many in-video questions the learner answered, and how many correctly; assessment and simulation scores, and the scenario choice; the Comp Card (see §2, Distribution) (`src/lib/server-queries.ts:261-292`; `src/components/role/RealFacilitatorView.tsx:496-507`).<br>**Planned from 20 November:** partner facilitators and partner admins see only learners of their own organisation, enforced on the server. DIESIS (and SENIC, for support) see everyone, including "Other".<br>Until then, SENIC's plan is that partner staff get only the Editor role, which shows no learner data, only learner counts (`src/lib/cms/course-admin.ts:111,180`).<br>[For DIESIS / its adviser: SENIC's suggested default (Q25) is that facilitators see their whole organisation. Proposed country mapping (Q24): Germany = Pro Arbeit, Cyprus = Synthesis, Greece = University of Macedonia, Belgium and Other = DIESIS.] | Retrieval, provision |
| 5 | **Admin / cohort management** | Email, name, role(s), organisation & cohort assignment (`Membership`) | Organisation, modification, linking |
| 6 | **Activity events (learning analytics)** | Event records linked to the learner's user id: when they open a course; seconds spent on each stage; whether each in-video question was answered correctly (`src/app/actions/telemetry.ts:18-79`; `src/app/actions/video.ts:19-60`). These are personal data. They are stored in the same table as the audit log, and no job deletes them. Nothing is recorded for guests. | Storage, retention |
| 7 | **Analytics dashboard** | Facilitators and admins see, for learners who have started at least one course: a table with one row per learner (name, or email if there is no name; cohort; progress; seconds per stage; hours since last activity; assessment score; and a done / stuck / active status); a progress funnel; and a heatmap of when learners open courses, by weekday and 4-hour block (`src/app/[locale]/analytics/page.tsx:30-34`; `src/lib/analytics-real.ts:38-62,138-151,196-207`).<br>Statistics leave out people who currently hold a staff role (`src/lib/learner-scope.ts:54-62`, used at `src/lib/analytics-real.ts:39`).<br>**Planned from 20 November:** statistics also leave out anyone who ever held a staff role and accounts marked as test accounts, and they count from 1 Dec 2026.<br>[For DIESIS / its adviser: SENIC's suggested default for test data (Q19) is to hide it from statistics and delete accounts marked as test accounts.] | Retrieval, provision |
| 8 | **GDPR self-service** | **Export:** a JSON file containing the account, memberships, course progress and reflections, Comp Card, badges, and the staff notes and validations about the learner (`src/lib/gdpr-export.ts:13-105`). It leaves out activity events, audit rows about the person, notes the person wrote as staff, and some account fields.<br>**Delete:** see §5.<br>[SENIC action: add activity events to the export, or state the gap in the privacy text.] | Transmission, deletion |
| 9 | **Accessibility preferences** | Text size, easy-read font and contrast settings on the user record. A copy is also kept in the browser's local storage and stays there after sign-out (`src/components/a11y/AccessibilityProvider.tsx:32,36-44`). [For DIESIS / its adviser: see the easy-read question above this table.] | Storage, modification |
| 10 | **Invitation email** | An admin adds someone and (by default) emails them a one-click join link: their email, optional name, role, and the inviting admin's name (or email), sent via Resend. Only an admin can trigger it; the link expires after 7 days | Transmission |
| 11 | **Staff notes and competence validations** | A facilitator's free-text note about a learner (up to 2000 characters), and the validation of a skill area with free-text evidence (`src/app/actions/facilitator.ts:51-117`). Learners cannot see these in the app, only in their export. There is no screen for reading notes. | Storage, retrieval |
| 12 | **Guest use (no account)** | Progress, reflections and Comp Card text are kept only in the browser's local storage, with no expiry. At sign-in they are merged into whichever account signs in on that browser (`src/store/demo-state.tsx:549-553,652-665`). On a shared device, one person's guest notes can therefore end up in another person's account. | Storage, linking |
| 13 | **Sign-in, sessions and abuse protection** | Session records (token and expiry; no IP or browser), valid for 30 days and renewed on use. Sign-in token records holding the plain email address, valid 24 hours for sign-in and 7 days for invitations; used tokens are deleted, unused ones stay. Rate-limit records keyed by a hash of the email address or by the internal user id. | Storage, deletion |
| 14 | **Audit log of staff actions** | Records who added, invited, removed or changed the role of whom; organisation and cohort changes; that a note or validation was created (not about whom); exports and deletions; content saves. It stores user ids, not names. There is no screen for reading it and no retention limit. It does **not** record sign-ins, failed sign-ins, staff viewing learner data, or document changes. | Storage |

Retention note:
- When an account is deleted, the user record and everything linked to it are
  deleted: memberships, sessions, course progress, Comp Card, badges, and staff
  notes and validations about the person.
- Some records remain. They no longer point to the person through the actor
  field, but they are **not anonymous**:
  - activity events and audit rows keep timestamps and course identifiers, with
    the actor left empty;
  - the `account.deleted` row and the staff-action rows about the person keep
    the person's user id (`src/app/actions/gdpr.ts:47-57`;
    `src/app/actions/admin.ts:38-42`);
  - unused sign-in tokens keep the plain email address;
  - backups keep all the data until they are pruned (§5).
- When a **staff member** deletes their account, the notes and validations they
  wrote about learners are deleted too (`prisma/schema.prisma:505,522`).
- [SENIC action: remove the user id from the remaining rows on erasure, and
  delete unused sign-in tokens.]
- [For DIESIS / its adviser: whether staff notes about a learner must survive
  when the staff member leaves.]

---

## 3. Is data disclosed to recipients other than DIESIS (the controller)?

**Yes — two distinct categories:**

**(a) Partner staff acting on DIESIS's behalf, through role-based access.**
- Staff of Pro Arbeit, Synthesis and University of Macedonia, and DIESIS's own
  staff, who hold a **Facilitator** or **Admin** role can view learner data in
  the platform. SENIC staff who hold an Admin role for support can too, as
  processor (§4).
- Partner staff act on DIESIS's behalf under an annex to the consortium
  agreement (K1). [For DIESIS / its adviser: the annex wording and how the
  partners' role is described.]
- What they see today, and what is planned from 20 November, is set out in §2b
  rows 4 and 7.
- Today Comp Card field visibility is applied on the staff screen, not on the
  server. Server-side filtering is planned from 20 November.
- This is **access-controlled retrieval**, not data actively sent to them.
- Content editors see only the number of learners, not their data
  (`src/lib/cms/course-admin.ts:111,180`).
- The partners are responsible themselves for the participant lists they keep
  outside the platform (Q20). [For DIESIS / its adviser: confirm.]

> **[Controller] governance note — decided (K6): each partner sees only its own
> participants.**
> - SENIC plans to build organisation scoping by 20 Nov 2026 (Release 3). It
>   will be enforced on the server and will refuse access when in doubt.
> - Partner staff get the Facilitator or Admin role only once it has passed a
>   security check (until then, the Editor role; §2b row 4).
> - [For DIESIS: who keeps the record of who holds Facilitator or Admin roles.
>   SENIC suggests DIESIS.]
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
sale, and no advertising. One exception today: where YouTube is embedded,
Google's player and cookies load without a click. Click-to-load is planned from
20 November (see §1).

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
   (§2b row 14). It does not record sign-ins, failed sign-ins, staff viewing
   learner data, or document changes. It has no screen for reading it and no
   retention limit. Provider dashboards keep their own access logs.
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
  scheduled purge. Learner-initiated deletion is implemented. It deletes the
  account and its linked records, but some records remain and are not anonymous
  (§2b, retention note). Other gaps:
  - Expired sessions are deleted only if someone presents them again.
  - Unused sign-in tokens stay.
  - Uploaded files are never deleted by the platform.
- **Data-deletion policy document?** **Not yet formalised — [Controller] to
  produce.** The platform supports learner self-service erasure and data export
  (with the gaps above), so the policy can be enforced once defined. Once DIESIS
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
  - The documented restore procedure requires re-applying the erasures and
    corrections made after the dump's date, before restored data is used
    (`BACKUP.md:202-205`, step R10). This is a manual step.
    - If the live database itself is lost, the record of those erasures is
      lost with it, because it is kept in the same database's audit log.
    - [SENIC action: keep a record of erasures outside the database.]

---

## 6. Technical & organisational measures (TOMs) — SENIC

Provided in response to the request for SENIC's TOMs. All are implemented today
unless marked _planned_.

**Access control & authentication**
- Passwordless sign-in (one-time email link); **no passwords stored**.
- Project-scoped **role-based access control** (Learner / Facilitator / Content-Editor / Admin), checked on the server for every action.
  - There is no organisation or cohort scoping yet; it is planned from 20 November.
  - Comp Card field visibility is applied on the staff screen today. Server-side filtering is planned from 20 November.
- Server-side authorisation on all data-mutating operations and file-upload token issuance.
- Rate limits on sign-in, invitations and uploads.
  - Keys for email-based limits are hashed. Upload limits and per-admin invitation limits use the internal user id.
  - [SENIC action: fix known weaknesses in the rate limiter.]

**Data minimisation & privacy by design**
- Minimal identity data: the email address, and a name only if an admin enters one. Planned from 20 November: also country, Terms acceptance and age confirmation. See §2b on IP addresses, cookies and free text.
- Cookieless Plausible analytics is built in but not active. [For DIESIS / its adviser: whether to activate it, and whether any cookie consent is needed, in particular for YouTube.]
- Comp Card: today one choice per card, shared with facilitators by default, with the visible fields described in §2. Planned from 20 November: "Only me" becomes the default and the filtering moves to the server. Course reflection answers are not shown to staff.
- Error monitoring (Sentry) is built in but not active. If it is activated, it is set not to send default personal data and to use no tracing or session replay (see §1).

**Data subject rights**
- Self-service data export (**JSON only**; contents in §2b row 8) and account deletion.
- Deletion removes the learner's linked records. The remaining log rows are not anonymous (§2b).
- Learners cannot correct their own name or email. An admin can change a name only by adding the person again; nobody can change an email address in the app.
- Admins cannot export or erase another person's data.
- [For DIESIS: the procedure for corrections and for requests from people who cannot sign in (K3). SENIC's suggestion: they go to DIESIS, and SENIC carries them out on DIESIS's instruction.]
- [SENIC action: an admin tool for export and erasure on request.]

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
- **Audit log** of staff actions (§2b row 14). It does not record sign-ins, failed sign-ins, staff viewing learner data, or document changes, and it has no screen for reading it and no retention limit (§4, item 7).
- **WCAG 2.2 AA** accessibility (relevant for equitable access; internally tested).

**Known gaps, being fixed**
- The app does not yet set security headers of its own (such as a Content-Security-Policy); only the framework's and Vercel's defaults apply. [SENIC action: add them and verify them on the production host.]
- The code contains a demo sign-in for the demonstration site, which bypasses the email sign-in. It is switched off by a server setting. [SENIC to confirm: it is switched off on production.]
- Test deployments that do not send email write sign-in details, including the email address, to their logs instead. [SENIC action: use only test addresses there.]
- Uploaded files are public to anyone who has the link (§1).

**Planned before the 1 Dec pilot (Release 3, 20 Nov 2026):**
- Comp Card "Only me" by default, filtered on the server;
- a sign-up screen (name or nickname, country, Terms, age confirmation);
- partner admins and facilitators limited to their own organisation;
- statistics without staff and test accounts;
- YouTube only after a click;
- a safeguarding contact shown to learners;
- a legal notice.

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

Third-party cookies come only from YouTube, where a lesson embeds a YouTube
video (§1), and from any other website whose video, captions or documents an
author links, if that website sets cookies (§1).

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
  No default.
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

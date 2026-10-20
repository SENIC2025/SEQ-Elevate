# Data Processing Agreement (DPA) — TEMPLATE / DRAFT

**Article 28 GDPR — Controller ↔ Processor**

> ⚠️ **This is a draft template, not final legal advice.** It was prepared by
> SENIC (the platform's technical operator) to accurately describe the
> processing and the technical/organisational measures in place, so that the
> controller's data-protection counsel can review, adapt, complete every
> `[bracketed]` field, and finalise it before signature. Do not sign as-is.
> The controller remains responsible for the lawfulness of the processing.

---

## Parties

- **Controller:** **DIESIS**, coordinator of the SEQ Elevate consortium. `[For DIESIS / its adviser: full legal name, legal form, registered address, enterprise number; privacy contact or DPO.]` Partner organisations whose staff use the platform act on the Controller's behalf under `[annex reference]` of the consortium agreement. `[For DIESIS / its adviser: confirm that no joint-controller arrangement is intended. K1 names DIESIS as the controller.]`
- **Processor:** **SENIC** — `[SENIC to supply]`, operator of the **SEQ Elevate** learning platform.

The Controller determines the purposes and means of processing personal data
of programme participants; the Processor processes that data **only on the
Controller's behalf** to operate the platform. Where the Processor engages
third parties (Annex III), those act as **sub-processors**.

**Programme reference:** SEQ Elevate — DIESIS-led consortium `[For DIESIS: Erasmus+ project number]`.

---

## 1. Subject matter, duration, nature and purpose

- **Subject matter:** processing of personal data necessary to provide and operate the SEQ Elevate digital learning platform.
- **Nature & purpose:** hosting a gamified, accessible, trilingual (EN/DE/EL) micro-learning platform for young people (NEET) to develop life/work skills; storing their learning progress, reflections and Comp Card (today facilitators and admins see some Comp Card answers whatever the learner chooses; planned from 20 November 2026: the card is private unless the learner shares it with the facilitators of their organisation); enabling authorised staff of DIESIS and the partner organisations to support learners (planned from 20 November 2026: each partner sees only its own organisation's learners); providing per-learner progress views and statistics to those staff; and enabling data-subject rights (export/erasure).
- **Duration:** for the term of the Controller↔Processor engagement (the programme period and any agreed maintenance term), after which data is returned or deleted per §3(g) and the retention schedule in Annex I.
- **Processing operations:** collection, storage, retention, retrieval, organisation, structuring, use, disclosure by transmission to authorised users, restriction, erasure/destruction. See Annex I.

Full particulars are set out in **Annex I**.

---

## 2. Instructions

2.1 The Processor processes personal data **only on documented instructions**
from the Controller, including as set out in this DPA and the platform's
configuration, unless required by EU/Member-State law (in which case it informs
the Controller first, unless the law prohibits it).

2.2 The Processor **immediately informs** the Controller if, in its opinion, an
instruction infringes the GDPR or other data-protection law.

---

## 3. Obligations of the Processor (Art. 28(3))

**(a) Confidentiality** — persons authorised to process the data are bound by
confidentiality.

**(b) Security (Art. 32)** — the Processor implements appropriate technical and
organisational measures, described in **Annex II**, and keeps them current.

**(c) Sub-processors (Art. 28(2),(4))** — the Controller gives **general
written authorisation** for the sub-processors listed in **Annex III**. The
Processor informs the Controller of any intended addition or replacement,
giving the Controller the opportunity to object. The Processor imposes the same
data-protection obligations (by contract) on each sub-processor and remains
fully liable for their performance.

**(d) Data-subject rights** — taking account of the nature of the processing,
the Processor assists the Controller (by appropriate technical and
organisational measures, insofar as possible) to respond to requests to
exercise data-subject rights (access, rectification, erasure, restriction,
portability, objection). *The platform provides self-service data export
(JSON) and account deletion.*
- *Learners cannot correct their own details.*
- *An admin can change a name only by adding the person again; nobody can change an email address in the app.*
- *Admins have no tool to export or erase another person's data.*
- *Such requests go to the Controller, and the Processor carries them out on the Controller's documented instruction within `[For DIESIS / its adviser: an internal deadline that keeps within the one-month legal deadline]`.*

**(e) Assistance with compliance** — the Processor assists the Controller in
ensuring compliance with Art. 32–36 (security, breach notification, DPIA, prior
consultation), taking into account the nature of processing and information
available to the Processor. *This DPA, Annex II, and the platform's
`DATA-PROTECTION.md` support the Controller's DPIA.*

**(f) Personal-data breach** — the Processor notifies the Controller **without
undue delay** (target: within `[For DIESIS / its adviser: number of hours; no default has been proposed. The Controller itself must notify the supervisory authority within 72 hours.]`) after becoming aware of a
personal-data breach, providing the information the Controller needs to meet its
Art. 33/34 obligations.

**(g) Deletion or return** — at the Controller's choice, on termination the
Processor **deletes or returns** all personal data and deletes existing copies,
unless EU/Member-State law requires storage. `[For DIESIS / its adviser: the
end-of-service rule. SENIC's suggested wording: "Unless the Controller
instructs otherwise, the Processor deletes platform data on [date; SENIC's
suggested default is 1 July 2028] and hands the Controller the anonymous
statistics snapshot. The Processor also deletes the off-site backup copies and
the uploaded files in Vercel Blob. The automatic backup pruning alone would
always keep the newest 7 copies (Annex II)."]`

**(h) Audits** — the Processor makes available information necessary to
demonstrate compliance with Art. 28 and allows for and contributes to audits,
including inspections, by the Controller or an auditor it mandates (reasonable
notice; confidentiality; may be satisfied by up-to-date documentation/attestations).

---

## 4. International transfers

Personal data is stored in the **European Union** (see Annex II). Personal data
is handled outside the EEA, or by non-EEA companies, in these cases:
- emails (sign-in and invitation) are sent through Resend (USA);
- the nightly backup dump is created on a GitHub-hosted runner `[SENIC to confirm the location]`; GitHub Inc. is a US company;
- Vercel, Neon and GitHub are US companies with access to EU-hosted data.

`[For DIESIS / its adviser: the transfer tool for each.]`

Where a sub-processor is domiciled outside the EEA (Annex III), transfers are
covered by **EU Standard Contractual Clauses (SCCs)** and/or an adequacy
decision, together with any supplementary measures. The Processor does not
transfer personal data outside the EEA except as set out in Annex III or on the
Controller's instructions.

---

## 5. Liability, term, governing law

`[To be completed by counsel: liability allocation, term/termination, governing
law and jurisdiction. Align with the main services contract
(DIESIS-SEQ ELEVATE-SERVICE-M1-2026-01).]` `[For DIESIS / its adviser:
governing law and courts. The Controller is established in Belgium.]`

---

# Annex I — Description of the processing

**Categories of data subjects**
- Programme participants / **learners** (young people, including under-18s). `[For DIESIS / its adviser: minimum age. SENIC's suggested default (Q18): 16 for self-registration; younger learners only when invited by a partner that holds guardian consent offline.]` Today the platform has no age check. An age confirmation on the sign-up screen is planned from 20 November 2026.
- **Staff of DIESIS and the partner organisations** (facilitators, content editors, admins, and partner admins, a role planned from 20 November 2026), and **SENIC staff** with support access.

**Types of personal data**
- Identity & contact: **email address**, used for sign-in and invitations. It is also shown to facilitators and admins, and used as the display name in statistics where no name is given.
- A **name**, if an admin enters one. Planned from 20 November 2026: a name on the sign-up screen (a first name or nickname is SENIC's suggested default, Q17), country, Terms acceptance and age confirmation.
- Learning data: course progress, stages completed, choices made in exercises and in the branching scenario, simulation results, assessment answers, and **free-text course reflections**.
- **Self-reflection ("Comp Card")**: free-text the learner writes, a 1–5 confidence rating, and **one privacy choice per card**. Today the default is sharing with facilitators. Planned from 20 November 2026: the default is "Only me".
- Accessibility preferences (text size, easy-read font, contrast).
- **Activity events** linked to the user: course opened, seconds per stage, in-video answers right or wrong.
- **Staff notes** about a learner (free text, up to 2000 characters) and **competence validations** with free-text evidence.
- Session, sign-in token and rate-limit records; an **audit log** of staff actions.
- Role and organisation/cohort membership.
- Guest progress is kept only in the learner's own browser until someone signs in on that browser; it is then merged into that account.

**Not collected by the platform (by design), and its limits:**
- Not collected by the platform: passwords (sign-in is a one-time email link), geolocation, biometric data.
- IP addresses are not stored in the platform database. They do appear in hosting-provider request logs. They also reach YouTube where a lesson embeds it; click-to-load is planned from 20 November 2026.
- **Special categories of data (Art. 9)** are not asked for, but the free-text fields (learner reflections and Comp Card, staff notes and evidence) cannot technically exclude them. The DPIA addresses this.
- Learners write their own reflections; staff write the notes and evidence.

**Nature & purpose:** operation of the SEQ Elevate learning platform (see §1).

**Duration / retention:** `[Controller to define — statutory and/or programme-
contractual retention period, and the deletion schedule after a cohort/the
programme ends.]` `[For DIESIS / its adviser: retention. SENIC's suggested
default (Q21–Q23): "programme" means the whole project; learners' accounts,
progress, Comp Cards and activity are deleted from the platform on 1 July 2028;
anonymous statistics and partners' own records are kept to 2032, pending
confirmation of when the 5-year period starts (SENIC's plan adds that groups
under 5 are suppressed in the statistics); people who join later are
deleted after 12 months without activity; staff accounts are deleted when the
person leaves, or in July 2028. The rule must also cover the activity and audit
log, unused sign-in tokens, uploaded files and backups.]` Today learner records
are kept with no time limit. Scheduled deletion is not built yet. SENIC builds
it, with a dry run and DIESIS's approval, before the first deletion date.
Learner-initiated erasure is available today.

---

# Annex II — Technical and organisational measures (Art. 32)

*As implemented by the Processor on the SEQ Elevate platform. Measures not yet
in place are listed separately under "Measures planned"; each moves into the
lists above it only once it is live.*

**Access control & authentication**
- Passwordless sign-in via one-time email link; **no passwords stored**.
- Rate limits on sign-in, invitations and file uploads (abuse mitigation). Keys for email-based limits are hashed; the other keys use internal user ids.
- Project-scoped **role-based access control** (Learner / Facilitator / Content-Editor / Admin), checked **server-side**, scoped to the project, on every data operation and file-upload authorisation. Organisation scoping and server-side Comp Card filtering are planned from 20 November 2026 (see "Measures planned"); until then Comp Card field visibility is applied on the staff screen.

**Data minimisation & privacy by design**
- Minimal identity data: the email address, and a name only if an admin enters one. No passwords, IP addresses, geolocation or biometric data in the platform database; see Annex I on provider logs, YouTube and free text.
- **Cookieless** web analytics (Plausible) is built in but **not active**. `[For DIESIS / its adviser: whether to activate it, and whether any cookie consent is needed, in particular for YouTube.]`
- Comp Card: one privacy choice per card; today shared with facilitators by default. Course reflection answers are not shown to staff.
- Error monitoring (Sentry) is built in but **not active**. If activated, it is configured not to send default personal data, without performance tracing, and without session replay.

**Confidentiality, integrity, availability & resilience (Art. 32(1)(b))**
- HTTPS for the site; TLS to the database `[SENIC to confirm]`.
- **Encryption at rest** for the database, file storage and off-site backups (provider-managed). Backups can also be encrypted before upload with an age key; as of 20 October 2026 this is not set.
- Data hosted in the **EU**, with the exceptions in §4: database in **Neon, Frankfurt (AWS eu-central-1)**; file storage in **Vercel Blob, Frankfurt (`fra1`, AWS eu-central-1)**; backups in **Scaleway, Paris (`fr-par`)**.
- **Backups:** Neon point-in-time restore (6 hours on the current Free plan; 7 days after the move to the paid Launch plan before participants start `[to confirm once set]`) and daily off-site backups to Scaleway (Paris) since 20 Oct 2026, taken with a read-only database role and verified on every run:
  - kept 30 days; the newest 7 copies are always kept, so if backups stop, an older copy can remain until new ones replace it. Copies older than 30 days are deleted only at the end of a successful nightly run;
  - session and sign-in-token rows are excluded;
  - each backup is made, checked and test-restored on a GitHub-hosted runner, where it exists briefly and unencrypted during the run;
  - uploaded files are not backed up.
- Version-controlled code; automated CI (type-check, lint, unit + end-to-end tests, automated accessibility checks) gating every change; reviewed, versioned database migrations.

**Accountability & monitoring**
- An **audit log** of staff actions. It does not record sign-ins, staff viewing learner data, or document changes. On erasure the remaining rows lose the actor reference, but some keep the person's user id, so they are not anonymous (see DATA-PROTECTION.md §2b).
- **WCAG 2.2 AA** accessibility (equitable access), internally tested.

**Data-subject rights (built in)**
- Self-service **data export** (JSON) and **account deletion**. Other requests are handled on the Controller's instruction (§3(d)).

**Ability to restore / test measures (Art. 32(1)(c),(d))**
- Provider-level redundancy; daily verified off-site backups with a documented restore procedure.
  - Each nightly run also test-restores the dump on the runner (since 20 Oct 2026).
  - A manual test restore into a Neon branch is planned every quarter. The first is planned for 23–27 Nov 2026.
  - The restore procedure requires re-applying the erasures and corrections made after a backup's date before restored data is used (a manual step; see DATA-PROTECTION.md §5).
- The measures above are reviewed as the platform evolves. `[External penetration test: planned / on request.]`

**Measures planned before the pilot (Release 3, 20 November 2026)** — *planned, not yet in place*
- Comp Card "Only me" by default, filtered on the server;
- a sign-up screen (name or nickname, country, Terms, age confirmation);
- partner admins and facilitators limited to their own organisation, enforced on the server;
- statistics without staff and test accounts;
- YouTube only after a click;
- a safeguarding contact shown to learners;
- a legal notice.

Also planned, date `[SENIC to confirm]`: the app's own security headers;
deleting uploaded files when they are removed from a lesson; removing the user
id from the rows that remain after erasure, and deleting unused sign-in tokens;
fixing known weaknesses in the rate limiter.

---

# Annex III — Approved sub-processors

| Sub-processor | Service | Domicile | Data location | Transfer safeguard |
|---|---|---|---|---|
| **Vercel Inc.** | Application hosting + file storage (Vercel Blob) | USA | **EU** (compute pinned to Frankfurt `fra1`; Blob store in **Frankfurt `fra1`**; request logs `[SENIC to confirm]`) | DPA + **SCCs** |
| **Neon Inc.** | PostgreSQL database (learner records) | USA | **EU — Frankfurt** (AWS eu-central-1) | DPA + **SCCs** |
| **Resend Inc.** | Transactional email (sign-in links and invitations) | USA | USA | DPA + **SCCs** |
| **Scaleway SAS** | Off-site database backups (daily since 20 Oct 2026; kept 30 days, newest 7 always kept) | France (**EU**) | **EU — Paris** (`fr-par`) | Scaleway's DPA; no third-country transfer |
| **GitHub Inc.** | Backup runner (runs the nightly backup job: creates, checks and test-restores the database dump, which exists briefly and unencrypted on the GitHub-hosted runner during the run; holds the read-only database login as a secret), source code, automated tests | USA | `[SENIC to confirm]` | DPA + `[transfer tool, for the adviser]` `[For DIESIS / its adviser: approve]` |
| **Plausible Insights OÜ** | Web analytics, **only if activated** | Estonia (**EU**) | EU | Not active `[to confirm]`. It becomes a sub-processor only if the Controller decides to activate it. |
| **Sentry (Functional Software Inc.)** | Error monitoring, **only if activated** | USA | `[to confirm]` | Not active `[to confirm]`. If activated: DPA + `[transfer tool]` |

The Controller authorises the above as sub-processors. SENIC will hold the
executed sub-processor DPAs and make them available to the Controller on
request. SENIC has confirmed that the Vercel Blob store `seq-elevate-demo-blob`
is in Frankfurt (`fra1`) (D13), and will confirm that production uses this
store and that the **SCCs** are in place.

---

## Signatures

**Controller (DIESIS):** ______________________  Name / role: __________  Date: ______

**Processor (SENIC):** ______________________  Name / role: __________  Date: ______

---

*Prepared by SENIC as a technically-accurate draft to support the controller's
Art. 28 compliance. Review by qualified data-protection counsel is required
before use.*

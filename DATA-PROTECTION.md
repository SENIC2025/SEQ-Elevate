# SEQ Elevate — data-protection technical description (for the DPIA / processing register)

This document is SENIC's **technical** description of how the SEQ Elevate
platform processes personal data, to support the controller's DPIA and Pro
Arbeit's processing register. It is not legal advice. Fields that belong to the
**data controller** (legal basis, retention periods, controller identity) are
marked **[Controller]** and must be completed by the consortium's counsel /
data-protection officer.

_Last updated: 2026-10 · maintained by SENIC (developer & operator)._

---

## 1. How and where is the platform technically operated?

**Cloud (public cloud, managed services).** It is **not** on-premises and not a
dedicated/private cloud. From Pro Arbeit's perspective it is effectively
provided as **Software-as-a-Service**, operated by SENIC on the following
managed-cloud providers (sub-processors):

| Component | Provider | Hosting location | Personal data involved |
|---|---|---|---|
| Application / compute (serverless) | **Vercel** (Vercel Inc., US) | **EU — Frankfurt (`fra1`)**, pinned in `vercel.json` (29 Sep 2026; previously Vercel's default `iad1`, US East) | Processes requests in transit |
| Primary database (PostgreSQL) | **Neon** (Neon Inc., US) | **EU — Frankfurt (AWS eu-central-1)** | All stored personal data |
| File/media storage (uploaded documents & lesson videos) | **Vercel Blob** | **EU — Frankfurt (`fra1`, AWS eu-central-1)** | **Staff-authored course media only** — learners upload nothing |
| Transactional email (sign-in links, invitations) | **Resend** (Resend Inc., US) | US | Recipient email address; for invitations also their optional name, role, and the inviting admin's name (or email) |
| Web analytics | **Plausible** (Plausible Insights OÜ, Estonia, EU) | EU | **None** — cookieless, no personal data, no IP retention |
| Off-site database backups (daily, kept 30 days) | **Scaleway** (Scaleway SAS, France, EU) | **EU — Paris (`fr-par`)** | A copy of the database (all stored personal data except sign-in tokens), in a private bucket encrypted at rest; optionally also encrypted before upload (see §6) |

> **File storage residency (D13):** file uploads use the Vercel Blob store
> `seq-elevate-demo-blob`, region **`FRA1` (Frankfurt → AWS eu-central-1,
> Germany)** — **verified in the dashboard**. The store holds **staff-authored
> course media only** (lesson videos/documents); learners upload no files.
> Learner **records** (database) are EU-hosted (Neon, Frankfurt). Keep Vercel's
> DPA/SCCs on file (Vercel Inc. is US-domiciled; the data resides in the EU).

Because Vercel, Neon and Resend are US companies, transfers to them are
**third-country transfers** requiring an Art. 28 DPA + SCCs (see §7).

---

## 2. Type of data processing (operations that take place)

| Operation | Applies | Where / how |
|---|---|---|
| Organisation & sorting | ✅ | Learners grouped into organisations & cohorts; courses/documents ordered |
| Storage | ✅ | PostgreSQL (Neon, EU) + file storage (Blob) + daily off-site backup copies (Scaleway, Paris; kept 30 days) |
| Provision / making available | ✅ | Serving content and a learner's own data back to them and to authorised staff |
| Retention | ✅ | Records kept in the database while a learner is active (period **[Controller]**) |
| Retrieval | ✅ | Reading a learner's progress / Comp Card |
| Querying | ✅ | Database queries (parameterised, via Prisma) |
| Modification | ✅ | Updating progress, reflections, roles, cohort assignments |
| Transmission | ✅ | Sign-in email (Resend); a learner's data export to themselves |
| Distribution | ⚠️ limited | A learner's Comp Card fields are shown to their facilitator **only per the learner's own per-field privacy choice** |
| Matching | ❌ | No profiling, scoring against other people, or automated decision-making |
| Linking | ✅ | Linking a user to their enrolments, cohort and organisation |
| Deletion / destruction | ✅ | Self-service account deletion; cascading erasure (see §5) |
| Restriction | ✅ | Comp Card privacy settings; consent withdrawal; content publish/unpublish |

---

## 2b. Work processes — what personal data is used at each step

The personal data actually stored is deliberately minimal. **No passwords**
(sign-in is a one-time email link), **no IP addresses, no geolocation, no
tracking cookies, no biometric or special-category data by design.**

| # | Process | Personal data used | Operation(s) |
|---|---|---|---|
| 1 | **Account creation & sign-in** | Email address (used to send a one-time link via Resend); optional display name | Storage, transmission, retrieval |
| 2 | **Working through a course** | Which stages completed, the choices made in exercises, assessment answers (`CourseEnrollment`) | Storage, modification, retention |
| 3 | **Comp Card (self-reflection)** | Free-text reflections the learner writes + a 1–5 confidence rating + a **per-card privacy choice** (private / facilitator) | Storage, modification, restriction |
| 4 | **Facilitator support** | An authorised facilitator retrieves a cohort learner's progress and the Comp Card fields the learner consented to share | Retrieval, provision |
| 5 | **Admin / cohort management** | Email, name, role(s), organisation & cohort assignment (`Membership`) | Organisation, modification, linking |
| 6 | **Activity events (learning analytics)** | Event records: actor id + action + timestamp (e.g. "course opened", "time on stage"); **metadata contains no PII** | Storage, retention |
| 7 | **Analytics dashboard** | **Aggregated** cohort statistics for facilitators; individual rows only to authorised staff | Retrieval, provision |
| 8 | **GDPR self-service** | Export (the learner downloads their own data) and delete (erases it) | Transmission, deletion |
| 9 | **Accessibility preferences** | Text size / easy-read / contrast flags on the user record | Storage, modification |
| 10 | **Invitation email** | An admin adds someone and (by default) emails them a one-click join link: their email, optional name, role, and the inviting admin's name (or email), sent via Resend. Only an admin can trigger it; the link expires after 7 days | Transmission |

Retention note: on account deletion, `CompCard`, `CourseEnrollment`, `Session`
and membership rows are **cascade-deleted**; audit-log entries are **anonymised**
(the actor reference is set to null) so a tamper record survives without the person.

---

## 3. Is data transferred to recipients outside Pro Arbeit?

**Yes — two distinct categories:**

**(a) Consortium partners, via role-based access — _(online) retrieval by third parties_.**
Staff who are granted a **Facilitator** or **Admin** role can access learner
data through the platform: a facilitator sees their cohort's progress and the
Comp Card fields a learner chose to share; an admin sees project-level
management data. This is **access-controlled retrieval**, governed by (i) which
role each partner's staff is granted and (ii) the learner's own Comp Card
privacy choice. It is **not** an active push of data.

> **[Controller] governance note:** the platform is currently a **single project**
> with access controlled by role (not hard-siloed per partner organisation). The
> consortium must decide and document who receives Facilitator/Admin roles and
> whether cross-cohort visibility is acceptable, as this defines the actual set
> of recipients. SENIC can tighten row-level scoping per organisation if the
> consortium requires strict siloing.

**(b) Sub-processors — _active storage/processing on SENIC's instruction_.**
The providers in §1 (Vercel, Neon, Resend, Scaleway; Plausible processes no
personal data) store and process data solely to run the service, under Art. 28
DPAs.

**Transfer method:** (online) retrieval by authorised third parties (a);
processing by sub-processors under contract (b). No bulk export or sale; no
advertising or third-party trackers.

---

## 4. Third-party / remote maintenance

1. **Does third-party access to personal data occur through maintenance?** **Yes.**
   SENIC operates and maintains the platform. **Service is provided via remote
   access** (Vercel + Neon dashboards, GitHub, over HTTPS) — **no on-site
   access**.
2. **What the service covers:** software maintenance & updates, security
   patching, database administration, deployment/release management, monitoring,
   troubleshooting.
3. **Person/company commissioned:** **SENIC** (developer & operator). Underlying
   infrastructure sub-processors: Vercel, Neon, Resend, Scaleway, Plausible.
4. **Registered office in a third country?** **[SENIC to confirm its own legal
   seat.]** The infrastructure sub-processors **Vercel Inc.** and **Neon Inc.**
   and **Resend Inc.** are **US-based (third country)** → SCCs required; the
   database itself is hosted in the **EU**. **Plausible** (Estonia) and
   **Scaleway** (France, backups) are EU companies.
5. **Access rights of the maintainer:** **Administrative / maximum privileges**
   to the hosting environment (necessary to operate it). Day-to-day the app's
   own RBAC governs in-app data access.
6. **Contractual data-protection arrangement (DPA)?** **Required — see §7.** A
   controller↔processor DPA (consortium ↔ SENIC) plus DPAs/SCCs with each
   sub-processor.
7. **Is the service monitored?** In-app **audit logging** records
   security-relevant actions; the hosting providers keep their own access logs.
8. **Remote-access method:** **Internet / HTTPS with explicit per-account
   authorisation** (provider accounts, 2FA-capable). No ISDN, no permanent
   open/VPN tunnel.

---

## 5. Retention & storage periods

- **Regulated?** **Not yet by a formal policy — [Controller] to set.** Likely a
  mix of **statutory** (any programme record-keeping obligation) and
  **contractual** (Erasmus+/programme terms). The platform does not impose a
  period of its own.
- **Regular automatic deletion within time limits?** **Not yet** — there is no
  scheduled purge. However **learner-initiated deletion is implemented** and
  performs a real erasure (cascade delete + audit anonymisation).
- **Data-deletion policy document?** **Not yet formalised — [Controller] to
  produce.** The platform **technically supports** full erasure and data export
  (GDPR self-service), so the policy can be enforced once defined. SENIC can add
  a scheduled auto-purge (e.g. "delete N months after a cohort ends") once the
  retention rule is agreed.
- **Backups:** daily off-site copies are kept **30 days**, then deleted
  automatically; Neon's own point-in-time history is kept up to 7 days
  (6 hours while on Neon's Free plan). Data a
  learner erases therefore leaves the backups within 30 days. A backup is never
  restored without re-applying the erasures and corrections made after its date
  (BACKUP.md, R10).

---

## 6. Technical & organisational measures (TOMs) — SENIC

Provided in response to the request for SENIC's TOMs. All are implemented today
unless marked _planned_.

**Access control & authentication**
- Passwordless sign-in (one-time email link); **no passwords stored**.
- Project-scoped **role-based access control** (Learner / Facilitator / Content-Editor / Admin) enforced server-side on every action.
- Server-side authorisation on all data-mutating operations and file-upload token issuance.
- Rate-limiting on the sign-in and upload endpoints (anti-abuse; keys hashed).

**Data minimisation & privacy by design**
- Minimal PII (email + optional name); **no IP, geolocation, tracking cookies, or special-category data**.
- **Cookieless** analytics (Plausible) — no consent banner required.
- Comp Card **per-field privacy control**; learner reflections default to private.
- Error monitoring (Sentry) is wired **without PII, without performance tracing, and without session replay**.

**Data subject rights**
- **Self-service data export** (JSON/CSV) and **account deletion** built in.
- Deletion cascades to a learner's records; audit entries are **anonymised** on erasure.
- Consent-withdrawal action recorded in the audit log.

**Encryption & residency**
- **Encryption in transit** (HTTPS/TLS everywhere).
- **Encryption at rest** for the database, file storage and off-site backups (provider-managed; backups optionally also encrypted before upload, with a key only SENIC's named key holders have).
- Primary learner records hosted in the **EU (Frankfurt)**; backups in the **EU (Paris)**.

**Integrity, availability & operations**
- Version-controlled code; automated CI (type-check, lint, unit + end-to-end tests, automated accessibility checks) gating every change.
- Database schema changes via reviewed, versioned migrations.
- **Backups:** Neon point-in-time restore (history window 7 days **[to confirm once set; 6 hours while the project is on Neon's Free plan]**) and a **daily off-site backup** to Scaleway (Paris), kept 30 days: taken with a **read-only** database role, sign-in tokens left out, verified on every run (size, tables, every data block; the stored copy read back and compared), with a restore procedure and quarterly test restores (BACKUP.md). **[Active from: date of the first successful run.]**
- **Audit log** of security-relevant actions.
- **WCAG 2.2 AA** accessibility (relevant for equitable access; internally tested).

_Planned / on request:_ external penetration test; scheduled retention auto-purge; EU file-storage bucket; Sentry activation with a DSN.

---

## 7. Data-processing agreements to put in place

For the controller's file:

1. **Controller ↔ Processor DPA** — between the **data controller** (consortium /
   the named controller) and **SENIC** (processor operating the platform).
2. **Sub-processor DPAs / SCCs**, held by SENIC and disclosed to the controller:
   - **Vercel** (hosting + Blob storage) — US company; compute EU-configurable, **Blob store in Frankfurt (`fra1`)** → DPA + SCCs.
   - **Neon** (database) — US company, EU-hosted data → DPA + SCCs.
   - **Resend** (email) — US → SCCs.
   - **Plausible** — EU (Estonia); processes no personal data (DPA still advisable).
   - **Scaleway** (off-site backups) — EU (France), data in Paris → Scaleway's
     standard DPA (accepted with its terms); no third-country transfer.
3. Confirm the **Vercel Blob region/DPA** (or migrate to an EU bucket) before
   real learner uploads (D13).

SENIC will provide its current TOMs (§6) and the executed sub-processor DPAs on
request.

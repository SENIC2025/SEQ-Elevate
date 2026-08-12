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

- **Controller:** `[Legal name, address, and — if applicable — the joint-controller arrangement of the consortium / lead beneficiary / participating partner organisation(s), to be determined by the consortium. Contact / DPO: __________ ]`
- **Processor:** **SENIC** — `[SENIC full legal name, registered address, company/registration number, contact]`, operator of the **SEQ Elevate** learning platform.

The Controller determines the purposes and means of processing personal data
of programme participants; the Processor processes that data **only on the
Controller's behalf** to operate the platform. Where the Processor engages
third parties (Annex III), those act as **sub-processors**.

**Programme reference:** SEQ Elevate — DIESIS-led consortium `[Erasmus+ / grant ref: __________ ]`.

---

## 1. Subject matter, duration, nature and purpose

- **Subject matter:** processing of personal data necessary to provide and operate the SEQ Elevate digital learning platform.
- **Nature & purpose:** hosting a gamified, accessible, trilingual (EN/DE/EL) micro-learning platform for young people (NEET) to develop life/work skills; storing their learning progress and private reflections; enabling facilitators to support their cohorts; providing aggregate analytics; and enabling data-subject rights (export/erasure).
- **Duration:** for the term of the Controller↔Processor engagement (the programme period and any agreed maintenance term), after which data is returned or deleted per §9.
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
portability, objection). *The platform provides self-service **data export**
and **account deletion**, which satisfy the bulk of these requests directly.*

**(e) Assistance with compliance** — the Processor assists the Controller in
ensuring compliance with Art. 32–36 (security, breach notification, DPIA, prior
consultation), taking into account the nature of processing and information
available to the Processor. *This DPA, Annex II, and the platform's
`DATA-PROTECTION.md` support the Controller's DPIA.*

**(f) Personal-data breach** — the Processor notifies the Controller **without
undue delay** (target: within `[e.g. 48 hours]`) after becoming aware of a
personal-data breach, providing the information the Controller needs to meet its
Art. 33/34 obligations.

**(g) Deletion or return** — at the Controller's choice, on termination the
Processor **deletes or returns** all personal data and deletes existing copies,
unless EU/Member-State law requires storage. See §9.

**(h) Audits** — the Processor makes available information necessary to
demonstrate compliance with Art. 28 and allows for and contributes to audits,
including inspections, by the Controller or an auditor it mandates (reasonable
notice; confidentiality; may be satisfied by up-to-date documentation/attestations).

---

## 4. International transfers

Personal data is stored in the **European Union** (see Annex II). Where a
sub-processor is domiciled outside the EEA (Annex III), transfers are covered by
**EU Standard Contractual Clauses (SCCs)** and/or an adequacy decision, together
with any supplementary measures. The Processor does not transfer personal data
outside the EEA except as set out in Annex III or on the Controller's
instructions.

---

## 5. Liability, term, governing law

`[To be completed by counsel: liability allocation, term/termination, governing
law and jurisdiction — typically the Controller's Member State. Align with the
main services contract (DIESIS-SEQ ELEVATE-SERVICE-M1-2026-01).]`

---

# Annex I — Description of the processing

**Categories of data subjects**
- Programme participants / **learners** (young people, incl. under-18s per the programme's safeguarding approach).
- **Facilitators / staff** of participating partner organisations.
- **Content editors / administrators**.

**Types of personal data**
- Identity & contact: **email address** (used only for passwordless sign-in); optional **display name**.
- Learning data: course progress, stages completed, choices made in exercises, assessment answers.
- **Self-reflection ("Comp Card")**: free-text the learner writes, a 1–5 confidence rating, and a **per-entry privacy choice** (private / shareable with facilitator).
- Accessibility preferences (text size, easy-read font, contrast).
- Activity events for learning support/analytics: actor reference + action + timestamp (**no PII in event metadata**).
- Role and organisation/cohort membership.

**Explicitly NOT processed (by design):** passwords (sign-in is a one-time email
link), IP addresses, geolocation, tracking cookies, and **special categories of
data (Art. 9)**. Free-text reflection fields are not intended for special-category
data; the learner is their sole author and controls their visibility.

**Nature & purpose:** operation of the SEQ Elevate learning platform (see §1).

**Duration / retention:** `[Controller to define — statutory and/or programme-
contractual retention period, and the deletion schedule after a cohort/the
programme ends. The platform supports scheduled auto-purge on request and
learner-initiated erasure today.]`

---

# Annex II — Technical and organisational measures (Art. 32)

*As implemented by the Processor on the SEQ Elevate platform.*

**Access control & authentication**
- Passwordless sign-in via one-time email link; **no passwords stored**.
- Rate-limiting on the sign-in and file-upload endpoints (abuse mitigation; keys hashed).
- Project-scoped **role-based access control** (Learner / Facilitator / Content-Editor / Admin), enforced **server-side** on every data operation and file-upload authorisation.

**Data minimisation & privacy by design**
- Minimal personal data (email + optional name); no IP, geolocation, tracking cookies, or special-category data.
- **Cookieless** web analytics (no personal data, no consent banner required).
- Comp Card **per-entry privacy control**; learner reflections default to private.
- Error monitoring configured **without PII, without performance tracing, and without session replay**.

**Confidentiality, integrity, availability & resilience (Art. 32(1)(b))**
- **Encryption in transit** (TLS/HTTPS) throughout.
- **Encryption at rest** for the database and file storage (provider-managed).
- Data hosted in the **EU**: database in **Neon, Frankfurt (AWS eu-central-1)**; file storage in **Vercel Blob, Frankfurt (`fra1`, AWS eu-central-1)**.
- Managed-provider **backups**; retention tier `[to confirm]`.
- Version-controlled code; automated CI (type-check, lint, unit + end-to-end tests, automated accessibility checks) gating every change; reviewed, versioned database migrations.

**Accountability & monitoring**
- **Audit log** of security-relevant actions; erasure **anonymises** audit references so a record survives without the person.
- **WCAG 2.2 AA** accessibility (equitable access), internally tested.

**Data-subject rights (built in)**
- Self-service **data export** (JSON/CSV) and **account deletion** (cascading erasure); consent-withdrawal recorded.

**Ability to restore / test measures (Art. 32(1)(c),(d))**
- Provider-level redundancy and backups; the measures above are reviewed as the platform evolves. `[External penetration test: planned / on request.]`

---

# Annex III — Approved sub-processors

| Sub-processor | Service | Domicile | Data location | Transfer safeguard |
|---|---|---|---|---|
| **Vercel Inc.** | Application hosting + file storage (Vercel Blob) | USA | **EU** (compute EU-configurable; Blob store in **Frankfurt `fra1`**) | DPA + **SCCs** |
| **Neon Inc.** | PostgreSQL database (learner records) | USA | **EU — Frankfurt** (AWS eu-central-1) | DPA + **SCCs** |
| **Resend Inc.** | Transactional email (sign-in links) | USA | USA | DPA + **SCCs** |
| **Plausible Insights OÜ** | Web analytics | Estonia (**EU**) | EU | Processes **no personal data**; DPA advisable |

The Controller authorises the above as sub-processors. SENIC will hold the
executed sub-processor DPAs and make them available to the Controller on
request, and will confirm the **Vercel Blob store region (`fra1`)** and the
active SCCs.

---

## Signatures

**Controller:** ______________________  Name / role: __________  Date: ______

**Processor (SENIC):** ______________________  Name / role: __________  Date: ______

---

*Prepared by SENIC as a technically-accurate draft to support the controller's
Art. 28 compliance. Review by qualified data-protection counsel is required
before use.*

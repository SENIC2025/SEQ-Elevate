# Proposed amendment — hosting & infrastructure substitution

**Contract:** DIESIS-SEQ ELEVATE-SERVICE-M1-2026-01 · **Item 2** (€5,500 lump, 5-year hosting & maintenance)
**Between:** SENIC (contractor) and the consortium (client)
**Status:** ⚠️ **Proposed — requires consortium approval.** SENIC is not changing terms unilaterally; this documents what was delivered and asks the consortium to approve the substitution. Not legal advice — have counsel review.

---

## Why this note exists

The signed proposal named **Hetzner or Hostinger Cloud** and **S3-compatible object storage** for Item 2. During build, SENIC deployed on **Vercel + Neon** instead (decision D22), for lower operational risk, zero-ops managed scaling, auto-migrate-on-deploy, and instant rollback — a deliberate engineering choice. **The contractual *intent* — all data hosted in the EU (Germany), with object storage, SSL, backups, email, monitoring and analytics — is fully preserved.** Only the named providers differ. This note asks the consortium to approve that substitution so the invoice matches reality.

## Data residency is unchanged (the point that matters for GDPR)

**All personal data remains in the European Union — Frankfurt, Germany:**
- Database (all learner records): **Neon PostgreSQL — Frankfurt, AWS eu-central-1**.
- Course media: **Vercel Blob — Frankfurt (`fra1`), AWS eu-central-1**.
- Off-site backups: **S3-compatible bucket in the EU** (you choose the provider/region).
- Compute: **Vercel**, EU-configurable region. Email: **Resend** (US, transit of the email address only, under SCCs). Analytics: **Plausible** (EU, no personal data).

## Item-by-item delivery status

| # | Contract wording | Delivered | Status |
|---|---|---|---|
| 1 | Production + staging hosting on **Hetzner/Hostinger Cloud** (EU-DE) | **Vercel** compute + **Neon Postgres, Frankfurt** | 🔁 **Substituted** — EU/Germany preserved; approval requested |
| 2 | Object storage, **S3-compatible**, EU | Media on **Vercel Blob** (Frankfurt, EU; not S3-API). Backups on **genuine S3-compatible EU** storage | 🔁 **Substituted** (media) — approval requested |
| 3 | SSL, auto-renew (Let's Encrypt) | Vercel auto-issues + renews certs (Let's Encrypt) | ✅ **Met** |
| 4 | Transactional email | **Resend**, wired + verified | ✅ **Met** |
| 5 | Error monitoring (Sentry) + uptime | Sentry **wired** (activate with DSN); uptime monitor **to configure** | 🟡 **Partial** |
| 6 | Analytics (Plausible, cookieless) | Wired; activate with `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | 🟡 **Activation pending** |
| 7 | Automated DB backups, daily, **30-day** retention | **Implemented** — daily `pg_dump` → S3-compatible EU bucket, 30-day prune ([BACKUP.md](BACKUP.md)) | ✅ **Met** (once bucket + secrets set) |
| 8 | Annual security patches + dependency updates | 5-year commitment | ⏳ **Ongoing** from go-live |
| 9 | Critical (P0/P1) bug fixes, 5 years | 5-year commitment | ⏳ **Ongoing** from go-live |
| 10 | Email support, next-business-day | 5-year commitment | ⏳ **Ongoing** from go-live |

**Legend:** ✅ delivered · 🟡 delivered, one activation step remaining · 🔁 delivered via a substitute provider, EU-preserved, approval requested · ⏳ prospective 5-year obligation that begins at go-live.

## What SENIC asks the consortium to approve

1. **Substitute the named hosting** (Hetzner/Hostinger) with **Vercel + Neon (Frankfurt, EU)** for compute + database — Item 2 §1.
2. **Substitute the media object store** with **Vercel Blob (Frankfurt, EU)**, with off-site backups on S3-compatible EU storage — Item 2 §2/§7.
3. Confirm that these substitutions **satisfy Item 2** for invoicing, the €5,500 lump, and the 5-year term.

Items 3, 4 and 7 are delivered as specified. Items 5 and 6 are one activation step each (Sentry DSN, Plausible domain). Items 8–10 are ongoing commitments that begin on the go-live date.

## Alternative, if the consortium prefers the letter of the contract

SENIC can instead **migrate to Hetzner/Hostinger + S3-compatible storage** to match the original wording verbatim. This is more operational overhead and removes the managed-scaling/rollback benefits of the current stack; SENIC recommends the substitution above, but the choice is the consortium's.

---

## Approval

**Consortium (client):** _______________________  Name / role: __________  Date: ______

**SENIC (contractor):** _______________________  Name / role: __________  Date: ______

*Go-live date (start of the 5-year term): __________ (per the Vercel production deployment that first served `seq-elevate.eu` in production mode).*

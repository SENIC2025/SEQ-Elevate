# SEQ Elevate — production go-live runbook

This is the checklist to take SEQ Elevate from the **demo deploy**
(`seq-elevate-demo.vercel.app`, demo login on, placeholder data) to a
**real production launch** serving NEET learners.

Legend: **[SENIC]** engineering can do · **[Dashboard]** set in Vercel/Resend UI ·
**[Consortium]** owned by the programme.

---

## 1. Environment variables (Vercel → production project → Settings → Environment Variables)

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Neon **pooled** connection string | Already set for the app. EU region. |
| `DIRECT_URL` | *(optional)* Neon **direct** string | Only if the auto-derived direct endpoint (pooled host minus `-pooler`) is wrong. Used for migrations. |
| `AUTH_SECRET` | **a fresh strong secret** | Generate: `openssl rand -base64 33`. **Must not** be the dev placeholder. Rotating it signs everyone out. |
| `AUTH_URL` | `https://<your-domain>` | The canonical production URL. Pins host detection + magic-link base. |
| `RESEND_API_KEY` | `re_…` restricted **sending** key | From Resend. Sending-only scope. |
| `EMAIL_FROM` | `SEQ Elevate <no-reply@your-domain>` | Must be on a **verified** Resend domain (see §4). |
| `DEMO_LOGIN_DISABLED` | `true` | **The launch switch.** Disables one-click demo logins **and** the seeded demo course. |
| `DEMO_ACCESS_CODE` | *(unset)* | The demo-login code. Governed by `DEMO_LOGIN_DISABLED` — set that to `true` on real prod to turn demo login off entirely (§2). Optionally set a private value here as belt-and-suspenders. |
| `BLOB_READ_WRITE_TOKEN` | auto-set by Vercel Blob | Present once a Blob store is connected. **Use a Frankfurt (`fra1`) store — see §5.** |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | your domain | Enables cookieless analytics. Optional. |
| `CMS_SOURCE` | *(unset = `local`)* | Leave unset; the in-app DB CMS is the content source. Only set to `strapi` if Strapi is ever adopted. |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | *(paste DSN to activate)* | Sentry is already wired + inert; set both to your DSN and redeploy. See §6. |

> After changing env vars, **redeploy** so they take effect.

---

## 2. The launch switch — one flag flips the whole environment to production mode  **[Dashboard]**

Setting **`DEMO_LOGIN_DISABLED=true`** on the production project does three things at once:
1. The `/demo` one-click profile logins stop working (sign-in becomes magic-link only).
2. The seeded demo course (`demo-speaking-up`) is **not** re-seeded on deploy.
3. Everything else (real courses, cohorts, learners) is unaffected.

This is the single most important production setting — **it is the only thing
that turns demo login off**, and demo login can grant an ADMIN session. Verify
`DEMO_LOGIN_DISABLED=true` on the real production project **before the first
real learner**. (For extra safety on a custom domain you can also set a private
`DEMO_ACCESS_CODE`, but the kill-switch is the authoritative gate.)

---

## 3. Domain + DNS  **[Consortium owns DNS] [SENIC assists]**

- Pick the production hostname (e.g. `learn.seqelevate.eu`). *(Decision O1.)*
- In Vercel: add the domain to the production project.
- In DNS (consortium holds `seqelevate.eu`): add the `CNAME`/`A` records Vercel shows.
- Set `AUTH_URL` to `https://<that domain>` and redeploy.

---

## 4. Email deliverability (magic-link sign-in)  **[Consortium DNS] [Dashboard]**

Sign-in is passwordless — if email doesn't deliver, no one can log in.
- In Resend: add and **verify** the sending domain (add the DKIM + SPF/return-path DNS records Resend provides).
- Point `EMAIL_FROM` at an address on that verified domain.
- Send a test sign-in to a real inbox (incl. Outlook/Gmail) and confirm it lands **in the inbox, not spam**.

---

## 5. File storage region — **EU / Frankfurt**  **[Dashboard]**  *(Decision D13)*

Uploads must live in the EU. **Decision: use a Vercel Blob store in the
`fra1` (Frankfurt, Germany) region** — data then resides on AWS eu-central-1.
No code change is needed (region is a store property). A store's region
**cannot** be changed after creation, so:

1. In the Vercel dashboard → Storage → **create a new Blob store**, region **Frankfurt (`fra1`)**
   (or CLI: `vercel blob store add <name> --region fra1`).
2. **Connect it to the production project** — Vercel sets `BLOB_READ_WRITE_TOKEN` to the new store.
3. Remove/disconnect the old US-region store.
4. **Redeploy.**

**No migration needed** — the current store holds only staff-authored course
media, nothing production-critical. Keep **Vercel's DPA/SCCs** on file (Vercel
Inc. is a US company; the data resides in Germany).

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

---

## 9. Recommended before first real cohort  **[SENIC]**

- [x] Legal-page render surface + footer — **done**
- [x] Rate-limiting on sign-in + uploads — **done**
- [x] Sentry wiring — **done**; activate by setting the DSN env vars (§6)
- [ ] Security review pass of the recent server actions / upload routes
- [ ] Confirm Neon backup / point-in-time-recovery retention tier **[Dashboard]**
- [ ] (Optional) external WCAG 2.2 AA audit — internal audit passes today *(O5)*

---

## 10. Pre-launch verification (run against the production URL)

1. `DEMO_LOGIN_DISABLED=true` → `/en/demo` no longer signs anyone in.
2. Magic-link sign-in delivers to a real inbox and logs you in.
3. A learner can open a published course, play all 7 stages, and complete it.
4. Account page: export **and** delete work (GDPR self-service).
5. `/en/legal/privacy|terms|cookies|accessibility` all render.
6. Admin can create an org + cohort and add a person.
7. Analytics dashboard loads for a facilitator.

---

## 11. Rollback

- Vercel keeps every deployment — **Promote** a previous good deployment to roll back instantly.
- DB migrations are additive; a code rollback does not require a DB rollback.
- To disable demo artefacts without a deploy, toggle `DEMO_LOGIN_DISABLED` and redeploy.

---

*Realistic critical path: the SENIC engineering items are ~1–2 days. The launch
gating items are the **consortium** ones — domain, DPIA + legal text, verified
email domain, and at least one real course.*

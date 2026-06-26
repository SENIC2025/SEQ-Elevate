# SEQ Elevate Platform — Kickoff Brief

**Meeting**: 25–26 June 2026 · SEQ Elevate consortium + SENIC
**Contract**: DIESIS-SEQ ELEVATE-SERVICE-M1-2026-01
**Prepared by**: SENIC · Created and Powered by SENIC · senic.world

This brief frames the kickoff. Its job: confirm a small number of decisions so content authoring and the 5-week build run without blocking. SENIC has used the pre-kickoff window to stage all infrastructure, so we open the kickoff with a **live, clickable staging platform**, not slides.

---

## 1. Where we are (the good news)

By kickoff, SENIC has already productionised the foundations **and built well into the product** (ahead of plan):

- ✅ **Live, clickable platform** at `seq-elevate-demo.vercel.app` — real auth, EU database, deployed on EU infrastructure
- ✅ **Sign-in** (passwordless magic link) + **one-click demo profiles** for showcasing each role
- ✅ **Full data model** (users, roles, cohorts, courses, lessons, Comp Cards, observations, audit)
- ✅ **In-app content editor** (DB-backed; Strapi-ready) — author **lesson text, interactive videos and documents** with no code
- ✅ **Interactive video** with **in-video quiz pop-ups** + captions; **branching scenarios**; Comp Card + PDF; badges
- ✅ **Facilitator analytics + a statistics dashboard** (progress, time-on-task, where-they-get-stuck, when-they-open)
- ✅ **Trilingual** EN / DE / EL · **WCAG 2.2 AA** · mobile-first · dyslexia + contrast · **GDPR self-service**
- ✅ **Brand** matched to seqelevate.eu (lime / purple / rose)

The contracted 5 weeks are therefore spent on **polish, your content, accessibility audit, training and handover** — not on plumbing.

> **Live walkthrough** opens the meeting — see the presenter pack in `DEMO-SCRIPT.md`. Anyone can also sign in on their own phone via `/en/demo` (code `elevate-demo`) and walk a course end-to-end, in their own language.

---

## 2. Decisions we need from you

Four WP3 strategic decisions block content authoring (not the platform). SENIC has a recommended default for each — if the consortium agrees, we adopt it and move; if not, we discuss. (`DECISIONS.md` O2.)

| # | Decision | SENIC recommendation | Why |
|---|---|---|---|
| **1** | **Number of micro-courses in v1** | Start with **4** (one per priority cluster), architecture supports 24+ | Manageable to author + pilot; CMS scales later with no rework |
| **2** | **Comp Card granularity** | **Hybrid**: one cluster-level long-running card + auto per-course snapshot | Captures the journal value without overwhelming the learner |
| **3** | **Gamification intensity** | **Light-but-visible**, tunable per cohort without code | Honours WP3 "no childish/competitive" while keeping motivation |
| **4** | **Peer / mentor model** | Build the data model now, expose as an **optional per-cohort feature** | Lets some partners use it, others not, without forking the build |

Plus three logistics decisions:

| Decision | Needed for |
|---|---|
| **Production domain** (e.g. `platform.seqelevate.eu`?) | Final go-live URL; staging stays on senic.world until decided |
| **Content authoring schedule** — who authors which courses, by when | At least 1 course in the CMS by Week 4 to test end-to-end |
| **Translation plan** — who translates to DE/EL, by when | Trilingual go-live |

---

## 3. Who does what (scope boundary)

Per the signed proposal, clean split:

| SENIC delivers | Consortium owns |
|---|---|
| The platform: build, deploy, host (5y), maintain | Authoring the 4–6 courses + scenarios + Comp Card text |
| All 4 roles + RBAC, CMS, gamification, Comp Cards | Translation to DE / EL |
| EN/DE/EL framework, WCAG 2.2 AA foundation, GDPR self-service | The 4 WP3 decisions above |
| Training (1 session, recorded) + documentation + handover | Pilots with real NEET learners + iteration |
| Worked-example course (workplace-conflict) | Safeguarding policy, DPIA sign-off, legal page text |

If the consortium wants anything from the right column, SENIC quotes it separately.

---

## 4. The 5-week plan (from kickoff)

| Week | Focus | Demo at end of week |
|---|---|---|
| **1** | Fork to production repo, consortium brand + copy, CMS configured for your content, all 4 roles on real auth | Sign in as any role, switch language |
| **2** | Course player consumes authored content generically; scenario + simulation engines; learner journey | Walk an authored (placeholder) course end-to-end |
| **3** | Comp Card engine, gamification, facilitator workspace, CMS authoring training-ready | Facilitator validates a competence |
| **4** | i18n hardening, accessibility pass, performance, GDPR self-service, **production deploy** | Live on production URL |
| **5** | UX polish from your feedback, **training session**, documentation, **handover + sign-off** | Acceptance |

Weekly Friday demos. The consortium sees progress every week.

---

## 5. What SENIC needs from the consortium

To keep Week 1 unblocked, ideally at/just after kickoff:

1. **The 4 WP3 decisions** (or agreement to adopt the recommended defaults)
2. **Brand kit** (logo files, exact colours, font) — or confirm we use the seqelevate.eu-matched default
3. **Production domain** decision (or "decide by end of Week 1")
4. **Content owner per course** + a rough authoring timeline
5. **Translator contacts** for DE / EL
6. **A consortium GitHub org** (or confirm SENIC holds the repo until handover)
7. **Named contacts**: one technical, one pedagogical, one per pilot country

---

## 6. Acceptance criteria (how "done" is defined)

The platform is accepted when, on production: all 4 roles work with correct permissions; Admin manages users/orgs/cohorts; Content Editor publishes a course + Comp Card template **without code**; a Learner completes a course end-to-end incl. the WP3 sequence + Comp Card; a Facilitator records an observation + validates; EN/DE/EL switching works; Lighthouse mobile ≥ 90; internal WCAG 2.2 AA passes; training delivered; docs + repo handed over.

---

## 7. Open questions parked for later (logged, not blocking)

External WCAG audit (who certifies), safeguarding policy + DPIA owner, legal page text, post-launch content maintenance ownership, pilot launch date. All tracked in `DECISIONS.md` — we'll close them across Weeks 3–5.

---

*See the live platform at `seq-elevate-demo.vercel.app` (demo access: `/en/demo`, code `elevate-demo`). Presenter pack: `DEMO-SCRIPT.md`. Full functionality map: `PLATFORM-OVERVIEW.md`. Component reference at `/en/dev/storybook`.*

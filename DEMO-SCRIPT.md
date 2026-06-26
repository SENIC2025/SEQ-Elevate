# SEQ Elevate — Kickoff One-Pager & Demo Script

_Presenter pack for the consortium kickoff (25–26 June 2026). One page to
share + a step-by-step live demo. Decisions, scope and the 5-week plan are in
`KICKOFF.md`; the full functionality map is in `PLATFORM-OVERVIEW.md`._

**Live:** https://seq-elevate-demo.vercel.app · **Demo access:** `/en/demo` · code **`elevate-demo`**

---

## PART A — One-pager (share this)

### What SEQ Elevate is
A **gamified, multilingual, accessible** platform that helps **NEET young
people** build soft skills through short, interactive micro-courses — and
gives **facilitators** the data to support them.

### Why it fits this audience
- **Low-friction & motivating** — short courses, instant feedback, badges, **no grades or leaderboards**.
- **Accessible by design** — **WCAG 2.2 AA**; a reading-help toolbar (text size, dyslexia-friendly font, high contrast) that follows the learner across devices; captioned video.
- **In their language** — full **English / Deutsch / Ελληνικά**.
- **Privacy-first** — **EU data hosting** (Frankfurt), **GDPR self-service** (download / delete your data), per-field privacy on reflections.

### Live today (not slides)
| For the… | What they get |
|---|---|
| **Young person** | 7-step course: read → **video + pop-up quiz** → documents → simulate → **branching scenario** → reflect → assess; Comp Card + PDF; badges; completion bar |
| **Teacher** | Cohort completion, per-learner progress, **time-on-task**, quiz results, observations & validations, **statistics dashboard** |
| **Content author** | Edit lesson text per language, attach **interactive video**, upload + **order + publish** documents — no code |
| **Admin / org** | Multi-tenant project, roles & permissions, aggregate dashboard, GDPR |

### Status
Staging **live** on Vercel + Neon (EU). Production-ready foundations (auth,
database, CI, auto-migration, WCAG, GDPR). **25 unit + 27 end-to-end tests,
all green.** 5-week clock spends time on **your content, polish, audit,
training, handover** — not plumbing.

### Decisions we need today _(detail in `KICKOFF.md` §2)_
1. **How many micro-courses** in v1? _(default 4 — one per cluster; CMS scales to 24+)_
2. **Comp Card granularity** _(default: hybrid)_
3. **Gamification intensity** _(default: light-but-visible, tunable per cohort)_
4. **Peer / mentor model** _(data model ready, UI feature-flagged)_

Plus: production **domain**, **content + translation** plan, **pilot** plan, **DPIA/safeguarding** owner.

---

## PART B — Demo script (live walkthrough, ~15 min)

> **Before you start:** browser to **`seq-elevate-demo.vercel.app/en/demo`**,
> code **`elevate-demo`** ready. Tip — open the four profiles in separate tabs
> so you can switch instantly. (The learner journey also works as a guest, no
> sign-in.)

### 0 · Framing (1 min)
> "This is the live platform — not slides. Everything runs in the browser, in
> three languages, built to accessibility standards for this audience. I'll
> show it from three sides: the **young person**, the **teacher**, and the
> **content author**."

### 1 · The learner experience (5 min) — _Demo Learner_
1. `/demo` → code → **Enter as Demo Learner** → dashboard.
   > "A young person's home: one clear next step, an **overall completion bar**, their courses and badges — nothing overwhelming."
2. Open **"Handling a small workplace conflict."**
   > "Every course is the same 7-step journey — familiar each time."
3. On the **Concept** stage, let the **lesson video** reach ~4s → the **quiz pop-up** appears; answer it → it resumes. Point out **captions (CC)**.
   > "Video can **pause and ask a question** — engaged, not passive. Authors choose where it pauses."
4. Continue → **Simulation** (pick a response, get feedback) → **Scenario** (a real choice that **branches** to a different outcome).
   > "The heart of it: a realistic situation where the choice changes the outcome. No grades, no shame."
5. Reflection → **Assessment** → completion → **badge**.
6. Top-right: open **Reading help** (text size / dyslexia font / contrast) and the **language switcher** (flip to **Deutsch** / **Ελληνικά**).
   > "Accessibility and language are built in — and the reading settings follow the learner to any device."

### 2 · The teacher experience (4 min) — _Demo Teacher_
1. Switch to **Enter as Demo Teacher** → facilitator workspace.
   > "The teacher sees their cohort: a **completion bar**, who's active, who needs attention."
2. Open a learner → the **Comp Card** (note **privacy redaction**) and the **Activity & performance** panel — **current stage, time per lesson, last active, quiz results**. Mention **observe / validate a skill**.
3. Click **Statistics**.
   > "The full picture: a **completion funnel** showing **where learners drop off**, **time per lesson**, **when they tend to open** the course, a row per learner. Sample data today — it becomes your cohort's real analytics the moment a pilot runs."

### 3 · The content author (3 min) — _Stefan or Demo Editor_
1. Switch to **Enter as Stefan** → **Content editor** (`/content`).
2. **Edit lesson narrative** → course + lesson + language → change the text → **Save**.
3. **Add interactive video** → paste a URL or upload → add a quiz cue → **Save to a lesson**.
4. **Lesson documents** → upload a PDF/Word/image → **reorder** (1.1, 1.2…) → toggle **Publish**.
   > "Authors — not developers — own the content: text, videos with questions, sequenced documents they publish when ready. Open the course as a learner and it's already there."

### 4 · Trust & close (2 min)
- **GDPR** (account menu): **Download my data** / **Delete account**.
- One line each: **EU database (Frankfurt)** · **WCAG 2.2 AA (auto-tested)** · **multi-tenant** · **tested + auto-deployed**.
- Close on the **four decisions** + the content/pilot plan.
> "It's real, live, accessible and GDPR-ready. What we need today are the four
> content decisions and your pilot plan — then we fill it with your courses."

---

## Appendix — cheat-sheet

| | |
|---|---|
| **URL** | seq-elevate-demo.vercel.app/en/demo |
| **Code** | `elevate-demo` |
| **Profiles** | Stefan (Admin+Editor) · Demo Editor · Demo Teacher · Demo Learner |
| **Languages** | top-right switch (EN / DE / EL) |
| **Guest path** | landing → pick a role (no sign-in needed for the learner journey) |

**Fallbacks**
- The learner journey works on any laptop/phone on the same link.
- Don't want to sign in live? Use the guest role-picker on the landing page.
- Each "Enter as …" replaces the session — use separate tabs to jump between roles.

**Frame honestly (it's part of the story)**
- The one-click demo login is a **showcase convenience** — disabled on the real production site.
- Statistics show **representative sample data** until a real cohort runs.

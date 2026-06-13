# SEQ Elevate Platform Shell — Demo Handover Note

**To**: SEQ Elevate Consortium (Diesis Network, Pro Arbeit, Synthesis, University of Macedonia)
**From**: SENIC — Sustainable Entrepreneurship & Innovation Consulting
**Re**: PCR v2.0 (19 May 2026) — Platform Shell, Standard tier (€38,000, 6 weeks)

## What this is

A working demonstration of the platform shell SENIC is proposing to deliver. It is not a mockup or a wireframe — it is a Next.js application built on the exact same stack the real shell will ship on (Next.js 14+ / Tailwind / next-intl / Strapi-ready content model). What you click here is, at the component level, what gets handed over at week 6.

## What it proves

Three claims from PCR v2.0 that you can verify by clicking, not by reading:

1. **The WP3 pedagogical sequence is enforced by the platform.**
   Open `/en/learner` → start the workplace-conflict course. The breadcrumb at the top of the player shows Context → Concept → Behaviour → Simulation → Scenario → Reflection → Micro-Assessment, with the current stage highlighted. Stages cannot be skipped ahead. This is a state machine, not a navigation suggestion.

2. **Multilingual EN / DE / EL works on a real course, not just on UI chrome.**
   Switch language via the globe icon. The full workplace-conflict course — all narrative, scenario branches, feedback text, quick-check questions — renders natively in all three. No machine translation, no placeholder text. This is the i18n posture for every future course.

3. **Comp Cards are the spine, not a worksheet.**
   Walk a learner through the scenario. Open the Comp Card (footer of the completion screen). The scenario evidence is pulled into the card automatically. Privacy controls let the learner choose what the facilitator sees. Print-to-PDF works (Cmd/Ctrl+P → Save as PDF). Then switch role to Facilitator → open the demo learner — fields the learner restricted appear redacted in the facilitator view.

## Suggested 5-minute walkthrough

1. Open the demo link → choose "Learner".
2. Start the workplace-conflict mission. Click through the 7 stages.
3. In the scenario, pick "Wait for a quiet moment, then talk to Sam privately" → then "Tell Sam you'd like to be addressed directly from now on".
4. Complete reflection + quick-check.
5. Watch the badge unlock animation — note that there is no leaderboard.
6. Open the Comp Card. Edit one field. Print to PDF.
7. Switch language to DE or EL. Re-open the course player to confirm the full course is translated.
8. Switch role to Facilitator. Open the demo learner. Note the redacted fields.
9. Open the accessibility toolbar (top right). Try dyslexia font + high contrast.
10. Open Admin and Content roles for a peek at GDPR self-service and the CMS schema.

## What is intentionally placeholder

PCR v2.0 §1 draws the scope boundary clearly. In this demo, anything in the consortium's column is stubbed:

- **Course content**: One placeholder micro-course (workplace conflict). The real shell ships empty — the consortium authors the 4–6 micro-courses.
- **Brand identity**: A neutral on-trend palette. The real shell takes whatever brand kit the consortium agrees.
- **Authentication**: A role picker stands in for NextAuth.js + magic link.
- **Strapi CMS**: The content editor view shows the schema. The actual Strapi instance lands at handover.
- **Pilot data**: The facilitator cohort has 6 mock learners. Real cohorts arrive when partners onboard.

These are not gaps. They are the line between "platform" and "content" — the line that makes the v2.0 €38k price defensible.

## What changes between this demo and week-6 handover

| Demo (today) | Week-6 handover |
| --- | --- |
| One micro-course hardcoded in TypeScript | Empty CMS ready to receive any number of courses |
| localStorage for progress | PostgreSQL + Prisma for progress, Comp Cards, observations |
| Role picker | NextAuth.js + magic link, full RBAC, GDPR self-service |
| Print-to-PDF | Server-side PDF generation with consortium branding |
| Vercel preview deploy | EU-residency deploy on Hetzner + Coolify (or Vercel if preferred), staging + production |
| No real observability | Sentry + Better Uptime + Plausible |
| Quick translations by SENIC | Translation memory in the CMS, partner-owned localisation workflow |

## Decisions this demo is asking the consortium to make

Per PCR v2.0 §1, four decisions still block content authoring (not the platform build). The demo is designed to make them concrete by letting you feel the trade-offs:

1. **Gamification intensity** — the demo runs "light-but-visible." Click through the badge unlock. Tune up or down?
2. **Comp Card granularity** — the demo shows the hybrid model (one cluster-level card; per-course evidence pulled in). Confirm or adjust?
3. **Number of micro-courses in v1** — the demo ships one; the recommendation is 4–6. Confirm scope.
4. **Peer/mentor model** — the demo shows facilitator + admin but no peer surface yet. Confirm whether v1 includes peer touchpoints.

## Next step

Sign off on PCR v2.0 → SENIC starts week 1 (foundations) → weekly demo every Friday → handover at week 6.

— Created and Powered by SENIC · senic.world · scicevaliev@gmail.com

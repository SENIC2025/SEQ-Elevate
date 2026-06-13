# SEQ Elevate — Storybook

The component story of the SEQ Elevate platform: the design system, every UI primitive, and how the pieces compose into the learner / facilitator / admin / content-editor surfaces.

**Two ways to use this storybook:**

1. **This document** — the narrative reference: design tokens, component catalogue, usage rules, and the "why" behind each pattern.
2. **The live gallery** — run the app and visit `/en/dev/storybook`. Every component renders in the real theme, in every state, switchable across EN/DE/EL and the accessibility modes. This is the canonical visual reference because it can never drift from the actual code.

> **Why an in-app gallery instead of the Storybook npm tool?** The stack is bleeding-edge (Next.js 16, React 19, Tailwind v4). The standalone Storybook tool currently fights these versions and would add a fragile second build pipeline that breaks on upgrades. An in-app gallery renders the *actual* components in the *actual* app context (real theme tokens, real i18n, real accessibility providers), costs nothing to maintain, and upgrades for free with the app. See `BUILDLOG.md` Phase 1 for the full rationale.

---

## 1. Design tokens

All colours are CSS custom properties defined in `src/app/globals.css` and re-exposed to Tailwind via `@theme inline`. They are also driven per-project by `ProjectThemeProvider` (multi-tenancy), so swapping projects re-skins the whole UI.

### Palette (from seqelevate.eu)

| Token | Value | Role |
|---|---|---|
| `--primary` | `#cad12c` (lime) | Brand surface colour. Solid buttons, logo chip, active states. **Dark text on lime** (WCAG AAA). |
| `--primary-hover` | `#b6bc28` | Lime hover |
| `--primary-foreground` | `#2e2e3d` | Dark text on lime surfaces |
| `--accent` | `#7467ae` (purple) | Foreground/icon tints, labels, badges, action panels with white text |
| `--accent-hover` | `#5d528b` | Purple hover |
| `--tertiary` | `#b575ae` (rose) | Highlights, illustrations |
| `--warm-1..4` | `#f9a46b → #58429a` | Logo sunset gradient — celebratory surfaces (badge unlock) |
| `--cool-1..4` | `#5cc099 → #426fb6` | Logo aurora gradient — reserved |
| `--foreground` | `#2e2e3d` | Body text (cool-tinted dark) |
| `--muted-foreground` | `#4d4d66` | Secondary text |
| `--background` | `#fcfdf4` | Page background (warm off-white) |
| `--surface` | `#ffffff` | Card surface |
| `--surface-muted` | `#f6f6f7` | Muted panels |
| `--border` | `#e4e4e8` | Borders |
| `--success` `--warning` `--danger` | green/amber/red | Status |

**The cardinal rule**: lime (`--primary`) is a *surface* colour, never a text colour on white (it fails contrast). Purple (`--accent`) is the text/icon accent. This split is enforced throughout.

### Accessibility modes (set via `data-*` on `<html>`)

- `data-font-size="lg|xl"` → scales `--font-scale`
- `data-dyslexic="true"` → swaps to OpenDyslexic font stack
- `data-contrast="true"` → high-contrast palette (dark-olive primary, dark-purple accent, both ≥7:1)

### Type

`--font-sans`: Inter (latin + latin-ext + greek subsets, for EL). `--radius`: 0.75rem base.

---

## 2. UI primitives (`src/components/ui/`)

### Button — `button.tsx`
Variants: `primary` (lime, dark text), `accent` (purple, white text), `outline`, `ghost`, `danger`. Sizes: `sm`, `md`, `lg`, `icon`. CVA-based.

### Card — `card.tsx`
`Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`. The default surface container — white, bordered, subtle shadow.

### Progress — `progress.tsx`
Accessible progress bar (`role="progressbar"` + aria values). Optional label + percentage. Lime fill.

### Badge — `badge.tsx`
Variants: `default`, `primary` (lime tint), `accent` (purple tint), `success`, `muted`. Pill-shaped status labels.

### Textarea — `textarea.tsx`
Form textarea with focus ring, used in reflection + Comp Card + facilitator notes.

---

## 3. Composite components

| Component | File | Role |
|---|---|---|
| `AppHeader` | `components/AppHeader.tsx` | Sticky top bar: brand, role chip, switch-role, language switcher, a11y toolbar |
| `LanguageSwitcher` | `components/LanguageSwitcher.tsx` | EN/DE/EL locale switch (next-intl routing) |
| `AccessibilityToolbar` | `components/a11y/AccessibilityToolbar.tsx` | Font size / dyslexia / contrast controls |
| `StageBreadcrumb` | `components/course/StageBreadcrumb.tsx` | The 7-stage WP3 sequence indicator (the proof the pedagogy is enforced) |
| `CompCardPrint` | `components/comp-card/CompCardPrint.tsx` | Print-only Comp Card layout (→ PDF) |

## 4. Course player stages (`src/components/course/`)

The 7-stage state machine, each stage a component, orchestrated by `CoursePlayer.tsx`:

1. `NarrativeStage` (context / concept / behaviour modes)
2. `SimulationStage` (choose-response)
3. `ScenarioStage` (branching)
4. `ReflectionStage`
5. `AssessmentStage`
6. `CompletionStage` (badge unlock)

## 5. Role surfaces (`src/components/role/`)

`LandingPage`, `LearnerDashboard`, `FacilitatorWorkspace`, `AdminDashboard`, `ContentEditor`, `ContentLivePreview`.

---

## 6. State & data

- **`src/store/demo-state.tsx`** — client state (role, course progress, Comp Card). *Being migrated to DB-backed server state in Week 0 Day 3+.*
- **`src/data/course.ts`** — course structure (stages, options, quality tags). The seed of the Strapi schema.
- **`src/data/project.ts`** — project configs + brand kits. The seed of the `Project` DB table.

---

*This storybook is updated as components are added or changed. The live gallery at `/en/dev/storybook` is the source of visual truth.*

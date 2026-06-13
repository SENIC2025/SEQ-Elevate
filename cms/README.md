# SEQ Elevate CMS (Strapi)

The content authoring system for the SEQ Elevate platform. Partner content
editors author micro-courses, scenarios and Comp Card templates here; the
Next.js app reads published content via the REST API.

> **Architecture note.** The platform reads content through a swappable
> client (`../src/lib/cms/`). Strapi is the authoring backend, but the app
> never imports Strapi types directly — it consumes the source-agnostic
> `CourseContent` shape. This is the "hybrid, swappable" CMS decision
> (`../DECISIONS.md`): we can migrate to native-in-Postgres authoring later
> with zero app-code changes. Switch backends with `CMS_SOURCE=local|strapi`.

## Stack

- **Strapi 5.48** (TypeScript)
- **Local dev**: SQLite (zero-config)
- **Production**: PostgreSQL (set `DATABASE_CLIENT=postgres` + connection env)

## Content models

| Type | Kind | Localised | Notes |
|---|---|---|---|
| **Course** | collection | yes (EN/DE/EL) | Course metadata as native fields; the WP3 stage tree in a localized `content` JSON field matching `CourseStage[]` |
| **Comp Card Template** | single | yes | The fields a learner fills; configurable per project |

The `content` JSON field holds the nested stages (context → concept →
behaviour → simulation → scenario → reflection → assessment). It maps 1:1 to
the `CourseStage[]` type in `../src/lib/cms/types.ts`, so the app renders any
authored course generically.

## Run locally

```bash
cd cms
npm run develop      # http://localhost:1337/admin
```

First run: create the admin user. The German + Greek locales and public read
permissions are ensured automatically on boot (see `src/index.ts`).

## Point the app at Strapi

In the web app's `.env.local`:

```
CMS_SOURCE=strapi
STRAPI_URL=http://localhost:1337
```

Restart the web app. Content now comes from Strapi instead of bundled files.
Verify at `/en/dev/cms-check`.

## The worked example

Per the proposal, SENIC provides a worked example. The workplace-conflict
course exists as bundled content (`../src/lib/cms/local-provider.ts`). To seed
it into Strapi as the editable example, generate the import payload from the
local provider and create it via the admin or an import script (see
`../BUILDLOG.md` Phase 1 Day 4). Editors then duplicate it to author courses
2–6.

## Production (Hetzner)

Strapi runs as its own container alongside the Next.js app and shares the
Postgres instance (separate `strapi` database). Required env:

```
DATABASE_CLIENT=postgres
DATABASE_HOST=...
DATABASE_PORT=5432
DATABASE_NAME=strapi
DATABASE_USERNAME=...
DATABASE_PASSWORD=...
APP_KEYS=...            # generated
API_TOKEN_SALT=...
ADMIN_JWT_SECRET=...
JWT_SECRET=...
```

See `../deploy/` for the Docker + Coolify configuration.

---

_Strapi CLI: `npm run develop` (autoreload), `npm run start` (production),
`npm run build` (admin panel), `npm run strapi` (CLI)._

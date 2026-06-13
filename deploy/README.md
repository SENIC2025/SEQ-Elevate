# SEQ Elevate — Deployment Runbook

How to stand up SEQ Elevate on Hetzner Cloud. Written so the deploy is a
single guided pass once the credentials below exist. Target staging URL:
**`staging.seq-elevate.senic.world`** (`DECISIONS.md` D3).

## 0. Credentials needed (the only blockers)

| Item | Where | Needed for |
|---|---|---|
| Hetzner Cloud account + API token | console.hetzner.cloud | The server |
| DNS access to `senic.world` | wherever senic.world is registered | The staging subdomain |
| Resend API key + verified `senic.world` sender | resend.com | Magic-link email delivery |
| Sentry DSN | sentry.io (free tier) | Error monitoring |
| Plausible (cloud or self-hosted) | plausible.io | Analytics |
| Better Uptime account | betterstack.com | Uptime monitoring |

Everything else is automated by the config in this repo.

## 1. Provision the server

- Hetzner Cloud → new project "SEQ Elevate" → new server:
  - **CX22** (2 vCPU, 4 GB) — comfortable for web + Strapi + Postgres at pilot scale
  - Location: Falkenstein or Nuremberg (EU/Germany — GDPR residency, D1)
  - Image: Ubuntu 24.04
  - Add your SSH key
- Note the public IP.

## 2. DNS

Point the staging hostname at the server:

```
staging.seq-elevate   A   <server-ip>
```

(Add `cms.staging.seq-elevate` too if exposing the Strapi admin on its own host.)

## 3. Install Coolify (reverse proxy + Let's Encrypt + deploys)

SSH in and:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Coolify gives us automatic TLS (Let's Encrypt), a deploy UI, and
GitHub-push deploys. Open `http://<server-ip>:8000`, create the admin user.

## 4. Deploy the stack

In Coolify:
1. New Project → connect the GitHub repo (SENIC org).
2. Add a **Docker Compose** resource pointing at `deploy/docker-compose.prod.yml`.
3. Set the environment variables (section 6).
4. Set the domain to `staging.seq-elevate.senic.world` → web service port 3000.
5. Deploy. Coolify builds the images, provisions SSL, starts the stack.

> Running without Coolify? `cd deploy && docker compose --env-file .env -f docker-compose.prod.yml up -d --build`, then put Caddy/Traefik in front for TLS.

## 5. Database migrations

Migrations run as a deploy step (never auto-run by container replicas):

```bash
# One-off, from CI or locally against the prod DB:
DATABASE_URL="<prod-url>" pnpm prisma migrate deploy
DATABASE_URL="<prod-url>" pnpm db:seed     # first deploy only — seeds project + course
```

## 6. Environment variables

Create `deploy/.env` (never commit). Generate secrets with `openssl rand -base64 32`.

```bash
# Postgres
POSTGRES_USER=seqelevate
POSTGRES_PASSWORD=<generate>
POSTGRES_DB=seqelevate
STRAPI_DB_NAME=strapi

# Web app
WEB_DATABASE_URL=postgresql://seqelevate:<pw>@postgres:5432/seqelevate?schema=public
AUTH_SECRET=<generate>
AUTH_URL=https://staging.seq-elevate.senic.world
RESEND_API_KEY=re_<real>
EMAIL_FROM=SEQ Elevate <no-reply@senic.world>
CMS_SOURCE=strapi
STRAPI_INTERNAL_URL=http://cms:1337
STRAPI_API_TOKEN=<from Strapi admin → Settings → API Tokens>
PLAUSIBLE_DOMAIN=staging.seq-elevate.senic.world
SENTRY_DSN=<from sentry>

# Strapi
STRAPI_APP_KEYS=<generate>,<generate>
STRAPI_API_TOKEN_SALT=<generate>
STRAPI_ADMIN_JWT_SECRET=<generate>
STRAPI_TRANSFER_TOKEN_SALT=<generate>
STRAPI_JWT_SECRET=<generate>
```

## 7. Post-deploy setup

1. **Strapi admin**: visit `https://<cms-host>/admin`, create admin user, generate an API token, put it in `STRAPI_API_TOKEN`, redeploy web. Import the worked-example course (`cms/README.md`).
2. **Resend**: verify the `senic.world` sender domain (DNS records), confirm a real magic link arrives.
3. **Better Uptime**: add an HTTP monitor on the staging URL.
4. **Sentry**: confirm an event arrives (trigger a test error).

## 8. Smoke test (acceptance dry-run)

- [ ] `https://staging.seq-elevate.senic.world/en` loads, TLS valid
- [ ] Sign in via magic link (real email) → lands authenticated
- [ ] Switch EN/DE/EL — course content translates
- [ ] Complete the workplace-conflict course → badge unlocks → Comp Card
- [ ] Facilitator view shows the cohort + redacted Comp Card fields
- [ ] Admin GDPR self-service + audit log render
- [ ] Content Editor → CMS reachable
- [ ] Lighthouse mobile ≥ 90 (Performance, Accessibility, Best Practices, SEO)
- [ ] `/en/dev/storybook` + `/en/dev/cms-check` render (dev reference)

## 9. Backups (5-year obligation)

Coolify schedules daily Postgres backups (retain 30 days, D1/financial proposal).
Verify the first backup runs and a restore works before go-live.

# Database backups — daily, 30-day retention

Fulfils the maintenance-package commitment **"automated database backups, daily,
retained 30 days"** (Contract Item 2 §7). Implemented as
[`.github/workflows/db-backup.yml`](.github/workflows/db-backup.yml).

## Two layers (defence in depth)

1. **Neon point-in-time recovery** — continuous, provider-managed. On the **Launch**
   plan this covers ~**7 days** and can restore to any second. Great for "undo a
   bad delete an hour ago," but it lives inside the same Neon account.
2. **This off-site daily dump** — a `pg_dump` copied to an **S3-compatible,
   EU-region** bucket **you** control, kept **30 days**. Protects against
   account-level problems and satisfies the contractual 30-day retention. This is
   the layer the contract's §7 refers to.

## How it runs

- **Schedule:** every day at **02:30 UTC** (GitHub Actions cron).
- **On demand:** Actions → *DB backup* → **Run workflow** (for testing or an ad-hoc backup).
- Each run: `pg_dump` (custom, compressed) → upload `seq-elevate-db-<UTC timestamp>.dump` to `s3://<bucket>/db/` → delete any dump older than 30 days.
- Until the secrets below are set the job is a **visible no-op** (a warning in the log), never a silent failure.

## One-time setup

**1. Create a private, EU-region, S3-compatible bucket.** Any of these work (all EU, all encrypt at rest):
- **Hetzner Object Storage** (Germany) — matches the contract's original provider intent.
- **Cloudflare R2** (EU jurisdiction), **Scaleway** (Paris), or **AWS S3 `eu-central-1`** (Frankfurt).

Make it **private** (never public — it holds learner PII) and confirm **server-side encryption** is on (default on all the above).

**2. Add repo secrets** — GitHub → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `BACKUP_DATABASE_URL` | Neon **direct** (non-pooler) connection string |
| `BACKUP_S3_BUCKET` | bucket name |
| `BACKUP_S3_ENDPOINT` | S3 endpoint URL, e.g. `https://fsn1.your-objectstorage.com` (Hetzner) |
| `BACKUP_S3_REGION` | region, e.g. `eu-central-1` |
| `AWS_ACCESS_KEY_ID` | bucket access key |
| `AWS_SECRET_ACCESS_KEY` | bucket secret key |

**3. Test it** — run the workflow manually (*Run workflow*) and confirm a dump appears in the bucket.

## Restore

Restore into a **fresh** database (a new Neon branch, or local) and verify before pointing production at it — never restore straight over live data.

```bash
# 1. Download a dump
aws s3 cp "s3://<bucket>/db/seq-elevate-db-<timestamp>.dump" ./restore.dump \
  --endpoint-url "<endpoint>"

# 2. Restore into a target database
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname "<TARGET_DATABASE_URL>" ./restore.dump
```

## Good practice
- **Test-restore quarterly** — a backup you've never restored isn't a backup. Restore the latest dump into a throwaway Neon branch and spot-check a few rows.
- Keep the bucket credentials **write-only** where the provider supports it (the workflow only needs put/list/delete on the `db/` prefix).
- Optional hardening: `gpg`-encrypt the dump before upload for an extra at-rest layer beyond the bucket's SSE (adds a passphrase secret + a decrypt step on restore).

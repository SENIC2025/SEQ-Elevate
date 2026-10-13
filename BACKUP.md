# Database backups — daily, 30-day retention

Fulfils the maintenance-package commitment **"automated database backups, daily,
retained 30 days"** (Contract Item 2 §7). Implemented as
[`.github/workflows/db-backup.yml`](.github/workflows/db-backup.yml), with its steps in
[`scripts/db-backup.sh`](scripts/db-backup.sh), proven end to end by
[`db-backup-selftest.yml`](.github/workflows/db-backup-selftest.yml).

## Two layers

1. **Neon point-in-time restore** — continuous, to any second, inside Neon. The
   history window is **1 day by default** on the Launch plan; set it to **7 days**
   (Setup, step B1). It lives inside the same Neon account.
2. **This off-site daily dump** — a `pg_dump` copied to a private, EU bucket **you**
   control, kept **30 days**. Protects against losing the Neon project or account,
   and is the layer the contract's §7 refers to.

## What each nightly run does (02:30 UTC; or Actions → *DB backup* → **Run workflow**)

1. Checks the settings, and **refuses a database login that can change anything** — so
   the owner's credentials never sit in GitHub by mistake (the backup uses a read-only role).
2. Dumps the database with the `pg_dump` matching the server's PostgreSQL version.
   Sign-in session and sign-in-link token rows are left out (useless for recovery,
   harmful if a dump leaked).
3. Verifies the dump: size, number of tables, every data block readable.
4. Optionally encrypts it on the runner (Setup, part D).
5. Uploads it, reads the stored copy back and compares it byte for byte (SHA-256).
6. Deletes dumps older than 30 days — but always keeps the newest 7, so a run of
   failed nights never empties the bucket.

Until the six secrets are set a run is a **visible no-op** (a warning, "NO BACKUP
TAKEN"); with only some set, it fails and names the missing ones. The repository is
public, so anyone can read run logs: they show sizes, counts and the PostgreSQL
version, never a secret, host or password.

## One-time setup (about an hour)

Never send a password, key or connection string by email, chat or ticket — paste them
only where these steps say. Keep them in a password manager.

### A. Storage — Scaleway Object Storage, Paris (recommended)

Why Scaleway: an EU company (Paris), encryption at rest, keys limited to one project by
clicking only, about €0.03 a month at this size. Hetzner (Germany) also works but
doesn't encrypt at rest, so turn on part D with it. Cloudflare R2, Backblaze B2 and AWS
are US companies — fine technically, but ask the consortium's DPO first (US CLOUD Act
reaches data in any location).

1. Sign up at scaleway.com with an organisation address. In the console's **Settings →
   Organization contracts**, download the **Data Processing Agreement** for the GDPR file.
2. **Organization Dashboard → Projects → + Create Project**: name it `seq-elevate-backups`.
   Keep that project selected for steps 3–6.
3. **Object Storage → + Create bucket**: region **Paris**; name
   `seq-elevate-db-backups-` plus 6 random lowercase letters or digits (write it down);
   **Private**; tick **Enable bucket encryption** and choose **SSE-ONE** (now — files
   uploaded before encryption is on stay unencrypted). Leave **versioning** and
   **object lock** off (either would stop the 30-day clean-up from really deleting).
4. **IAM & API keys → Applications → Create application**: `github-db-backup`, no policy yet.
5. **IAM → Policies → Create policy**: name `github-db-backup-objects`, principal the
   application `github-db-backup`; permission sets **ObjectStorageObjectsRead**,
   **ObjectStorageObjectsWrite**, **ObjectStorageObjectsDelete** only; scope **Specific
   projects → seq-elevate-backups**. Create it.
6. Do this right before part C (the secret key is shown once): **IAM & API keys → API
   keys → + Generate API key**; bearer: the application `github-db-backup`; expiration
   **1 year** (set a reminder for 11 months) or **Never**; at the Object Storage question
   choose **Yes, set up preferred Project → seq-elevate-backups**. Keep the window open.

Other providers: Hetzner `https://fsn1.your-objectstorage.com` + region `fsn1`;
Cloudflare R2 (EU jurisdiction) `https://<account id>.eu.r2.cloudflarestorage.com` + `auto`;
AWS Frankfurt `https://s3.eu-central-1.amazonaws.com` + `eu-central-1`.

### B. Neon — a longer restore window and a read-only login

1. Project → **Settings → Postgres** (history window): set **7 days**, save (pennies).
2. **SQL Editor** on the **production** branch and the app's database. Open
   [`scripts/db-backup-role.sql`](scripts/db-backup-role.sql): run **CHECK 1**, note
   `db_name` and `table_owner`.
3. In the password manager, generate a 32-character password, **letters and digits only**.
4. Paste the **CREATE** block, replace `PASTE_PASSWORD_HERE`, `DB_NAME` and
   `OWNER_ROLE`, run it. Then run **CHECK 2**: `writable` must be **0**, `is_admin`
   **false**, `readable` equal to `tables`.
5. **Connect** → production branch → turn **Connection pooling off** → copy the string.
   In a password-manager note, replace the `user:password` part (between `//` and `@`)
   with `backup_reader:` + the password from step 3. It must start
   `postgresql://backup_reader:`, have no `-pooler` in the host, and end
   `?sslmode=require&channel_binding=require`. This is `BACKUP_DATABASE_URL`. (The
   backup refuses to run with any login that can change the database.)

### C. The six GitHub secrets

You need the SENIC2025 GitHub login, or an account invited as a collaborator on the
repository. Open **github.com/SENIC2025/SEQ-Elevate → Settings → Secrets and variables →
Actions → Secrets → New repository secret**, once per name:

| Secret | Value (Scaleway Paris) |
|---|---|
| `BACKUP_DATABASE_URL` | the string from B5 |
| `BACKUP_S3_BUCKET` | the bucket name from A3 (name only) |
| `BACKUP_S3_ENDPOINT` | `https://s3.fr-par.scw.cloud` |
| `BACKUP_S3_REGION` | `fr-par` |
| `AWS_ACCESS_KEY_ID` | the access key from A6 |
| `AWS_SECRET_ACCESS_KEY` | the secret key from A6 |

Or in a terminal with GitHub CLI (`gh auth login` first) — each command asks for the
value and hides it; never use `--body` (it lands in your shell history):

```bash
for s in BACKUP_DATABASE_URL BACKUP_S3_BUCKET BACKUP_S3_ENDPOINT BACKUP_S3_REGION AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do gh secret set "$s" --app actions --repo SENIC2025/SEQ-Elevate; done
```

Then close the Scaleway key window.

### D. Optional, recommended: your own encryption key

Encrypts every dump before it leaves GitHub; only the private key's holders can read
backups — not GitHub, not the storage provider, not anyone holding the bucket key.

1. On a trusted computer: `brew install age` (Mac) or `winget install --id FiloSottile.age`
   (Windows; not Chocolatey). Open a new terminal.
2. `age-keygen -pq -o seq-elevate-backup-key.txt` — it prints `Public key: age1pq1…`.
3. Keep the key file in the password manager **and** a second offline copy elsewhere
   (an encrypted USB stick or a printout in a safe). **Lose every copy and every
   encrypted backup is unreadable.** Never put it in GitHub, email or chat.
4. GitHub → **Settings → Secrets and variables → Actions → Variables → New repository
   variable**: `BACKUP_AGE_RECIPIENT` = the `age1pq1…` public key (a second key holder's
   public key may follow, separated by a space).
5. After the next run, test-decrypt the newest dump on your machine (Restore, R4–R6).

### E. Optional: an alarm if a night is missed

1. At healthchecks.io create a check: **Cron Expression** `30 2 * * *`, **Server's Time
   Zone** UTC, **Grace Time** 3 hours. Save its ping URL as a sixth-plus-one secret,
   `BACKUP_HEALTHCHECK_URL`.
2. Signed in as SENIC2025: **Settings → Notifications → System → Actions** → **Email**,
   tick **Only notify for failed workflows**, **Save**.
3. GitHub switches off scheduled workflows in a public repository after 60 days without
   activity. Every 50 days (especially in the passive phase), open **Actions → DB backup**
   and check the last run is under a day old; if it was switched off, re-enable it
   **signed in as SENIC2025** (whoever re-enables it receives the failure emails).

### F. First run

**Actions → DB backup (daily, 30-day retention) → Run workflow** (branch `main`). Green,
with **Backup OK** in the run summary, means it worked. A red run's first error line
names the setting to fix; it never shows a secret.

## Restore

Recent mistakes inside Neon's history window: use **Neon's point-in-time restore** (to
the second). Anything older, or a lost Neon project: use these dumps. **Never restore
over live production** — restore into a new Neon branch or project, check, then decide.

You need: AWS CLI v2, `jq`, Docker (for a matching PostgreSQL client), `age` if the
object ends in `.age` (and a private key holder), and a key to read the bucket. For
restores, create a second Scaleway application `backup-restore-reader` with only
**ObjectStorageObjectsRead** on `seq-elevate-backups` and generate a 1-hour key for it
(the nightly key can also delete).

```bash
# R1. Credentials (typed, not echoed) and the bucket
read -r AWS_ACCESS_KEY_ID; read -rs AWS_SECRET_ACCESS_KEY; export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION=fr-par AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED
EP=https://s3.fr-par.scw.cloud; B=<bucket name>

# R2. Pick a dump
aws s3api list-objects-v2 --endpoint-url "$EP" --bucket "$B" --prefix db/ --query 'Contents[].[LastModified,Size,Key]' --output table
K=db/seq-elevate-db-<YYYY-MM-DD-HHMMSS>.dump.age   # or .dump without encryption

# R3. Download it with its metadata (sha256, pg-major, encryption)
aws s3api get-object --endpoint-url "$EP" --bucket "$B" --key "$K" restore.download > meta.json

# R4. Check it is intact — must print "restore.download: OK"
echo "$(jq -r .Metadata.sha256 meta.json)  restore.download" | shasum -a 256 -c -

# R5. Decrypt (age only; on the key holder's machine) — or: mv restore.download restore.dump
age -d -i /path/to/seq-elevate-backup-key.txt -o restore.dump restore.download

# R6. Check the archive with the matching client
PGMAJ=$(jq -r '.Metadata["pg-major"]' meta.json)
docker run --rm -v "$PWD":/w -w /w postgres:$PGMAJ pg_restore --list restore.dump > /dev/null && echo "archive OK"

# R7–R8. Into a NEW Neon branch or project (its direct owner string, pooling off)
read -rs TARGET_URL; export TARGET_URL
docker run --rm -e TARGET_URL -v "$PWD":/w -w /w postgres:$PGMAJ \
  sh -c 'pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname "$TARGET_URL" restore.dump'
```

R9. In the target's SQL Editor compare `SELECT count(*)` of `_prisma_migrations`, `"User"`
and `"CourseEnrollment"` with production. `"Session"` and `"VerificationToken"` are empty
by design: everyone signs in again, and pending invitations must be resent.

R10. Cut-over (a disaster only, decided with the team): point `DATABASE_URL` and
`DIRECT_URL` in Vercel at the restored database; record the incident; **re-apply every
GDPR erasure or correction processed after the dump's date**; rotate the `backup_reader`
password if the old project still exists.

R11. Delete `restore.download`, `restore.dump` and `meta.json`, and the drill branch.

## Good practice

- **Test-restore quarterly** (R1–R9 into a branch) and record the date. Setting the repo
  variable `BACKUP_TEST_RESTORE` to `true` also makes every nightly run restore the dump
  into a throwaway database on the runner.
- After the first green run, set the repo variable `BACKUP_MIN_DUMP_BYTES` to about half
  the first dump's size, so a suspiciously small dump fails the run.
- Rotate the Scaleway key yearly and the `backup_reader` password when people leave
  (`ALTER ROLE backup_reader WITH PASSWORD '…'`, then update `BACKUP_DATABASE_URL`).
- Everyone with write access to the repository can change these secrets, including
  where dumps are sent: keep the collaborator list short.

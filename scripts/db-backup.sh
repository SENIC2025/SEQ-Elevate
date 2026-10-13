#!/usr/bin/env bash
# Off-site database backup, one phase per call (BACKUP.md):
#
#   db-backup.sh validate      check settings; refuse a writable role; install the
#                              pg_dump matching the server's major version
#   db-backup.sh dump          pg_dump (custom format), 3 attempts
#   db-backup.sh verify        size, table count, every data block readable
#   db-backup.sh test-restore  restore into a throwaway local PostgreSQL
#   db-backup.sh install-age   pinned age binary, checked by SHA-256
#   db-backup.sh encrypt       age to BACKUP_AGE_RECIPIENT, or warn that it's off
#   db-backup.sh upload        single PUT, read back and compare SHA-256
#   db-backup.sh prune         delete dumps older than RETENTION_DAYS, keep KEEP_MIN
#
# Run by .github/workflows/db-backup.yml (nightly) and db-backup-selftest.yml
# (a throwaway database and bucket). Phases hand values on through $GITHUB_ENV
# (PG_MAJOR, FILE, ENCRYPTION). Nothing here prints a secret: the workflow masks
# the secrets, and the database host is masked below.

set -euo pipefail

fail() { echo "::error::$*"; exit 1; }
note() { echo "$*"; }
summary() { [ -z "${GITHUB_STEP_SUMMARY:-}" ] || printf '%s\n' "$@" >> "$GITHUB_STEP_SUMMARY"; }
setenv() { [ -z "${GITHUB_ENV:-}" ] || echo "$1=$2" >> "$GITHUB_ENV"; export "$1=$2"; }
tmp() { echo "${RUNNER_TEMP:-/tmp}/$1"; }

PREFIX="${PREFIX:-db}"
KEEP_MIN="${KEEP_MIN:-7}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
PG_BIN() { echo "/usr/lib/postgresql/${PG_MAJOR:?PG_MAJOR not set (run validate first)}/bin"; }

# --------------------------------------------------------------------------
validate() {
  : "${DATABASE_URL:?}" "${BUCKET:?}" "${ENDPOINT:?}" "${REGION:?}"

  # Neon connection string.
  case "$DATABASE_URL" in postgres://*|postgresql://*) ;; *) fail "BACKUP_DATABASE_URL must be the bare postgresql://... string (not a psql command)";; esac
  local rest="${DATABASE_URL#*://}"; rest="${rest#*@}"
  local db_host="${rest%%[/:?]*}"
  echo "::add-mask::$db_host"
  case "$db_host" in *-pooler.*) fail "BACKUP_DATABASE_URL is Neon's POOLED string (host contains -pooler). Use the direct one (Connection pooling off).";; esac
  case "$DATABASE_URL" in *sslmode=*) ;; *) fail "BACKUP_DATABASE_URL must end with ?sslmode=require&channel_binding=require";; esac
  case "$db_host" in
    localhost|127.0.0.1) ;;
    *) case "$DATABASE_URL" in *channel_binding=require*) ;; *) echo "::warning::BACKUP_DATABASE_URL has no channel_binding=require";; esac;;
  esac

  # Bucket settings.
  case "$BUCKET" in ''|*[!a-z0-9-]*) fail "BACKUP_S3_BUCKET must be the bare bucket name (lowercase letters, digits, hyphens; no s3://, no dots)";; esac
  local ep_host
  case "$ENDPOINT" in
    https://*) ep_host="${ENDPOINT#https://}";;
    http://localhost:*|http://127.0.0.1:*) ep_host="${ENDPOINT#http://}";;  # the self-test's local store only
    *) fail "BACKUP_S3_ENDPOINT must start with https://";;
  esac
  ep_host="${ep_host%/}"
  case "$ep_host" in */*) fail "BACKUP_S3_ENDPOINT must not contain a path or the bucket name";; esac
  case "$ep_host" in
    s3.*.scw.cloud)
      local ep_region="${ep_host#s3.}"; ep_region="${ep_region%.scw.cloud}"
      [ "$REGION" = "$ep_region" ] || fail "BACKUP_S3_REGION does not match the region in BACKUP_S3_ENDPOINT (Scaleway Paris: endpoint https://s3.fr-par.scw.cloud, region fr-par)";;
  esac
  case "$RETENTION_DAYS$KEEP_MIN" in *[!0-9]*) fail "RETENTION_DAYS and KEEP_MIN must be whole numbers";; esac

  # The server's major version (psql through pg_wrapper is the newest client:
  # fine for one query). pg_dump is then called by absolute path: a bare
  # pg_dump goes through pg_wrapper, which picks the runner's local 16/main
  # cluster's version, and pg_dump refuses a newer server.
  local server_num
  server_num="$(psql "$DATABASE_URL" -XAtqc 'SHOW server_version_num')" \
    || fail "Cannot connect with BACKUP_DATABASE_URL (check the role, password and host)"
  case "$server_num" in ''|*[!0-9]*) fail "Unexpected server_version_num from the database";; esac

  # Least privilege: the backup reads with a role that can't change anything.
  # The owner's credentials (Neon: a neon_superuser member) are refused, so
  # a full read/write production login never sits in GitHub by mistake.
  local writable
  writable="$(psql "$DATABASE_URL" -XAtqc "
    SELECT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls)::int
         + (SELECT count(*) FROM pg_roles s
             WHERE s.rolname = 'neon_superuser' AND pg_has_role(current_user, s.oid, 'MEMBER'))::int
         + (SELECT count(*) FROM pg_tables t
             WHERE t.schemaname = 'public'
               AND has_table_privilege(format('%I.%I', t.schemaname, t.tablename),
                                       'INSERT, UPDATE, DELETE, TRUNCATE'))::int
         + has_schema_privilege('public', 'CREATE')::int
      FROM pg_roles r WHERE r.rolname = current_user")" \
    || fail "Could not check the backup role's privileges"
  [ "$writable" = "0" ] || fail "BACKUP_DATABASE_URL uses a role that can change the database (an owner or admin role). Use the read-only backup role (BACKUP.md, 'Read-only database role')."

  local major=$(( server_num / 10000 ))
  note "Database server is PostgreSQL major $major; the backup role is read-only."
  if [ ! -x "/usr/lib/postgresql/$major/bin/pg_dump" ]; then
    sudo rm -f /etc/apt/sources.list.d/pgdg.list /etc/apt/sources.list.d/pgdg.sources
    sudo install -d /usr/share/postgresql-common/pgdg
    sudo curl -fsSL --retry 3 -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
    # shellcheck disable=SC1091
    . /etc/os-release
    printf '%s\n' 'Types: deb' 'URIs: https://apt.postgresql.org/pub/repos/apt' "Suites: ${VERSION_CODENAME}-pgdg" 'Components: main' \
      'Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc' | sudo tee /etc/apt/sources.list.d/pgdg.sources > /dev/null
    sudo apt-get -o Acquire::Retries=3 update -qq
    sudo apt-get install -y -qq --no-install-recommends "postgresql-client-$major"
  fi
  "/usr/lib/postgresql/$major/bin/pg_dump" --version
  setenv PG_MAJOR "$major"
}

# --------------------------------------------------------------------------
dump() {
  : "${DATABASE_URL:?}"
  local file
  file="seq-elevate-db-$(date -u +%Y-%m-%d-%H%M%S).dump"
  # Session and VerificationToken rows are live sign-in and magic-link tokens:
  # useless for recovery, harmful if a dump leaks. Their definitions stay.
  local attempt
  for attempt in 1 2 3; do
    if "$(PG_BIN)/pg_dump" "$DATABASE_URL" --format=custom --no-owner --no-privileges \
         --lock-wait-timeout=120000 \
         --exclude-table-data='public."Session"' --exclude-table-data='public."VerificationToken"' \
         --file="$file"; then
      break
    fi
    [ "$attempt" -lt 3 ] || fail "pg_dump failed 3 times"
    note "pg_dump attempt $attempt failed; retrying in $((attempt * 30)) s"
    sleep $((attempt * 30))
  done
  ls -l "$file"
  setenv FILE "$file"
}

# --------------------------------------------------------------------------
verify() {
  : "${FILE:?}"
  local min_bytes="${MIN_DUMP_BYTES:-10240}" min_tables="${MIN_TABLES:-20}"
  local size tables toc
  toc="$(tmp toc.txt)"
  size="$(stat -c%s "$FILE")"
  "$(PG_BIN)/pg_restore" --list "$FILE" > "$toc"
  tables="$(grep -c ' TABLE DATA ' "$toc" || true)"
  note "Dump: $size bytes, $tables TABLE DATA entries"
  [ "$size" -ge "$min_bytes" ] || fail "Dump is only $size bytes (minimum $min_bytes)"
  [ "$tables" -ge "$min_tables" ] || fail "Only $tables tables with data in the dump (minimum $min_tables)"
  grep -qE ' TABLE DATA public _prisma_migrations( |$)' "$toc" || fail "_prisma_migrations data missing from the dump"
  # --list reads only the table of contents; this reads and decompresses every data block.
  "$(PG_BIN)/pg_restore" --file=/dev/null "$FILE"
  note "Dump verified: $size bytes, $tables tables with data, every data block readable."
}

# --------------------------------------------------------------------------
test_restore() {
  : "${FILE:?}"
  if [ ! -x "$(PG_BIN)/postgres" ]; then
    sudo apt-get install -y -qq --no-install-recommends "postgresql-${PG_MAJOR}"
  fi
  # No DATABASE_URL in here: nothing in this phase can reach production.
  DUMP_PATH="$PWD/$FILE" PG_MAJOR="$PG_MAJOR" env -u DATABASE_URL \
    pg_virtualenv -v "$PG_MAJOR" bash -euo pipefail -c '
      B="/usr/lib/postgresql/$PG_MAJOR/bin"
      "$B/createdb" restore_check
      "$B/pg_restore" --exit-on-error --no-owner --no-privileges -d restore_check "$DUMP_PATH"
      echo "Test restore OK: $("$B/psql" -XAtq -d restore_check -c "SELECT count(*) FROM _prisma_migrations") migrations restored"
    '
}

# --------------------------------------------------------------------------
AGE_VERSION=v1.3.2
AGE_SHA256=cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10
install_age() {
  local tgz
  tgz="$(tmp age.tar.gz)"
  curl -fsSL --retry 3 -o "$tgz" "https://github.com/FiloSottile/age/releases/download/${AGE_VERSION}/age-${AGE_VERSION}-linux-amd64.tar.gz"
  echo "${AGE_SHA256}  $tgz" | sha256sum -c -
  tar -xzf "$tgz" -C "$(tmp '')"
  sudo install -m 0755 "$(tmp age/age)" /usr/local/bin/age
  sudo install -m 0755 "$(tmp age/age-keygen)" /usr/local/bin/age-keygen
  age --version
}

# --------------------------------------------------------------------------
encrypt() {
  : "${FILE:?}"
  if [ -z "${AGE_RECIPIENTS:-}" ]; then
    setenv ENCRYPTION none
    echo "::warning::Client-side encryption is OFF (repo variable BACKUP_AGE_RECIPIENT is not set); relying on the bucket's server-side encryption."
    return 0
  fi
  local recipients
  recipients="$(tmp recipients.txt)"
  # Recipients may be separated by spaces, commas or new lines; age ignores blank lines.
  printf '%s\n' "$AGE_RECIPIENTS" | tr ', \t\r' '\n\n\n\n' > "$recipients"
  # Fail closed: if age fails, nothing is uploaded.
  age -R "$recipients" -o "${FILE}.age" "$FILE"
  [ "$(head -c 21 "${FILE}.age")" = "age-encryption.org/v1" ] || fail "Encrypted file lacks the age header"
  [ "$(stat -c%s "${FILE}.age")" -gt "$(stat -c%s "$FILE")" ] || fail "Encrypted file is not larger than the plain dump"
  rm -f "$FILE"
  setenv FILE "${FILE}.age"
  setenv ENCRYPTION age
  note "Encrypted to $(grep -c . "$recipients") age recipient(s)."
}

# --------------------------------------------------------------------------
upload() {
  : "${FILE:?}" "${BUCKET:?}" "${ENDPOINT:?}"
  local key="${PREFIX}/${FILE}" size sha rt_sha sse got meta
  size="$(stat -c%s "$FILE")"
  sha="$(sha256sum "$FILE" | cut -d' ' -f1)"
  # A single PUT (fine up to 5 GB): no multipart, no default-checksum surprises.
  aws s3api put-object --endpoint-url "$ENDPOINT" --bucket "$BUCKET" --key "$key" --body "$FILE" \
    --metadata "sha256=${sha},pg-major=${PG_MAJOR},encryption=${ENCRYPTION:-none}" > /dev/null
  # Integrity of the stored copy: read it back and compare.
  got="$(tmp roundtrip.bin)"; meta="$(tmp get.json)"
  aws s3api get-object --endpoint-url "$ENDPOINT" --bucket "$BUCKET" --key "$key" "$got" > "$meta"
  rt_sha="$(sha256sum "$got" | cut -d' ' -f1)"
  rm -f "$got"
  [ "$rt_sha" = "$sha" ] || fail "Stored object differs from the local file (SHA-256 mismatch)"
  sse="$(jq -r '.ServerSideEncryption // empty' "$meta")"
  note "Uploaded and verified $key: $size bytes, sha256 $sha, client-side=${ENCRYPTION:-none}, server-side=${sse:-not reported}"
  if [ "${ENCRYPTION:-none}" = "none" ] && [ -z "$sse" ]; then
    echo "::warning::The bucket did not report server-side encryption for this object, and age encryption is off. Check the bucket's encryption setting."
  fi
  summary "### Backup OK" \
    "- Object: $key ($size bytes)" \
    "- SHA-256: $sha (stored copy downloaded again and matched)" \
    "- PostgreSQL major: $PG_MAJOR; client-side encryption: ${ENCRYPTION:-none}; server-side: ${sse:-not reported}"
}

# --------------------------------------------------------------------------
prune() {
  : "${BUCKET:?}" "${ENDPOINT:?}"
  local cutoff objects old
  cutoff="$(date -u -d "${RETENTION_DAYS} days ago" +%Y-%m-%dT%H:%M:%S)"
  objects="$(tmp objects.json)"; old="$(tmp old.txt)"
  aws s3api list-objects-v2 --endpoint-url "$ENDPOINT" --bucket "$BUCKET" --prefix "${PREFIX}/seq-elevate-db-" \
    --output json --query 'Contents[].{k: Key, t: LastModified}' > "$objects"
  jq -r --arg c "$cutoff" --argjson keep "$KEEP_MIN" \
    '(. // []) | sort_by(.t) | reverse | .[$keep:] | map(select(.t < $c)) | .[].k' "$objects" > "$old"
  note "Objects: $(jq '(. // []) | length' "$objects"); to prune: $(grep -c . "$old" || true); cutoff $cutoff UTC; newest $KEEP_MIN always kept"
  # One DeleteObject per key (DeleteObjects needs checksums some stores reject).
  local key
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    note "  pruning $key"
    aws s3api delete-object --endpoint-url "$ENDPOINT" --bucket "$BUCKET" --key "$key" > /dev/null
  done < "$old"
}

case "${1:-}" in
  validate) validate ;;
  dump) dump ;;
  verify) verify ;;
  test-restore) test_restore ;;
  install-age) install_age ;;
  encrypt) encrypt ;;
  upload) upload ;;
  prune) prune ;;
  *) echo "usage: $0 validate|dump|verify|test-restore|install-age|encrypt|upload|prune" >&2; exit 2 ;;
esac

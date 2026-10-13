-- Read-only database role for the nightly backup (BACKUP.md, "Read-only database role").
--
-- Run in the Neon Console's SQL Editor on the production branch and the app's
-- database. Create the role with SQL only, not under Console -> Roles: Neon
-- makes every role created there a member of neon_superuser (full read/write).
--
-- Replace the three placeholders first:
--   PASTE_PASSWORD_HERE  32 random letters and digits from your password manager
--   DB_NAME              the database (usually neondb), from CHECK 1 below
--   OWNER_ROLE           the role that owns the tables (usually neondb_owner),
--                        from CHECK 1 below; it is the role the app migrates with
--
-- The nightly backup refuses to run with a role that can change anything, so
-- the owner's credentials never end up in GitHub by mistake.

-- CHECK 1 (changes nothing): note db_name and table_owner; expect one owner and
-- the schema "public" only.
SELECT current_database()                                            AS db_name,
       split_part(version(), ' ', 2)                                 AS pg_version,
       (SELECT string_agg(DISTINCT tableowner, ', ')
          FROM pg_tables WHERE schemaname = 'public')                AS table_owner,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')  AS public_tables;

-- CREATE (run once):
CREATE ROLE backup_reader WITH LOGIN PASSWORD 'PASTE_PASSWORD_HERE';
GRANT CONNECT ON DATABASE DB_NAME TO backup_reader;
GRANT USAGE ON SCHEMA public TO backup_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO backup_reader;
-- Tables added later by the app's migrations are readable too.
ALTER DEFAULT PRIVILEGES FOR ROLE OWNER_ROLE IN SCHEMA public GRANT SELECT ON TABLES TO backup_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE OWNER_ROLE IN SCHEMA public GRANT SELECT ON SEQUENCES TO backup_reader;

-- CHECK 2: expect readable = tables, writable = 0, can_create = false,
-- is_admin = false, can_login = true.
SELECT (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') AS tables,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public'
          AND has_table_privilege('backup_reader', format('%I.%I', schemaname, tablename), 'SELECT')) AS readable,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public'
          AND has_table_privilege('backup_reader', format('%I.%I', schemaname, tablename),
                                  'INSERT, UPDATE, DELETE, TRUNCATE')) AS writable,
       has_schema_privilege('backup_reader', 'public', 'CREATE') AS can_create,
       EXISTS (SELECT 1 FROM pg_roles s WHERE s.rolname = 'neon_superuser'
                 AND pg_has_role('backup_reader', s.oid, 'MEMBER')) AS is_admin,
       (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'backup_reader') AS can_login;

-- Only if pg_version starts with 14 and can_create is true (PostgreSQL 14 still
-- lets everyone create objects in "public"):
--   REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Later, to change the password (then update the GitHub secret BACKUP_DATABASE_URL):
--   ALTER ROLE backup_reader WITH PASSWORD 'NEW_PASSWORD';

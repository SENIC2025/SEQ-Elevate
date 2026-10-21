-- Release 3 (D76). One statement on its own: a new enum value can't be used in
-- the transaction that adds it. Nothing in this release's migrations inserts it.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PARTNER_ADMIN';

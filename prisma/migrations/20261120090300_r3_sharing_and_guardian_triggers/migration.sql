-- Release 3 (D80, D101): two triggers, after 20261120090200 has committed. With no
-- BEGIN, Prisma commits each statement on its own, so each locks one table at most
-- (CREATE TRIGGER: SHARE ROW EXCLUSIVE on its table, briefly). Every statement can
-- run again, so after a failure a retry runs them all.

SET lock_timeout = '5s';   -- a blocked statement fails the build (retry later), never stalls the site

-- D80: a card counts as shared only while its privacy is FACILITATOR. Writing any
-- other privacy clears its sharing, whatever code writes it: a save that writes
-- privacy alone ("Only me", then "facilitator" again) shares nothing.
CREATE OR REPLACE FUNCTION "unshare_comp_card_on_privacy_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."sharedAt" := NULL;
  NEW."sharedWithOrganisationId" := NULL;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS "CompCard_unshare_on_privacy_change" ON "CompCard";
CREATE TRIGGER "CompCard_unshare_on_privacy_change"
  BEFORE UPDATE OF "privacy" ON "CompCard"
  FOR EACH ROW WHEN (NEW."privacy" <> 'FACILITATOR')
  EXECUTE FUNCTION "unshare_comp_card_on_privacy_change"();

-- Spec 5.6, D101: a guardian's permission is recorded by the organisation that holds
-- it. A move away from that organisation clears the record and what it covered,
-- whatever code writes the move (setPersonOrganisation does the same).
CREATE OR REPLACE FUNCTION "clear_guardian_permission_on_move"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."guardianConsentRecordedAt" := NULL;
  NEW."guardianSharingConsentAt" := NULL;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS "ProjectProfile_clear_guardian_permission_on_move" ON "ProjectProfile";
CREATE TRIGGER "ProjectProfile_clear_guardian_permission_on_move"
  BEFORE UPDATE OF "organisationId" ON "ProjectProfile"
  FOR EACH ROW WHEN (OLD."organisationId" IS NOT NULL AND OLD."organisationId" IS DISTINCT FROM NEW."organisationId")
  EXECUTE FUNCTION "clear_guardian_permission_on_move"();

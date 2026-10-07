-- §8a Placeholder members.
--
-- A placeholder is a household member tracked by somebody else, with no account
-- of their own: the flatmate who will never sign up but still owes for the
-- groceries. §8's acceptance step cannot apply to them, because there is nobody
-- to do the accepting, so their splits are written ACCEPTED and count toward the
-- §12 balances immediately. Whoever manages them may act on their behalf.
--
-- They live in `users` rather than a parallel table because `expense_splits`,
-- `payments` and `settlement_transfers` all have foreign keys to it; a separate
-- participant type would mean changing every one of them.

ALTER TABLE "users" ADD COLUMN "is_placeholder" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "managed_by_user_id" UUID;

CREATE INDEX "users_managed_by_user_id_idx" ON "users" ("managed_by_user_id");

ALTER TABLE "users"
  ADD CONSTRAINT "users_managed_by_user_id_fkey"
  FOREIGN KEY ("managed_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The two columns only make sense together: a placeholder must have a manager,
-- and a real account must not have one.
ALTER TABLE "users"
  ADD CONSTRAINT "users_placeholder_has_manager"
  CHECK (
    (is_placeholder AND managed_by_user_id IS NOT NULL)
    OR (NOT is_placeholder AND managed_by_user_id IS NULL)
  );

-- A placeholder must never be able to authenticate.
--
-- The application never creates credentials for one, and their email address is
-- under the reserved .invalid TLD (RFC 2606) so no provider can ever verify it.
-- These triggers make that a database guarantee rather than a convention: if a
-- future change to the Auth.js callbacks ever tried to link an account or open a
-- session for a placeholder, it fails loudly instead of silently handing someone
-- a login to a tracked person's identity.
CREATE OR REPLACE FUNCTION reject_placeholder_credentials() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  placeholder BOOLEAN;
BEGIN
  SELECT is_placeholder INTO placeholder FROM "users" WHERE id = NEW.user_id;
  IF placeholder THEN
    RAISE EXCEPTION
      'user % is a placeholder and cannot hold %', NEW.user_id, TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_reject_placeholder
  BEFORE INSERT OR UPDATE ON "accounts"
  FOR EACH ROW EXECUTE FUNCTION reject_placeholder_credentials();

CREATE TRIGGER sessions_reject_placeholder
  BEFORE INSERT OR UPDATE ON "sessions"
  FOR EACH ROW EXECUTE FUNCTION reject_placeholder_credentials();

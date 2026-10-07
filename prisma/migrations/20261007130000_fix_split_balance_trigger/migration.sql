-- Fixes the deferred split-sum assertion added in 20261007120100.
--
-- That migration used ONE trigger function for both `expenses` and
-- `expense_splits`, picking the expense id with a CASE on TG_TABLE_NAME:
--
--   target_id := CASE WHEN TG_TABLE_NAME = 'expenses'
--                     THEN NEW.id ELSE NEW.expense_id END;
--
-- That cannot work, and it fails the moment it runs. plpgsql plans an
-- expression as a whole, so every field reference in it is resolved against the
-- actual record type regardless of which branch would execute. Firing on
-- `expenses`, whose rows have no `expense_id` column, raised:
--
--   ERROR 42703: record "new" has no field "expense_id"
--
-- The assertion itself is unchanged, including its message. It now lives in a
-- plain function taking the expense id, with one thin trigger function per table
-- so each only ever names columns that exist on its own table.
--
-- Fixed forward rather than by editing 20261007120100, because Prisma records a
-- checksum per applied migration: editing a migration that any database has
-- already applied makes `prisma migrate deploy` refuse to run there.

DROP TRIGGER IF EXISTS expense_splits_sum_matches_expense ON "expense_splits";
DROP TRIGGER IF EXISTS expenses_sum_matches_splits ON "expenses";
DROP FUNCTION IF EXISTS assert_expense_splits_balance();

-- The §10 assertion: SUM(expense_splits.amount_cents) = expenses.amount_cents.
CREATE OR REPLACE FUNCTION assert_expense_balanced(target_id UUID) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  expense_total BIGINT;
  splits_total  BIGINT;
BEGIN
  SELECT amount_cents INTO expense_total FROM "expenses" WHERE id = target_id;

  -- The expense itself went away in this transaction (a TRUNCATE in tests, or a
  -- cascade): there is no total left to assert against.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0)
    INTO splits_total
    FROM "expense_splits"
   WHERE expense_id = target_id;

  IF splits_total <> expense_total THEN
    RAISE EXCEPTION
      'expense % has splits summing to % but a total of %',
      target_id, splits_total, expense_total
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION expense_splits_balance_trigger() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- NEW is unassigned on DELETE, OLD on INSERT, so each is read in its own
  -- statement rather than in one expression.
  IF TG_OP = 'DELETE' THEN
    PERFORM assert_expense_balanced(OLD.expense_id);
  ELSE
    PERFORM assert_expense_balanced(NEW.expense_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION expenses_balance_trigger() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- Its trigger is INSERT OR UPDATE only, so NEW is always assigned.
  PERFORM assert_expense_balanced(NEW.id);
  RETURN NULL;
END;
$$;

-- Deferred to COMMIT because an expense and its splits are necessarily written
-- in separate statements: the sum is legitimately wrong in between, and only the
-- state at COMMIT is a fact about the world.
CREATE CONSTRAINT TRIGGER expense_splits_sum_matches_expense
  AFTER INSERT OR UPDATE OR DELETE ON "expense_splits"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION expense_splits_balance_trigger();

CREATE CONSTRAINT TRIGGER expenses_sum_matches_splits
  AFTER INSERT OR UPDATE ON "expenses"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION expenses_balance_trigger();

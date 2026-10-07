-- §10 Immutability enforcement (database layer) and §12 derived balances.
--
-- The application layer already guards these rules, but §10 requires both: the
-- triggers below mean a bug, a migration script, or a hand-run UPDATE in a psql
-- session cannot rewrite financial history either.

-- ---------------------------------------------------------------------------
-- 1. Append-only tables
-- ---------------------------------------------------------------------------

-- Rejects any attempt to change or remove a row.
--
-- Note this also makes the ON DELETE CASCADE from `households` unable to remove
-- these rows, which is deliberate: deleting a household must not silently erase
-- its financial record. Test fixtures use TRUNCATE, which does not fire
-- row-level DELETE triggers.
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    '% is append-only: % is not permitted. Insert a reversal row instead.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- §9 — cancelling a payment inserts a reversal row; the original is untouched.
CREATE TRIGGER payments_immutable
  BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- A confirmation row IS the CONFIRMED state of a payment (which is why
-- `payments` carries no status column), so it is just as immutable.
CREATE TRIGGER payment_confirmations_immutable
  BEFORE UPDATE OR DELETE ON "payment_confirmations"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- §11 — the audit trail is worthless if it can be edited.
CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ---------------------------------------------------------------------------
-- 2. Deferred split-sum assertion
-- ---------------------------------------------------------------------------

-- Asserts SUM(expense_splits.amount_cents) = expenses.amount_cents.
--
-- Deferred to COMMIT because an expense and its splits are necessarily written
-- in separate statements: the sum is legitimately wrong in between, and only
-- the state at COMMIT is a fact about the world.
CREATE OR REPLACE FUNCTION assert_expense_splits_balance() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  target_id     UUID;
  expense_total BIGINT;
  splits_total  BIGINT;
BEGIN
  -- NEW is unassigned on DELETE, OLD is unassigned on INSERT, and this one
  -- function serves triggers on two tables that name the expense differently.
  IF TG_OP = 'DELETE' THEN
    target_id := CASE WHEN TG_TABLE_NAME = 'expenses' THEN OLD.id ELSE OLD.expense_id END;
  ELSE
    target_id := CASE WHEN TG_TABLE_NAME = 'expenses' THEN NEW.id ELSE NEW.expense_id END;
  END IF;

  SELECT amount_cents INTO expense_total FROM "expenses" WHERE id = target_id;

  -- The expense itself went away in this transaction (a TRUNCATE in tests, or a
  -- cascade): there is no total left to assert against.
  IF NOT FOUND THEN
    RETURN NULL;
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

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER expense_splits_sum_matches_expense
  AFTER INSERT OR UPDATE OR DELETE ON "expense_splits"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_expense_splits_balance();

CREATE CONSTRAINT TRIGGER expenses_sum_matches_splits
  AFTER INSERT OR UPDATE ON "expenses"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_expense_splits_balance();

-- ---------------------------------------------------------------------------
-- 3. §9 Derived payment status
-- ---------------------------------------------------------------------------

-- `payments` owns no mutable column, so a payment's status is derived from the
-- rows that exist around it: a confirmation row means CONFIRMED, and a reversal
-- row pointing back at it means REVERSED.
--
-- `payments.reverses_payment_id` is UNIQUE, so the self-join adds at most one
-- row and cannot fan out. A reversal row carries its own confirmation (written
-- in the same transaction), so it reads as CONFIRMED and its negative amount
-- cancels the original in balance math.
CREATE OR REPLACE VIEW "payment_states" AS
SELECT
  p.id,
  p.household_id,
  p.from_user_id,
  p.to_user_id,
  p.amount_cents,
  p.currency,
  p.method,
  p.expense_split_id,
  p.settlement_id,
  p.reverses_payment_id,
  p.paid_at,
  c.confirmed_at,
  c.confirmed_by_user_id,
  CASE
    WHEN rev.id IS NOT NULL      THEN 'REVERSED'::"PaymentStatus"
    WHEN c.payment_id IS NOT NULL THEN 'CONFIRMED'::"PaymentStatus"
    ELSE 'PENDING_CONFIRMATION'::"PaymentStatus"
  END AS status
FROM "payments" p
LEFT JOIN "payment_confirmations" c ON c.payment_id = p.id
LEFT JOIN "payments" rev ON rev.reverses_payment_id = p.id;

-- ---------------------------------------------------------------------------
-- 4. §12 Balances — derived, never stored
-- ---------------------------------------------------------------------------

-- Per (household_id, user_id):
--   total_paid_cents — expenses they paid, counting only ACCEPTED,
--                      PARTIALLY_PAID, PAID and LOCKED
--   total_owed_cents — their ACCEPTED splits on those same expenses
--   net_cents        — paid - owed (positive => the household owes them)
--
-- Invariant: SUM(net_cents) per household is exactly 0, because every countable
-- expense has its full amount covered by accepted splits (guaranteed by the
-- deferred trigger above plus the fact that the countable statuses are only
-- reachable once every split is accepted).
CREATE OR REPLACE VIEW "household_balances" AS
WITH countable AS (
  SELECT e.id, e.household_id, e.paid_by_user_id, e.amount_cents
    FROM "expenses" e
   WHERE e.status IN ('ACCEPTED', 'PARTIALLY_PAID', 'PAID', 'LOCKED')
),
paid AS (
  SELECT household_id, paid_by_user_id AS user_id, SUM(amount_cents) AS cents
    FROM countable
   GROUP BY 1, 2
),
owed AS (
  SELECT c.household_id, s.user_id, SUM(s.amount_cents) AS cents
    FROM "expense_splits" s
    JOIN countable c ON c.id = s.expense_id
   WHERE s.acceptance = 'ACCEPTED'
   GROUP BY 1, 2
)
SELECT
  m.household_id,
  m.user_id,
  COALESCE(p.cents, 0)::BIGINT AS total_paid_cents,
  COALESCE(o.cents, 0)::BIGINT AS total_owed_cents,
  (COALESCE(p.cents, 0) - COALESCE(o.cents, 0))::BIGINT AS net_cents
FROM "household_members" m
LEFT JOIN paid p ON p.household_id = m.household_id AND p.user_id = m.user_id
LEFT JOIN owed o ON o.household_id = m.household_id AND o.user_id = m.user_id;

-- What a member actually still owes after settlement: the expense-derived net
-- from §12, adjusted by confirmed payments in both directions. This is the
-- number the dashboard shows, and it is what §40 step 7 means by "balances read
-- 0 net for both" once Bob's payment is confirmed. It also sums to 0 per
-- household, since each payment adds +x to the sender and -x to the recipient.
CREATE OR REPLACE VIEW "household_net_positions" AS
WITH confirmed AS (
  SELECT household_id, from_user_id, to_user_id, amount_cents
    FROM "payment_states"
   WHERE status = 'CONFIRMED'
),
sent AS (
  SELECT household_id, from_user_id AS user_id, SUM(amount_cents) AS cents
    FROM confirmed GROUP BY 1, 2
),
received AS (
  SELECT household_id, to_user_id AS user_id, SUM(amount_cents) AS cents
    FROM confirmed GROUP BY 1, 2
)
SELECT
  b.household_id,
  b.user_id,
  b.total_paid_cents,
  b.total_owed_cents,
  b.net_cents AS expense_net_cents,
  COALESCE(s.cents, 0)::BIGINT AS payments_sent_cents,
  COALESCE(r.cents, 0)::BIGINT AS payments_received_cents,
  (b.net_cents + COALESCE(s.cents, 0) - COALESCE(r.cents, 0))::BIGINT AS settled_net_cents
FROM "household_balances" b
LEFT JOIN sent s     ON s.household_id = b.household_id AND s.user_id = b.user_id
LEFT JOIN received r ON r.household_id = b.household_id AND r.user_id = b.user_id;

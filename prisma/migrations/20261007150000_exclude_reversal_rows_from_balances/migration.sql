-- Fixes §12 balances after an expense is reversed.
--
-- §7 reverses an expense by creating a new one with the negated amount and
-- `reverses_expense_id` set, and moving the original to REVERSED. §12's
-- countable set is ACCEPTED | PARTIALLY_PAID | PAID | LOCKED, so the original
-- drops out — but the reversal row lands ACCEPTED and was still counted. That
-- applies the cancellation twice:
--
--   Ann pays 9000, split 4500/4500, accepted  ->  Ann +4500, Bob -4500
--   reverse it                                ->  Ann -4500, Bob +4500
--
-- Ann should be back at 0 and instead shows as owing 4500. The per-household
-- zero-sum invariant still holds in that state, which is why no existing test
-- caught it: the error is symmetric.
--
-- Excluding the reversal row as well leaves a reversed pair contributing
-- nothing, which is what "cancelled" should mean. The reversal row remains on
-- the record, carrying the reason, as the documentation of why the original no
-- longer counts.
--
-- This is also correct for an expense reversed before it was ever accepted: both
-- rows are excluded, and balances are simply unchanged.
--
-- Note that confirmed PAYMENTS against a reversed expense still count in
-- `household_net_positions`, and should: if Bob paid for something that was
-- later cancelled, he has overpaid and is owed it back.

CREATE OR REPLACE VIEW "household_balances" AS
WITH countable AS (
  SELECT e.id, e.household_id, e.paid_by_user_id, e.amount_cents
    FROM "expenses" e
   WHERE e.status IN ('ACCEPTED', 'PARTIALLY_PAID', 'PAID', 'LOCKED')
     -- A reversal row: its counterpart is already excluded by its REVERSED
     -- status, so counting this one would double-apply the correction.
     AND e.reverses_expense_id IS NULL
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

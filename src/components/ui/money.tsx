import { formatMoney, formatSignedMoney } from "@/lib/money";
import { balanceToneClass } from "@/lib/ui/status";

/**
 * §13 — money is only ever rendered through `formatMoney`.
 *
 * Tabular figures so columns of amounts line up, which is most of what makes a
 * list of expenses readable.
 */
export function Money({
  cents,
  currency,
  className = "",
}: {
  cents: number;
  currency: string;
  className?: string;
}) {
  return (
    <span className={`font-mono tabular-nums ${className}`}>
      {formatMoney(cents, currency)}
    </span>
  );
}

/** A net balance: green when owed to you, red when you owe, grey at zero. */
export function Balance({
  cents,
  currency,
  className = "",
}: {
  cents: number;
  currency: string;
  className?: string;
}) {
  return (
    <span
      className={`font-mono font-medium tabular-nums ${balanceToneClass(cents)} ${className}`}
    >
      {formatSignedMoney(cents, currency)}
    </span>
  );
}

import { Balance } from "@/components/ui/money";
import { Card } from "@/components/ui/card";
import type { MemberBalance } from "@/lib/households/queries";
import { formatMoney } from "@/lib/money";
import { minimizeTransfers } from "@/lib/settlements/minimize";

/**
 * The household's position at a glance.
 *
 * The headline number is the viewer's own settled net — §12's expense-derived
 * balance adjusted by confirmed payments — because "what do I owe" is the
 * question people actually open this app to answer.
 */
export function BalanceSummary({
  members,
  currency,
  viewerUserId,
}: {
  members: MemberBalance[];
  currency: string;
  viewerUserId: string;
}) {
  const you = members.find((member) => member.userId === viewerUserId);
  const yourNet = you?.settledNetCents ?? 0;

  // The §12 invariant, stated where a reader can check it against the numbers
  // immediately below.
  const total = members.reduce((sum, member) => sum + member.settledNetCents, 0);

  return (
    <Card className="p-5">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {yourNet > 0 ? "You are owed" : yourNet < 0 ? "You owe" : "You are settled up"}
      </p>
      <p className="mt-1 font-mono text-3xl font-semibold tabular-nums">
        {formatMoney(Math.abs(yourNet), currency)}
      </p>

      {members.length > 1 ? (
        <ul className="mt-5 space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          {members
            .filter((member) => member.userId !== viewerUserId)
            .map((member) => (
              <li
                key={member.userId}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="truncate text-slate-600 dark:text-slate-400">
                  {member.name ?? member.email}
                </span>
                <Balance cents={member.settledNetCents} currency={currency} />
              </li>
            ))}
        </ul>
      ) : null}

      {total !== 0 ? (
        // Should be unreachable: §12 guarantees these sum to zero. Shown rather
        // than hidden, because a silent accounting error is the worst outcome.
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          Balances do not sum to zero ({total} cents). This is a bug — please report it.
        </p>
      ) : null}
    </Card>
  );
}

/**
 * The shortest set of payments that settles everybody up (§12).
 *
 * Only rendered when something is actually outstanding.
 */
export function SettleUpPlan({
  members,
  currency,
  viewerUserId,
}: {
  members: MemberBalance[];
  currency: string;
  viewerUserId: string;
}) {
  const positions = members.map((member) => ({
    userId: member.userId,
    netCents: member.settledNetCents,
  }));

  if (positions.every((position) => position.netCents === 0)) {
    return null;
  }

  const nameOf = new Map(
    members.map((member) => [member.userId, member.name ?? member.email]),
  );

  let transfers: ReturnType<typeof minimizeTransfers>;
  try {
    transfers = minimizeTransfers(positions);
  } catch {
    // minimizeTransfers throws when the balances do not sum to zero, which the
    // banner above already reports. Nothing useful to draw in that case.
    return null;
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h2 className="text-sm font-semibold tracking-tight">Settle up</h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          The fewest payments that clear everyone.
        </p>
      </div>
      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {transfers.map((transfer) => {
          const involvesYou =
            transfer.fromUserId === viewerUserId || transfer.toUserId === viewerUserId;
          return (
            <li
              key={`${transfer.fromUserId}-${transfer.toUserId}`}
              className={`flex items-center justify-between gap-3 px-4 py-3 text-sm ${
                involvesYou ? "bg-slate-50 dark:bg-slate-800/50" : ""
              }`}
            >
              <span className="truncate">
                <span
                  className={transfer.fromUserId === viewerUserId ? "font-medium" : ""}
                >
                  {transfer.fromUserId === viewerUserId
                    ? "You"
                    : nameOf.get(transfer.fromUserId)}
                </span>
                <span className="mx-2 text-slate-400">→</span>
                <span className={transfer.toUserId === viewerUserId ? "font-medium" : ""}>
                  {transfer.toUserId === viewerUserId
                    ? "you"
                    : nameOf.get(transfer.toUserId)}
                </span>
              </span>
              <span className="font-mono tabular-nums">
                {formatMoney(transfer.amountCents, currency)}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * Money handling (§2.1).
 *
 * Money is an integer number of minor units ("cents") everywhere in the app.
 * This module is the only sanctioned boundary where cents turn into a `bigint`
 * (for a Postgres `BIGINT` column) or into a display string. Nothing else may
 * divide, round, or otherwise float money.
 */

/** Thrown when a value that must be integer cents is not. */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/**
 * Narrows an arbitrary number to integer cents.
 *
 * Rejects non-integers (a float has already lost precision by the time it gets
 * here) and anything outside the exact-integer range of a JS number, which is
 * where a `BIGINT` round-trip would start to silently lie.
 */
export function assertCents(value: number, label = "amount"): number {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} must be integer cents, received ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} is outside the safe integer range: ${value}`);
  }
  return value;
}

/** Cents -> `bigint`, for writing to a `BIGINT` column. */
export function toDbCents(value: number, label = "amount"): bigint {
  return BigInt(assertCents(value, label));
}

/** `bigint` -> cents, for reading a `BIGINT` column back out. */
export function fromDbCents(value: bigint, label = "amount"): number {
  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber)) {
    throw new MoneyError(`${label} from the database exceeds safe integers: ${value}`);
  }
  return asNumber;
}

/** Adds cents with an overflow guard. */
export function sumCents(values: Iterable<number>, label = "amount"): number {
  let total = 0;
  for (const value of values) {
    total += assertCents(value, label);
  }
  return assertCents(total, `${label} total`);
}

const minorUnitCache = new Map<string, number>();

/**
 * Number of minor-unit digits for an ISO 4217 code: 2 for NZD/USD, 0 for JPY,
 * 3 for KWD. Resolved from Intl so we do not hand-maintain a currency table.
 */
export function minorUnitDigits(currency: string): number {
  const code = currency.toUpperCase();
  const cached = minorUnitCache.get(code);
  if (cached !== undefined) {
    return cached;
  }
  let digits: number;
  try {
    // `maximumFractionDigits` is optional in the type but always present for
    // style: "currency"; 2 is the sane fallback either way.
    digits =
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
      }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // Not a currency code Intl recognises; assume the 2-digit majority.
    digits = 2;
  }
  minorUnitCache.set(code, digits);
  return digits;
}

/**
 * The locale money is rendered in when a caller does not name one.
 *
 * Pinned deliberately rather than left to the runtime default. Server-rendered
 * money appears in emails, in stored notification text and in SSR'd HTML, and
 * `Intl` would otherwise format it according to whichever locale the serverless
 * instance happens to have: the same NZD amount reads "$45.00" on an en-NZ
 * instance and "NZ$45.00" on an en-US one. Pinning makes the output a property
 * of the code rather than of the host.
 *
 * A per-household locale would belong on the `households` row; until then this
 * follows the project's default currency.
 */
export const DEFAULT_MONEY_LOCALE = "en-NZ";

/**
 * The single rendering path for money (§13). The division below is the one
 * place a float appears, and it is the UI boundary §2.1 allows: `cents` is a
 * safe integer, so `cents / 10 ** digits` is exact to well beyond the digits
 * actually displayed.
 */
export function formatMoney(
  cents: number,
  currency: string,
  locale: string = DEFAULT_MONEY_LOCALE,
): string {
  assertCents(cents, "formatMoney amount");
  const code = currency.toUpperCase();
  const digits = minorUnitDigits(code);
  const value = cents / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${code} ${value.toFixed(digits)}`;
  }
}

/** Signed variant used for balances: "+$40.00 owed to you" / "-$50.00". */
export function formatSignedMoney(
  cents: number,
  currency: string,
  locale: string = DEFAULT_MONEY_LOCALE,
): string {
  const formatted = formatMoney(Math.abs(cents), currency, locale);
  if (cents === 0) {
    return formatted;
  }
  return `${cents > 0 ? "+" : "-"}${formatted}`;
}

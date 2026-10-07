/**
 * §8a Placeholder members — members tracked by somebody else, with no account.
 *
 * Pure, so the address scheme and the act-on-behalf rule are unit-testable.
 */

/**
 * The address a placeholder is given.
 *
 * `users.email` is NOT NULL and unique, because Auth.js's Prisma adapter looks
 * users up by email and types it as a string. Rather than loosen that for a case
 * the adapter never sees, a placeholder gets a synthetic address under
 * `.invalid` — a TLD RFC 2606 reserves precisely so that it can never resolve.
 * No provider can ever verify it, so it can never become a route to signing in.
 */
export const PLACEHOLDER_EMAIL_DOMAIN = "splithome.invalid";

export function placeholderEmail(userId: string): string {
  return `placeholder.${userId}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

export function isPlaceholderEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}

export interface ActorSubject {
  id: string;
  isPlaceholder: boolean;
  managedByUserId: string | null;
}

/**
 * Whether `actorUserId` may act for `subject`.
 *
 * Two cases only: you act for yourself, or you manage the placeholder. A
 * placeholder's manager is explicitly NOT transitive — a placeholder cannot
 * manage another placeholder, since it has no way to act at all.
 *
 * This is what lets §8 acceptance and §9 payment confirmation work at all for a
 * tracked person: somebody has to be able to accept and confirm on their behalf,
 * and it must be exactly one identifiable somebody for the audit trail to mean
 * anything.
 */
export function canActFor(actorUserId: string, subject: ActorSubject): boolean {
  if (actorUserId === subject.id) {
    return true;
  }
  return subject.isPlaceholder && subject.managedByUserId === actorUserId;
}

/**
 * Whether a split should be written already accepted.
 *
 * A placeholder has nobody to accept for it, and the person who paid has
 * implicitly accepted their own share by entering the expense. Everyone else
 * must accept for themselves (§8).
 */
export function splitStartsAccepted(options: {
  participantUserId: string;
  paidByUserId: string;
  createdByUserId: string;
  isPlaceholder: boolean;
}): boolean {
  if (options.isPlaceholder) {
    return true;
  }
  return (
    options.participantUserId === options.paidByUserId ||
    options.participantUserId === options.createdByUserId
  );
}

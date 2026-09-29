import 'server-only';

import { createHash } from 'node:crypto';

/**
 * The record id for a write the owner may submit more than once.
 *
 * A slow screen gets tapped twice, a flaky connection gets retried, a form gets
 * resubmitted by the back button. Deriving the id from a key the client fixes
 * before the first attempt means the second attempt lands on the same primary
 * key instead of creating a second payment or a second credit note -- the
 * database refuses the duplicate rather than the code remembering to check.
 */
export const idempotentId = (prefix: string, key: string) =>
  `${prefix}__${createHash('sha256').update(key).digest('hex').slice(0, 40)}`;

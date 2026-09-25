/**
 * Print which GST rule values have been verified against an official source.
 *
 * Run this before any release that claims GST support. A value that is not
 * `verified` means the dependent feature degrades or blocks -- it never means
 * the app quietly uses a plausible default.
 */
import { DEFAULT_RULE_PACK, auditRulePack } from '../src/lib/gst/ruleset';

const audit = auditRulePack(DEFAULT_RULE_PACK);

console.log(`Rule pack: ${audit.version}`);
console.log(`Label:     ${DEFAULT_RULE_PACK.label}`);
console.log(`Verified:  ${audit.verified} of ${audit.total}\n`);

if (audit.fullyVerified) {
  console.log('All legal parameters are verified.');
  process.exit(0);
}

console.log('NOT VERIFIED — the features depending on these are blocked or degraded:');
for (const key of audit.unverified) console.log(`  - ${key}`);
console.log(
  '\nTo verify: read each value from its official source, set provenance.verifiedOn,\n' +
    'provenance.verifiedBy and provenance.status = "verified", bump the pack version,\n' +
    'and re-run this command. See docs/compliance/README.md.',
);
process.exit(1);

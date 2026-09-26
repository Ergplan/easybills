/**
 * The Firestore rules are executed, not just written.
 *
 * `firestore.rules` denies every direct client read and write. That single fact
 * is the tenant-isolation backstop: even someone holding the Firebase Web API
 * key -- which is public by design, shipped to every browser on every page load
 * -- cannot reach another business's records, because the browser is not
 * allowed to talk to Firestore at all.
 *
 * Nothing else in this suite tests that. Every other integration test reaches
 * Firestore through the Admin SDK, which bypasses rules entirely by design, so
 * all of them would pass just as happily against a rule set that allowed the
 * world. These tests use the CLIENT SDK, as a browser would, and assert the
 * refusals -- before the rules are deployed rather than after.
 */
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'easybills-rules-test',
    firestore: {
      rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
      host: host!,
      port: Number(port),
    },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

/** Somewhere a real record lives, and somewhere one never will. */
const PATHS = [
  'businesses/some-business',
  'businesses/some-business/invoices/some-invoice',
  'businesses/some-business/customers/some-customer',
  'businesses/some-business/payments/some-payment',
  'businesses/some-business/auditEvents/some-event',
  'users/some-user',
  'jobs/some-job',
];

describe('a signed-out browser', () => {
  it.each(PATHS)('cannot read %s', async (path) => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, path)));
  });

  it.each(PATHS)('cannot write %s', async (path) => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, path), { tampered: true }));
  });
});

describe('a signed-in browser', () => {
  // Signing in is how a browser gets an ID token for THIS app's own server.
  // It is not, and must never become, permission to query the database.
  it.each(PATHS)('still cannot read %s', async (path) => {
    const db = env.authenticatedContext('uid-owner').firestore();
    await assertFails(getDoc(doc(db, path)));
  });

  it.each(PATHS)('still cannot write %s', async (path) => {
    const db = env.authenticatedContext('uid-owner').firestore();
    await assertFails(setDoc(doc(db, path), { tampered: true }));
  });

  it('cannot delete a bill it does not like', async () => {
    const db = env.authenticatedContext('uid-owner').firestore();
    await assertFails(deleteDoc(doc(db, 'businesses/some-business/invoices/some-invoice')));
  });

  it('cannot list a collection to discover what exists', async () => {
    const db = env.authenticatedContext('uid-owner').firestore();
    await assertFails(getDocs(collection(db, 'businesses/some-business/invoices')));
  });
});

describe('another business', () => {
  it('cannot reach records that are not its own, even signed in', async () => {
    // The attack the rules exist to stop: a real, signed-in owner of one
    // business reaching for another's bills with the public API key.
    const db = env.authenticatedContext('uid-attacker', { email: 'attacker@example.test' }).firestore();
    await assertFails(getDoc(doc(db, 'businesses/victim-business/invoices/victim-invoice')));
    await assertFails(getDocs(collection(db, 'businesses/victim-business/invoices')));
  });
});

describe('the rule set itself', () => {
  it('grants nothing anywhere, so a new collection is closed by default', async () => {
    // A rule set that enumerates collections leaves the next one someone adds
    // wide open until they remember. This one matches everything and allows
    // nothing, so a collection added tomorrow is already denied.
    const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
    expect(rules).toMatch(/match\s+\/\{document=\*\*\}/);
    expect(rules).toMatch(/allow\s+read,\s*write:\s*if\s+false;/);
    // No `allow` anywhere that grants something.
    const grants = [...rules.matchAll(/allow[^;]*;/g)].map((m) => m[0]);
    expect(grants.every((g) => /if\s+false\s*;/.test(g))).toBe(true);

    const db = env.authenticatedContext('uid-owner').firestore();
    await assertFails(getDoc(doc(db, 'a-collection-nobody-has-written-yet/any-doc')));
  });
});

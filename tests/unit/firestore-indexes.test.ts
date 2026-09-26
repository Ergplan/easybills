/**
 * Every compound query the app makes has an index committed for it.
 *
 * This is the one class of production failure the rest of the suite cannot
 * catch. The Firestore emulator answers any query you ask it, indexed or not,
 * so all 293 other tests pass against a database that a real project would
 * refuse. The first real user hits `FAILED_PRECONDITION: The query requires an
 * index`, and the fix is a console link nobody was watching for.
 *
 * So the queries are written down here as data, and checked against
 * `firestore.indexes.json`. Adding a compound query without its index fails
 * here, at the same moment the query is written, rather than in production.
 *
 * The rule being applied is Firestore's own: an index covers a query when its
 * leading fields are exactly that query's equality fields, followed by the
 * range or ordering field in the direction asked for.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Dir = 'ASCENDING' | 'DESCENDING';
interface IndexField {
  fieldPath: string;
  order?: Dir;
}
interface CompositeIndex {
  collectionGroup: string;
  queryScope: string;
  fields: IndexField[];
}

const file = JSON.parse(readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8')) as {
  indexes: CompositeIndex[];
  fieldOverrides: unknown[];
};

/**
 * A compound query the application actually issues, with the source it comes
 * from, so a failure here names the line to look at.
 */
interface Query {
  where: string;
  collection: string;
  /** Fields compared with `==` or `in`. Order does not matter. */
  equality: string[];
  /** The one field a query may range over or sort by, and its direction. */
  tail?: { field: string; order: Dir };
}

const QUERIES: Query[] = [
  {
    where: 'src/server/services/home-summary.ts — unfinished bills, newest first',
    collection: 'invoices',
    equality: ['status'],
    tail: { field: 'updatedAt', order: 'DESCENDING' },
  },
  {
    where: 'src/server/repos/invoices.ts listInvoices — unfiltered, newest first',
    collection: 'invoices',
    equality: [],
    tail: { field: 'updatedAt', order: 'DESCENDING' },
  },
  {
    where: 'src/server/gst/repo.ts listIssuedInvoicesForPeriod — issued, within the period',
    collection: 'invoices',
    equality: ['status'],
    tail: { field: 'issueDate', order: 'ASCENDING' },
  },
  {
    where: 'src/server/services/bill-search.ts customerBalance — one customer, issued only',
    collection: 'invoices',
    equality: ['customer.customerId', 'status'],
  },
  {
    where: 'src/server/services/bill-search.ts — every bill, newest first',
    collection: 'invoices',
    equality: [],
    tail: { field: 'issueDate', order: 'DESCENDING' },
  },
  {
    where: 'src/server/repos/customers.ts recentCustomers — not archived, recently billed first',
    collection: 'customers',
    equality: ['archived'],
    tail: { field: 'lastBilledAt', order: 'DESCENDING' },
  },
  {
    where: 'src/server/jobs/queue.ts claimJobs — due work',
    collection: 'jobs',
    equality: ['status'],
    tail: { field: 'runAfter', order: 'ASCENDING' },
  },
  {
    where: 'src/server/gst/repo.ts latestSnapshot — newest GSTR-2B for a GSTIN and period',
    collection: 'gstStatementSnapshots',
    equality: ['gstin', 'period', 'statementType'],
    tail: { field: 'importVersion', order: 'DESCENDING' },
  },
  {
    where: 'src/server/repos/payments.ts listPayments — newest first',
    collection: 'payments',
    equality: [],
    tail: { field: 'createdAt', order: 'DESCENDING' },
  },
  {
    where: 'src/server/repos/adjustments.ts listAdjustments — newest first',
    collection: 'adjustments',
    equality: [],
    tail: { field: 'createdAt', order: 'DESCENDING' },
  },
];

/**
 * Firestore builds a single-field index for every field by itself, so a query
 * that filters on nothing and sorts on one field, or filters on one field and
 * sorts on nothing, is already served. Anything else is compound.
 */
function needsCompositeIndex(q: Query): boolean {
  const filters = q.equality.length;
  if (!q.tail) return filters > 1;
  if (filters === 0) return false;
  return !(filters === 1 && q.equality[0] === q.tail.field);
}

function isCoveredBy(q: Query, index: CompositeIndex): boolean {
  if (index.collectionGroup !== q.collection) return false;
  const n = q.equality.length;
  const head = index.fields.slice(0, n).map((f) => f.fieldPath);
  if (head.length !== n) return false;
  if ([...head].sort().join('|') !== [...q.equality].sort().join('|')) return false;

  if (!q.tail) return index.fields.length === n;
  const tail = index.fields[n];
  return tail !== undefined && tail.fieldPath === q.tail.field && tail.order === q.tail.order;
}

describe('Firestore indexes', () => {
  it.each(QUERIES.filter(needsCompositeIndex).map((q) => [q.where, q] as const))(
    'has an index for: %s',
    (_label, q) => {
      const covered = file.indexes.some((index) => isCoveredBy(q, index));
      expect(
        covered,
        `No index in firestore.indexes.json covers this query. Add one for "${q.collection}" with fields ` +
          `${[...q.equality, q.tail?.field].filter(Boolean).join(', ')}.`,
      ).toBe(true);
    },
  );

  it('leaves the queries Firestore already serves alone', () => {
    // Single-field queries are served by the automatic indexes. Committing a
    // composite index for one costs write latency on every document and buys
    // nothing, so the file should not contain any.
    const singles = QUERIES.filter((q) => !needsCompositeIndex(q));
    expect(singles.length).toBeGreaterThan(0);
    for (const q of singles) {
      expect(
        file.indexes.some((index) => isCoveredBy(q, index)),
        `${q.where} needs no composite index, but one is committed.`,
      ).toBe(false);
    }
  });

  it('commits no index that no query asks for', () => {
    // An index nobody queries is a write cost nobody chose. If one of these is
    // deliberate, add the query it serves to QUERIES above and say where from.
    const unused = file.indexes.filter((index) => !QUERIES.some((q) => isCoveredBy(q, index)));
    expect(unused.map((i) => `${i.collectionGroup}: ${i.fields.map((f) => f.fieldPath).join(', ')}`)).toEqual([]);
  });

  it('indexes subcollections at collection scope, not collection-group scope', () => {
    // Every business-owned collection hangs off businesses/{businessId}, and no
    // query ever reaches across businesses -- that is the tenancy boundary.
    // A COLLECTION_GROUP index here would be an index for a query that must
    // never be written.
    for (const index of file.indexes) {
      expect(index.queryScope, `${index.collectionGroup} is indexed at the wrong scope`).toBe('COLLECTION');
    }
  });
});

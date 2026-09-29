/**
 * Poocho against a real Postgres with pgvector: what gets indexed, that it
 * follows the records, that one business never finds another's, and the
 * answer path with a stand-in for OpenAI.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { todayIst } from '@/lib/dates';
import { pool } from '@/server/db/pool';
import { emptyParty, issueInvoice, newInvoiceId, saveDraft } from '@/server/repos/invoices';
import { recordPayment } from '@/server/repos/payments';
import { askRecords, searchRecords } from '@/server/search/ask';
import { catchUp, indexUpload, listUploads, removeUpload } from '@/server/search/index-records';

import { line, makeGstBusiness, ownerUidOf } from '../helpers';

async function billFor(business: Awaited<ReturnType<typeof makeGstBusiness>>, who: string, what: string, rate: string, issue = true) {
  const uid = await ownerUidOf(business);
  const draft = await saveDraft({
    business,
    uid,
    invoiceId: newInvoiceId(),
    kind: 'customer-invoice',
    issueDate: todayIst(),
    customer: { ...emptyParty(who), stateCode: '27' },
    placeOfSupplyStateCode: '27',
    supplyFlags: [],
    lines: [line(what, '1', rate, '18')],
    notes: null,
    baseRevision: 0,
  });
  if (!issue) return draft;
  return (await issueInvoice({ business, uid, invoiceId: draft.id })).invoice;
}

describe('keeping the index in step', () => {
  it('indexes issued bills, never drafts, and re-indexes a bill when it changes', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const issued = await billFor(business, 'Sharma Electricals', 'AMC visit', '3500');
    await billFor(business, 'Draft Only Traders', 'Wiring', '900', false);

    expect(await catchUp(business.id)).toBe(1);
    expect(await catchUp(business.id)).toBe(0); // nothing moved since

    await recordPayment({
      businessId: business.id,
      uid,
      customerId: null,
      receivedOn: todayIst(),
      amountPaise: 100000,
      method: 'upi',
      reference: null,
      note: null,
      allocations: [{ invoiceId: issued.id, amountPaise: 100000 }],
    });
    expect(await catchUp(business.id)).toBe(1);
    const { rows } = await pool().query<{ text: string }>(
      "select c.text from chunks c join documents d on d.business_id = c.business_id and d.id = c.document_id where d.business_id = $1 and d.kind = 'bill'",
      [business.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toContain('Received ₹1,000.');
  });
});

describe('searching by words', () => {
  it("finds a bill by the customer's name and what was done", async () => {
    const business = await makeGstBusiness();
    await billFor(business, 'Sharma Electricals', 'AMC visit', '3500');
    await billFor(business, 'Mehta Traders', 'Ceiling fan install', '1350');
    await catchUp(business.id);

    const hits = await searchRecords(business.id, 'Sharma ko pichli baar AMC ka kya rate diya?');
    expect(hits[0]!.title).toMatch(/Sharma Electricals/);
    expect(hits[0]!.href).toMatch(/^\/bills\//);
    expect((await searchRecords(business.id, 'fan'))[0]!.title).toMatch(/Mehta Traders/);
  });

  it("never finds another business's records", async () => {
    const alpha = await makeGstBusiness({ legalName: 'Alpha' });
    const beta = await makeGstBusiness({ legalName: 'Beta' });
    await billFor(alpha, 'Zanzibar Unique Customer', 'Secret work', '999');
    await catchUp(alpha.id);
    await catchUp(beta.id);
    expect(await searchRecords(beta.id, 'Zanzibar')).toHaveLength(0);
    expect(await searchRecords(alpha.id, 'Zanzibar')).toHaveLength(1);
  });
});

describe('uploaded old bills', () => {
  it('are searchable, listed, and gone when removed', async () => {
    const business = await makeGstBusiness();
    const id = await indexUpload(business.id, 'purana-bill.pdf', ['Bill to Kapoor Dairy\nMilk supply 30 days ₹4,500']);
    expect(id).toMatch(/^upload:/);
    expect((await listUploads(business.id)).map((u) => u.title)).toEqual(['purana-bill.pdf']);
    expect((await searchRecords(business.id, 'Kapoor dairy'))[0]!.kind).toBe('upload');

    expect(await removeUpload(business.id, id!)).toBe(true);
    expect(await listUploads(business.id)).toHaveLength(0);
    expect(await searchRecords(business.id, 'Kapoor')).toHaveLength(0);
  });

  it('cannot be removed by another business', async () => {
    const alpha = await makeGstBusiness();
    const beta = await makeGstBusiness();
    const id = await indexUpload(alpha.id, 'a.pdf', ['Bill to Someone Particular for work']);
    expect(await removeUpload(beta.id, id!)).toBe(false);
    expect(await listUploads(alpha.id)).toHaveLength(1);
  });

  it('keeps nothing when there is no text', async () => {
    const business = await makeGstBusiness();
    expect(await indexUpload(business.id, 'blank.jpg', ['  '])).toBeNull();
  });
});

describe('asking', () => {
  let server: Server;
  const calls: string[] = [];
  let chatAnswer = '';
  let lastChat: { messages: Array<{ role: string; content: string }> } | null = null;

  // A stand-in embedding: words hashed into the vector, so texts sharing words are close.
  const vectorFor = (text: string) => {
    const v = new Array(1536).fill(0);
    for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      let h = 0;
      for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) % 1536;
      v[h] += 1;
    }
    return v;
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        calls.push(req.url ?? '');
        const json = JSON.parse(body || '{}');
        res.setHeader('content-type', 'application/json');
        if (req.url === '/v1/embeddings') {
          res.end(JSON.stringify({ data: (json.input as string[]).map((t, index) => ({ index, embedding: vectorFor(t) })) }));
        } else {
          lastChat = json;
          res.end(JSON.stringify({ choices: [{ message: { content: chatAnswer } }] }));
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    calls.length = 0;
  });

  const useStandIn = () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };

  it('without a key, shows the matching records instead of an answer', async () => {
    const business = await makeGstBusiness();
    await billFor(business, 'Sharma Electricals', 'AMC visit', '3500');
    const r = await askRecords(business.id, 'Sharma AMC rate');
    expect(r.mode).toBe('search');
    expect(r.answer).toBeNull();
    expect(r.sources[0]!.title).toMatch(/Sharma/);
  });

  it('says nothing matched rather than inventing', async () => {
    const business = await makeGstBusiness();
    const r = await askRecords(business.id, 'Qwertyuiop kab aaya');
    expect(r).toMatchObject({ mode: 'nothing', answer: null, sources: [] });
  });

  it('with a key: embeds, answers from numbered records, and renumbers citations to what it shows', async () => {
    useStandIn();
    const business = await makeGstBusiness();
    await billFor(business, 'Mehta Traders', 'Ceiling fan install', '1350');
    await billFor(business, 'Sharma Electricals', 'AMC visit', '3500');

    // Which record number Sharma's bill gets depends on ranking; the stand-in
    // answer cites whichever it is.
    await catchUp(business.id);
    const hits = await searchRecords(business.id, 'Sharma ko AMC ka rate kya diya');
    const n = hits.findIndex((h) => /Sharma/.test(h.title)) + 1;
    chatAnswer = `Sharma ko AMC visit ₹3,500 mein diya tha [${n}].`;

    const r = await askRecords(business.id, 'Sharma ko AMC ka rate kya diya');
    expect(r.mode).toBe('answer');
    expect(n).toBeGreaterThan(0);
    expect(r.answer).toBe('Sharma ko AMC visit ₹3,500 mein diya tha [1].');
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]!.title).toMatch(/Sharma/);
    expect(calls).toContain('/v1/embeddings');
    expect(calls).toContain('/v1/chat/completions');

    // The records go in as data with instructions to answer only from them.
    expect(lastChat!.messages[0]!.content).toMatch(/Use ONLY the numbered records/);
    expect(lastChat!.messages[1]!.content).toMatch(/<records>[\s\S]*Sharma Electricals[\s\S]*<\/records>/);

    const { rows } = await pool().query<{ n: string }>(
      'select count(*) as n from chunks where business_id = $1 and embedding is not null',
      [business.id],
    );
    expect(Number(rows[0]!.n)).toBe(2);
  });
});

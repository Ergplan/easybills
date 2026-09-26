import { NextResponse } from 'next/server';

import type { ImportedCustomer } from '@/lib/import/types';
import { requireBusiness } from '@/server/auth/guard';
import { readFile, type FileReading } from '@/server/import/read-file';
import { listCustomers } from '@/server/repos/customers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export interface ImportReading extends FileReading {
  /** For each customer found, the id of an existing record it matches, if any. */
  existing: Array<string | null>;
}

/**
 * "Purane bills upload karo": up to ten files, read on the spot, nothing
 * stored. What comes back is candidates for the owner to look at; the
 * files themselves are not kept. Uploaded text is data, never instructions.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Bad upload.' }, { status: 400 });
  const businessId = String(form.get('b') ?? '');
  try {
    const { business } = await requireBusiness(businessId);
    const files = form.getAll('files').filter((f): f is File => f instanceof File).slice(0, 10);
    const owner = { gstin: business.gstin, pan: business.pan, phone: business.phone, name: business.legalName };
    const existing = await listCustomers(business.id);

    const readings: ImportReading[] = [];
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let reading: FileReading;
      try {
        reading = await readFile(file.name, bytes, owner);
      } catch {
        reading = { filename: file.name, kind: 'unknown', customers: [], problem: 'unrecognised', pages: 0 };
      }
      readings.push({ ...reading, existing: reading.customers.map((c) => matchExisting(c, existing)) });
    }
    return NextResponse.json({ readings });
  } catch (error) {
    const status = (error as Error)?.name === 'NotAuthorisedError' ? 403 : 500;
    return NextResponse.json({ error: status === 403 ? 'No access.' : 'Could not read the files.' }, { status });
  }
}

function matchExisting(c: ImportedCustomer, existing: Array<{ id: string; name: string; gstin: string | null; phone: string | null }>): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/\(sample\)/g, '').replace(/[^a-z0-9]/g, '');
  const phone = (c.phone ?? '').replace(/\D/g, '').slice(-10);
  for (const e of existing) {
    if (c.gstin && e.gstin && c.gstin === e.gstin) return e.id;
    if (phone && e.phone && e.phone.replace(/\D/g, '').slice(-10) === phone) return e.id;
    if (norm(e.name) && norm(e.name) === norm(c.name)) return e.id;
  }
  return null;
}

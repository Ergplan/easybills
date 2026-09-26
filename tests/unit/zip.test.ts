import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { crc32, zipStore } from '@/lib/zip';

describe('the zip writer', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926');
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('writes an archive another tool can read back, byte for byte', () => {
    const files = [
      { name: 'bikri.csv', data: new TextEncoder().encode('Bill no.,Total\r\nINV-001,2050.00\r\n') },
      { name: 'bills/INV-001.pdf', data: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]) },
    ];
    const zip = zipStore(files, new Date('2026-09-26T10:00:00Z'));
    const dir = mkdtempSync(join(tmpdir(), 'ekbill-zip-'));
    const path = join(dir, 'pack.zip');
    writeFileSync(path, zip);
    // Python's zipfile is the independent reader every machine has.
    const listing = execFileSync('python3', ['-c', `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
for n in z.namelist(): print(n, len(z.read(n)))
`, path]).toString();
    expect(listing.trim().split('\n')).toEqual(['bikri.csv 33', 'bills/INV-001.pdf 8']);
  });
});

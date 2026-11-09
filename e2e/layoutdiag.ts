// TEMPORARY DIAGNOSTIC (2b CI push 6), removed once the cause is known: what layout Chromium has on
// disk after a quit, for projects.e2e.ts:30, which lost the layout across a restart on Windows in
// runs 4 and 5.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Each `"shown":[...]` list in the localStorage database's files, in the order the files hold them. */
export function layoutsOnDisk(dataDir: string): string {
  const dir = join(dataDir, 'Local Storage', 'leveldb');
  try {
    return readdirSync(dir)
      .map((name) => {
        const text = readFileSync(join(dir, name)).toString('latin1');
        const shown = [...text.matchAll(/"shown":\[[^\]]*\]/g)].map((m) => m[0]);
        return `${name}(${text.length} bytes, ${shown.length} layouts, last: ${shown.slice(-2).join(' | ')})`;
      })
      .join('; ');
  } catch (err) {
    return `unreadable: ${(err as Error).message}`;
  }
}

// TEMPORARY DIAGNOSTIC (2b CI push 5), removed once the cause is known. Run 4 lost the layout across
// a restart on Windows once (projects.e2e.ts:76), the symptom plan 2a fixed with a flush at quit. This
// measures how often a localStorage write made before a quit is on disk afterwards, with a project
// open (its manager is a running session at the quit), and the first app's exit code each time.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { cleanUp, launchApp } from './launch';
import { repo } from './tasks';

test.afterEach(cleanUp);
test.skip(process.platform !== 'win32', 'diagnostic for Windows only');

/** Whether any file of Chromium's localStorage database holds `text`. */
function onDisk(dataDir: string, text: string): boolean {
  const dir = join(dataDir, 'Local Storage', 'leveldb');
  try {
    return readdirSync(dir).some((name) => readFileSync(join(dir, name)).includes(Buffer.from(text)));
  } catch {
    return false;
  }
}

test('a localStorage write before a quit is there after it', async () => {
  test.setTimeout(900_000);
  const project = repo();
  const lost: string[] = [];
  for (const delayMs of [0, 0, 6000]) {
    for (let i = 0; i < 8; i++) {
      const first = await launchApp({}, project);
      const mark = `mark-${delayMs}-${i}`;
      await first.page.evaluate((m) => localStorage.setItem('quitprobe', m), mark);
      await first.page.waitForTimeout(delayMs);
      const exited = new Promise<string>((resolve) => first.app.process().once('exit', (code, signal) => resolve(`${code}/${signal}`)));
      const closing = Date.now();
      await first.app.close();
      const exit = await exited;
      const closeMs = Date.now() - closing;
      const found = onDisk(first.dataDir, mark);
      const second = await launchApp({ MAINFRAME_DATA_DIR: first.dataDir }, project);
      const seen = await second.page.evaluate(() => localStorage.getItem('quitprobe'));
      await second.app.close();
      if (seen !== mark) lost.push(`${delayMs}/${i}`);
      console.log(`[quitprobe] delay=${delayMs} i=${i} exit=${exit} closeMs=${closeMs} onDiskBeforeRelaunch=${found} seenAfter=${seen === mark ? 'yes' : String(seen)}`);
    }
  }
  console.log(`[quitprobe] lost: ${lost.length === 0 ? 'none' : lost.join(', ')}`);
});

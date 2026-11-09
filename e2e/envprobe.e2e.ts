// TEMPORARY DIAGNOSTIC (2b CI push 3), removed once the cause is known. Run 2 showed that Electron
// crashes at launch on Windows (exit 0x80000003) when USERPROFILE names an empty folder, and not
// when PATH, HOME or APPDATA do. This asks which parts of a profile folder it needs.
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { cleanUp, launchApp, removeAfterTest } from './launch';

test.afterEach(cleanUp);
test.skip(process.platform !== 'win32', 'diagnostic for Windows only');

test('which profile folder lets Electron launch', async () => {
  test.setTimeout(300_000);
  const profile = (...folders: string[]) => {
    const dir = removeAfterTest(mkdtempSync(join(os.tmpdir(), 'mainframe-e2e-home-')));
    for (const folder of folders) mkdirSync(join(dir, folder), { recursive: true });
    return dir;
  };
  const variants: Record<string, string> = {
    'empty folder': profile(),
    'AppData\\Roaming': profile('AppData\\Roaming'),
    'AppData\\Local': profile('AppData\\Local'),
    'AppData\\Roaming and AppData\\Local': profile('AppData\\Roaming', 'AppData\\Local'),
    'a full skeleton': profile('AppData\\Roaming', 'AppData\\Local', 'AppData\\Local\\Temp', 'Desktop', 'Documents', 'Downloads'),
    'C:\\Users\\Public': 'C:\\Users\\Public',
  };
  for (const [name, userprofile] of Object.entries(variants)) {
    try {
      const { app } = await launchApp({ USERPROFILE: userprofile, ELECTRON_ENABLE_LOGGING: '1' });
      await app.close();
      console.log(`[envprobe] USERPROFILE = ${name}: launched`);
    } catch (err) {
      console.log(`[envprobe] USERPROFILE = ${name}: FAILED ${String((err as Error).message).replace(/\s+/g, ' ').slice(0, 600)}`);
    }
  }
});

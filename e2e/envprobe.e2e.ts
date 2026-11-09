// TEMPORARY DIAGNOSTIC (2b CI push 2), removed once the cause is known: which environment of the
// setup tests' stand-in computer makes Electron crash at launch on Windows (exit 0x80000003).
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { test } from '@playwright/test';
import { findExecutable } from '../src/main/pty/findExecutable';
import { localFiles } from '../src/main/pty/sessionHost';
import { pathKey } from '../src/main/pty/spawnEnv';
import { cleanUp, launchApp, removeAfterTest } from './launch';

test.afterEach(cleanUp);
test.skip(process.platform !== 'win32', 'diagnostic for Windows only');

test('which environment makes Electron crash at launch', async () => {
  test.setTimeout(300_000);
  const home = removeAfterTest(mkdtempSync(join(os.tmpdir(), 'mainframe-e2e-home-')));
  const git = findExecutable('git', { env: process.env as Record<string, string>, cwd: process.cwd(), platform: 'win32', files: localFiles });
  const key = pathKey(process.env, 'win32') ?? 'PATH';
  const restricted = [dirname(process.execPath), ...(git === null ? [] : [dirname(git)])].join(delimiter);
  const system = process.env.SystemRoot ?? 'C:\\Windows';
  console.log(`[envprobe] ${JSON.stringify({ key, restricted, home, system, realPath: process.env[key], userprofile: process.env.USERPROFILE, appdata: process.env.APPDATA, localappdata: process.env.LOCALAPPDATA })}`);
  const variants: Record<string, Record<string, string>> = {
    normal: {},
    'PATH restricted': { [key]: restricted },
    'PATH restricted + System32': { [key]: `${restricted}${delimiter}${system}\\System32${delimiter}${system}` },
    'HOME only': { HOME: home },
    'USERPROFILE only': { USERPROFILE: home },
    'APPDATA only': { APPDATA: home },
    'HOME, USERPROFILE and APPDATA': { HOME: home, USERPROFILE: home, APPDATA: home },
  };
  for (const [name, env] of Object.entries(variants)) {
    try {
      const { app } = await launchApp({ ...env, ELECTRON_ENABLE_LOGGING: '1' });
      await app.close();
      console.log(`[envprobe] ${name}: launched`);
    } catch (err) {
      console.log(`[envprobe] ${name}: FAILED ${String((err as Error).message).replace(/\s+/g, ' ').slice(0, 2500)}`);
    }
  }
});

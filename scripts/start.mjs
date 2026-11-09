// `npm start`: electron-vite's preview, with Chromium's sandbox off only where Linux blocks it.
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { startArgs } from './startArgs.mjs';

const require = createRequire(import.meta.url);

/** What `read` returns, or null when it throws (a file that isn't there, a package that isn't installed). */
function orNull(read) {
  try {
    return read();
  } catch {
    return null;
  }
}

// Electron has no install script: it downloads its binary the first time it is required. electron-vite's
// preview and the sandbox helper below both need that binary on disk, so a fresh clone gets it here.
require('electron');

const restriction = orNull(() => readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8'));
const helper = orNull(() => {
  const { uid, mode } = statSync(join(dirname(require.resolve('electron/package.json')), 'dist', 'chrome-sandbox'));
  return { uid, mode };
});

const args = startArgs(process.platform, restriction, helper);
if (args.includes('--noSandbox')) {
  console.log("Mainframe starts without Chromium's sandbox, because this Linux blocks it. The README says how to keep it.");
}

// electron-vite's `exports` don't expose its bin, so it is found through its package.json.
const packagePath = require.resolve('electron-vite/package.json');
const bin = join(dirname(packagePath), JSON.parse(readFileSync(packagePath, 'utf8')).bin['electron-vite']);
const child = spawnSync(process.execPath, [bin, ...args], { stdio: 'inherit' });
process.exit(child.status ?? 1);

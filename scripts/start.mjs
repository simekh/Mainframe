// `npm start` and `npm run dev`: electron-vite's preview or dev, with Chromium's sandbox off only where
// Linux blocks it. Arguments after the command go on to electron-vite.
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packagesInstalled } from './packagesInstalled.mjs';
import { sandboxFlags } from './sandboxFlags.mjs';

const [command, ...passOn] = process.argv.slice(2);
if (command !== 'preview' && command !== 'dev') {
  console.error('usage: node scripts/start.mjs preview|dev');
  process.exit(1);
}

const require = createRequire(import.meta.url);

/** What `read` returns, or null when it throws (a file that isn't there, a package that isn't installed). */
function orNull(read) {
  try {
    return read();
  } catch {
    return null;
  }
}

// A fresh clone, or a pull that changed package-lock.json, gets its packages installed here rather than
// failing on the first missing one.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const readJson = (path) => orNull(() => JSON.parse(readFileSync(join(root, path), 'utf8')));
if (!packagesInstalled(readJson('package-lock.json'), readJson('node_modules/.package-lock.json'))) {
  // npm sets npm_execpath to its own script when it runs `npm start`; run directly, there is no npm to call.
  const npm = process.env.npm_execpath;
  if (!npm) {
    console.error("Mainframe's packages aren't installed, or are out of date. Run `npm ci`, then start it again.");
    process.exit(1);
  }
  console.log("Installing Mainframe's packages first (npm ci)…");
  const install = spawnSync(process.execPath, [npm, 'ci'], { cwd: root, stdio: 'inherit' });
  if (install.status !== 0) {
    console.error('Installing the packages failed (see above). The README\'s "What you need" lists what it takes.');
    process.exit(install.status ?? 1);
  }
}

// Electron has no install script: it downloads its binary the first time it is required. electron-vite
// and the sandbox helper below both need that binary on disk, so a fresh clone gets it here.
require('electron');

const restriction = orNull(() => readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8'));
const helper = orNull(() => {
  const { uid, mode } = statSync(join(dirname(require.resolve('electron/package.json')), 'dist', 'chrome-sandbox'));
  return { uid, mode };
});

const flags = sandboxFlags(process.platform, restriction, helper);
if (flags.length > 0) {
  console.log("Mainframe starts without Chromium's sandbox, because this Linux blocks it. The README says how to keep it.");
}

// electron-vite's `exports` don't expose its bin, so it is found through its package.json.
const packagePath = require.resolve('electron-vite/package.json');
const bin = join(dirname(packagePath), JSON.parse(readFileSync(packagePath, 'utf8')).bin['electron-vite']);
const child = spawnSync(process.execPath, [bin, command, ...flags, ...passOn], { stdio: 'inherit' });
process.exit(child.status ?? 1);

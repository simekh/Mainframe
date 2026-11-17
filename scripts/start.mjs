// `npm start` and `npm run dev`: electron-vite's preview or dev, with Chromium's sandbox off only where
// Linux blocks it. Arguments after the command go on to electron-vite. `npm start` also applies an update the
// app asks for, then starts Mainframe again.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyUpdate, NO_PROMPTS, RELEASE_TAG } from './applyUpdate.mjs';
import { sandboxFlags } from './sandboxFlags.mjs';

/** The exit code by which the app asks for an update; UPDATE_EXIT_CODE in src/main/updates/updateService.ts. */
const UPDATE_EXIT_CODE = 75;

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

// Only `npm start` updates: the app leaves the release tag in this file and exits with UPDATE_EXIT_CODE. A fresh
// path each run, so a file left over from an earlier one is never read. `npm run dev` gets none, never even an
// inherited one.
const updateFile = command === 'preview' ? join(tmpdir(), `mainframe-update-${randomUUID()}`) : '';
const child = spawnSync(process.execPath, [bin, command, ...flags, ...passOn], {
  stdio: 'inherit',
  env: { ...process.env, MAINFRAME_UPDATE_FILE: updateFile },
});
const tag = updateFile ? orNull(() => readFileSync(updateFile, 'utf8').trim()) : null;
if (updateFile) rmSync(updateFile, { force: true });
if (!updateFile || child.status !== UPDATE_EXIT_CODE) process.exit(child.status ?? 1);

// With Mainframe closed, so Windows has no files locked: move to the release, then start it again through the
// updated copy of this script. The app shows a failure at its next start; an empty value means none.
const failure = update(tag);
if (failure) {
  console.error(`The update didn't finish: ${failure.message}`);
  if (failure.stage === 'install') console.error('To finish by hand, run `npm install`, then `npm start`.');
}
const again = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'preview', ...passOn], {
  stdio: 'inherit',
  env: { ...process.env, MAINFRAME_UPDATE_FAILED: failure?.message ?? '' },
});
process.exit(again.status ?? 1);

/** Updates this clone to `tag`; what went wrong ({ stage, message }), or null. */
function update(tag) {
  if (!tag || !RELEASE_TAG.test(tag)) {
    return { stage: 'fetch', message: 'Mainframe asked for an update but left no release to update to.' };
  }
  console.log(`Updating Mainframe to ${tag}…`);
  const dir = fileURLToPath(new URL('..', import.meta.url));
  const result = applyUpdate(dir, tag, (cmd, args) =>
    cmd === 'npm'
      ? // npm is npm.cmd on Windows, which Node runs only through a shell. A shell takes one command line (Node
        // warns at a list of arguments); applyUpdate's are fixed words.
        spawnSync([process.platform === 'win32' ? 'npm.cmd' : 'npm', ...args].join(' '), {
          cwd: dir,
          stdio: 'inherit',
          shell: true,
        })
      : // git talks to the remote here: it fails rather than ask for a password, and gives up after 30 s.
        spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...NO_PROMPTS }, timeout: 30_000 }),
  );
  return result.ok ? null : result;
}

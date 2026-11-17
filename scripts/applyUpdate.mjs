// What `npm start` does when Mainframe quits to update: move this clone to the release tag and install its packages.
// A small copy of the app's rules in src/main/updates/updateGit.ts, which a script can't import.
import { execFileSync } from 'node:child_process';

/** Git that never asks anyone anything, as NO_PROMPTS in src/main/git.ts. The caller's `run` gives it this env. */
export const NO_PROMPTS = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
  GCM_INTERACTIVE: 'false',
  SSH_ASKPASS_REQUIRE: 'never',
};

/** A release tag as the app writes it. Anything else never reaches git. */
export const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

/** A read-only git query's output; '' when git exits non-zero (a config key that isn't set, a detached HEAD). */
function read(dir, args) {
  try {
    // Only the end is trimmed: a porcelain status line starts with a meaningful space.
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe' }).trimEnd();
  } catch {
    return '';
  }
}

/** The current branch's remote, else `origin` when there is one; null when neither. */
function releaseRemote(dir) {
  const branch = read(dir, ['symbolic-ref', '--short', '-q', 'HEAD']);
  const configured = branch && read(dir, ['config', '--get', `branch.${branch}.remote`]);
  if (configured) return configured;
  return read(dir, ['remote']).split('\n').includes('origin') ? 'origin' : null;
}

/**
 * Fetches `tag`, fast-forwards to it and runs `npm install`. `run` runs a command in `dir` and returns its exit
 * status: git's calls name `dir` with -C, and npm's need `dir` as the working folder.
 */
export function applyUpdate(dir, tag, run) {
  const ok = (cmd, args) => run(cmd, args).status === 0;
  const remote = releaseRemote(dir);
  if (!remote) return { ok: false, stage: 'fetch', message: `this clone has no remote to fetch ${tag} from.` };

  const fetch = ['-C', dir, '-c', 'credential.interactive=false', 'fetch', '--quiet', remote];
  if (!ok('git', [...fetch, `refs/tags/${tag}:refs/tags/${tag}`])) {
    return { ok: false, stage: 'fetch', message: `git could not fetch ${tag} from ${remote}. Nothing was changed.` };
  }

  // `npm install` can rewrite the lockfile on its own; that alone doesn't stop an update. Restored from HEAD, so a
  // staged rewrite goes too. Only once the fetch worked, so a failed fetch leaves the file as it was.
  const changed = read(dir, ['status', '--porcelain', '--untracked-files=no']).split('\n').filter(Boolean);
  if (changed.length === 1 && changed[0].slice(3) === 'package-lock.json') {
    if (!ok('git', ['-C', dir, 'checkout', 'HEAD', '--', 'package-lock.json'])) {
      return { ok: false, stage: 'merge', message: 'git could not restore package-lock.json. Nothing was changed.' };
    }
  }
  if (!ok('git', ['-C', dir, 'merge', '--ff-only', '--quiet', `refs/tags/${tag}`])) {
    return { ok: false, stage: 'merge', message: `git could not fast-forward to ${tag}. Nothing was changed.` };
  }
  if (!ok('npm', ['install'])) {
    return { ok: false, stage: 'install', message: `Mainframe is on ${tag}, but npm install failed.` };
  }
  return { ok: true };
}

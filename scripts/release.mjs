// `npm run release`: cuts a release of this clone. It moves the notes under `## Unreleased` in CHANGELOG.md to a
// `## <version> · <date>` section, commits that, tags it `v<version>` and pushes both to the branch's remote.
// The app reads those two things (the tag and the heading) to tell users about the release.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

// Numbers without leading zeros, as the app's parseTag reads them.
const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parts = (match) => match.slice(1).map(Number);

function isNewer(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** The version to release: `explicit` when given (it must be x.y.z and newer than the newest tag), else a minor bump when the notes have a `New:` line, else a patch bump. */
export function nextVersion(newestTag, unreleased, explicit) {
  const base = newestTag === null ? null : parts(TAG.exec(newestTag) ?? []);
  if (explicit !== undefined) {
    const match = VERSION.exec(explicit);
    if (!match) throw new Error(`"${explicit}" is not a version like 1.2.3.`);
    if (base && !isNewer(parts(match), base)) throw new Error(`${explicit} is not newer than ${newestTag}.`);
    return explicit;
  }
  if (!base) return '0.1.0';
  const [major, minor, patch] = base;
  return /^New:/m.test(unreleased) ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

/** Where the Unreleased section's lines are, as indexes into `lines`: [heading, end), the end being the next `## ` heading or the end of the file. */
function unreleasedRange(lines) {
  const heading = lines.findIndex((line) => /^##\s+Unreleased\s*$/i.test(line));
  if (heading < 0) return null;
  let end = lines.findIndex((line, i) => i > heading && /^##\s/.test(line));
  if (end < 0) end = lines.length;
  return [heading, end];
}

/** The notes under `## Unreleased`, without blank lines around them; '' when there are none. */
export function unreleasedNotes(changelog) {
  const lines = changelog.split('\n');
  const range = unreleasedRange(lines);
  return range ? lines.slice(range[0] + 1, range[1]).join('\n').trim() : '';
}

/** Renames `## Unreleased` to `## <version> · <date>`, with a new, empty `## Unreleased` above it. */
export function cutRelease(changelog, version, date) {
  const lines = changelog.split('\n');
  const range = unreleasedRange(lines);
  if (!range) throw new Error('CHANGELOG.md has no "## Unreleased" section.');
  lines.splice(range[0], 1, '## Unreleased', '', `## ${version} · ${date}`);
  return { changelog: lines.join('\n') };
}

/**
 * The remote's repository as gh's `--repo` takes it, `github.com/OWNER/REPO`, from an https or ssh URL
 * (`https://github.com/o/r.git`, `git@github.com:o/r.git`, `ssh://git@github.com/o/r`). Null when it is not on github.com.
 */
export function githubRepo(url) {
  const match = /^(?:https?:\/\/|ssh:\/\/)?(?:[^@/]+@)?github\.com(?::\d+)?[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url);
  return match ? `github.com/${match[1]}/${match[2]}` : null;
}

/** `17 Nov 2026`, the date format the app's changelog parser expects. */
function formatDate(now) {
  return `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}

/** Git that never prompts, as NO_PROMPTS in src/main/git.ts. A terminal's credential helpers still work. */
const REMOTE_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
const REMOTE_FLAGS = ['-c', 'credential.interactive=false'];

function git(args, { remote = false } = {}) {
  return execFileSync('git', [...(remote ? REMOTE_FLAGS : []), ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
    env: remote ? REMOTE_ENV : process.env,
  }).trim();
}

function gitOrEmpty(args) {
  try {
    return git(args);
  } catch {
    return '';
  }
}

/** The newest plain v<x.y.z> tag, or null. Pre-release tags such as v1.0.0-rc.1 don't count. */
function newestTag() {
  const tags = git(['tag', '--list', 'v*']).split('\n').filter((tag) => TAG.test(tag));
  tags.sort((a, b) => (isNewer(parts(TAG.exec(a)), parts(TAG.exec(b))) ? 1 : -1));
  return tags.length ? tags[tags.length - 1] : null;
}

function ghAvailable() {
  return spawnSync('gh', ['--version'], { stdio: 'ignore' }).status === 0;
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.find((arg) => arg.startsWith('-') && arg !== '--yes');
  if (unknown) throw new Error(`Unknown option ${unknown}. The only option is --yes.`);
  const yes = args.includes('--yes');
  const explicit = args.find((arg) => !arg.startsWith('-'));

  const root = git(['rev-parse', '--show-toplevel']);
  process.chdir(root);

  const branch = gitOrEmpty(['symbolic-ref', '--short', 'HEAD']);
  if (!branch) throw new Error('HEAD is not on a branch.');
  // `.` is a branch that tracks a local branch: there is nothing to push to.
  const remote = gitOrEmpty(['config', `branch.${branch}.remote`]);
  const mergeRef = gitOrEmpty(['config', `branch.${branch}.merge`]);
  if (!remote || remote === '.' || !mergeRef) {
    throw new Error(`Branch ${branch} has no upstream. Set one with git branch --set-upstream-to.`);
  }
  if (git(['status', '--porcelain', '--untracked-files=no'])) {
    throw new Error('There are uncommitted changes. Commit or stash them first.');
  }
  try {
    git(['fetch', '--quiet', remote], { remote: true });
  } catch (error) {
    throw new Error(`Could not fetch ${remote}: ${String(error.stderr ?? error.message).trim()}`);
  }
  const upstreamName = mergeRef.replace(/^refs\/heads\//, '');
  if (!gitOrEmpty(['rev-parse', '--verify', '--quiet', '@{upstream}'])) {
    throw new Error(`The upstream of ${branch}, ${upstreamName}, is not on ${remote}. Set another with git branch --set-upstream-to.`);
  }
  const [behind, ahead] = git(['rev-list', '--left-right', '--count', '@{upstream}...HEAD']).split(/\s+/).map(Number);
  if (behind) throw new Error(`${branch} is ${behind} commit(s) behind its upstream. Pull first.`);
  if (ahead) {
    throw new Error(`${branch} is ${ahead} commit(s) ahead of its upstream. Push or review them first: a release only pushes its own commit and tag.`);
  }

  const changelog = readFileSync('CHANGELOG.md', 'utf8');
  const unreleased = unreleasedNotes(changelog);
  if (!unreleased) throw new Error('There are no notes under "## Unreleased" in CHANGELOG.md.');

  const version = nextVersion(newestTag(), unreleased, explicit);
  const tag = `v${version}`;
  if (gitOrEmpty(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`])) throw new Error(`Tag ${tag} already exists.`);

  const cut = cutRelease(changelog, version, formatDate(new Date()));
  console.log(`Release ${version}\n\n${unreleased}\n`);
  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Release ${version}? [y/N] `);
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) throw new Error('Cancelled.');
  }

  writeFileSync('CHANGELOG.md', cut.changelog);
  git(['commit', '--quiet', '-m', `Release ${version}`, '--', 'CHANGELOG.md']);
  git(['tag', '-a', tag, '-m', `Mainframe ${version}`]);
  // Atomic: the branch and the tag both land, or neither does.
  try {
    git(['push', '--quiet', '--atomic', remote, `HEAD:${mergeRef}`, tag], { remote: true });
  } catch (error) {
    throw new Error(`Committed and tagged ${tag} locally, but the push failed: ${String(error.stderr ?? error.message).trim()}\nRun: git push --atomic ${remote} HEAD:${mergeRef} ${tag}`);
  }
  console.log(`Released ${version}: pushed ${upstreamName} and ${tag} to ${remote}.`);

  const repo = githubRepo(gitOrEmpty(['remote', 'get-url', remote]));
  if (!repo || !ghAvailable()) {
    console.log('Skipped the GitHub Release: the remote is not on GitHub, or gh is not installed.');
    return;
  }
  // On the remote just pushed to, not gh's default repository, and for the tag just pushed: never one gh would create.
  const ghArgs = ['release', 'create', tag, '--repo', repo, '--verify-tag', '--title', version, '--notes-file', '-'];
  const result = spawnSync('gh', ghArgs, {
    input: unreleased,
    encoding: 'utf8',
  });
  if (result.status === 0) console.log(`Created the GitHub Release for ${tag}.`);
  else console.log(`The GitHub Release was not created (gh exited ${result.status}): ${(result.stderr || '').trim()}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

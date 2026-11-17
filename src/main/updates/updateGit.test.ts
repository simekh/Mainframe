import { join, dirname } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { cloneRepo, commitFile, git, makeRepo } from '../testing/makeRepo';
import { byHand, changelogAt, howToUpdate, onlyLockfileChanged, releaseRemote, remoteNewest, runningVersion } from './updateGit';

const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function release(maintainer: string, tag: string, changelog?: string): void {
  commitFile(maintainer, 'CHANGELOG.md', changelog ?? `## ${tag.slice(1)}\n\nNotes.\n`);
  git(maintainer, 'tag', tag);
  git(maintainer, 'push', 'origin', 'stage', tag);
}

/** The maintainer's clone with v0.2.0 released, and the user's clone of it. */
function setup(): { maintainer: string; user: string } {
  const { origin, main } = makeRepo();
  cleanup.push(dirname(origin));
  commitFile(main, 'package-lock.json', '{}\n');
  commitFile(main, 'package.json', '{}\n');
  release(main, 'v0.2.0');
  const user = join(dirname(origin), 'user');
  cloneRepo(origin, user);
  return { maintainer: main, user };
}

it('runningVersion is null without tags, and the newest release tag merged into HEAD otherwise', async () => {
  const { origin, main } = makeRepo();
  cleanup.push(dirname(origin));
  expect(await runningVersion(main)).toBeNull();
  git(main, 'tag', 'v0.1.0');
  commitFile(main, 'a.txt', 'a');
  git(main, 'tag', 'v0.2.0');
  commitFile(main, 'b.txt', 'b');
  git(main, 'tag', 'v0.3.0-beta.1');
  expect(await runningVersion(main)).toEqual([0, 2, 0]);
  commitFile(main, 'c.txt', 'c');
  expect(await runningVersion(main)).toEqual([0, 2, 0]);
});

it('releaseRemote is the current branch\'s remote, and null without any', async () => {
  const { user } = setup();
  expect(await releaseRemote(user)).toBe('origin');
  const bare = mkdtempSync(join(tmpdir(), 'mainframe-norepo-'));
  cleanup.push(bare);
  git(bare, 'init');
  expect(await releaseRemote(bare)).toBeNull();
});

it('releaseRemote falls back to origin when the branch tracks nothing', async () => {
  const { user } = setup();
  git(user, 'checkout', '-b', 'local-only', '--no-track');
  expect(await releaseRemote(user)).toBe('origin');
});

it('remoteNewest sees a release pushed after the user cloned', async () => {
  const { maintainer, user } = setup();
  expect(await remoteNewest(user, 'origin')).toEqual([0, 2, 0]);
  release(maintainer, 'v0.3.0');
  expect(await remoteNewest(user, 'origin')).toEqual([0, 3, 0]);
});

it('remoteNewest rejects for a remote that cannot be reached', async () => {
  const { user } = setup();
  git(user, 'remote', 'set-url', 'origin', join(dirname(user), 'does-not-exist'));
  await expect(remoteNewest(user, 'origin')).rejects.toThrow();
});

it('changelogAt returns the changelog as of the tag, and null when the tag has none', async () => {
  const { maintainer, user } = setup();
  release(maintainer, 'v0.3.0', '## 0.3.0\n\nNew.\n');
  expect(await changelogAt(user, 'origin', 'v0.3.0')).toBe('## 0.3.0\n\nNew.\n');

  git(maintainer, 'rm', 'CHANGELOG.md');
  git(maintainer, 'commit', '-m', 'drop changelog');
  git(maintainer, 'tag', 'v0.4.0');
  git(maintainer, 'push', 'origin', 'stage', 'v0.4.0');
  expect(await changelogAt(user, 'origin', 'v0.4.0')).toBeNull();
});

it('changelogAt rejects when the fetch fails', async () => {
  const { user } = setup();
  git(user, 'remote', 'set-url', 'origin', join(dirname(user), 'does-not-exist'));
  await expect(changelogAt(user, 'origin', 'v0.3.0')).rejects.toThrow();
});

const BY_HAND = ['git fetch origin tag v0.3.0', 'git merge --ff-only v0.3.0', 'npm install', 'npm start'];

async function behind(): Promise<string> {
  const { maintainer, user } = setup();
  release(maintainer, 'v0.3.0');
  await changelogAt(user, 'origin', 'v0.3.0');
  return user;
}

it('howToUpdate is one click for a clean clone', async () => {
  const user = await behind();
  expect(await howToUpdate(user, 'origin', 'v0.3.0')).toEqual({ kind: 'one-click' });
});

it('byHand fast-forwards when the app was not started by npm start', () => {
  expect(byHand('origin', 'v0.3.0', 'not-launcher')).toEqual({ kind: 'by-hand', why: 'not-launcher', commands: BY_HAND });
});

it('howToUpdate is by hand with uncommitted changes', async () => {
  const user = await behind();
  writeFileSync(join(user, 'README.md'), 'edited\n');
  expect(await howToUpdate(user, 'origin', 'v0.3.0')).toEqual({ kind: 'by-hand', why: 'uncommitted', commands: BY_HAND });
});

it('howToUpdate lets a lone package-lock.json change through, but not with package.json', async () => {
  const user = await behind();
  writeFileSync(join(user, 'package-lock.json'), '{"a":1}\n');
  expect(await howToUpdate(user, 'origin', 'v0.3.0')).toEqual({ kind: 'one-click' });
  writeFileSync(join(user, 'package.json'), '{"a":1}\n');
  expect((await howToUpdate(user, 'origin', 'v0.3.0')) as { why: string }).toMatchObject({ why: 'uncommitted' });
});

it('howToUpdate is by hand with a plain merge for commits of the user\'s own', async () => {
  const user = await behind();
  commitFile(user, 'mine.txt', 'mine');
  const how = await howToUpdate(user, 'origin', 'v0.3.0');
  expect(how).toEqual({
    kind: 'by-hand',
    why: 'own-commits',
    commands: ['git fetch origin tag v0.3.0', 'git merge v0.3.0', 'npm install', 'npm start'],
  });
});

it('onlyLockfileChanged is true only for a lone package-lock.json line', () => {
  expect(onlyLockfileChanged(' M package-lock.json\n')).toBe(true);
  expect(onlyLockfileChanged('M  package-lock.json\n')).toBe(true);
  expect(onlyLockfileChanged('')).toBe(false);
  expect(onlyLockfileChanged(' M package.json\n')).toBe(false);
  expect(onlyLockfileChanged(' M package-lock.json\n M README.md\n')).toBe(false);
  expect(onlyLockfileChanged(' M sub/package-lock.json\n')).toBe(false);
});

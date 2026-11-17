import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyUpdate } from './applyUpdate.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' }).trim();

function cloneAs(origin, dir) {
  git('clone', '--quiet', origin, dir);
  git('-C', dir, 'config', 'user.name', 'Test');
  git('-C', dir, 'config', 'user.email', 'test@example.com');
  git('-C', dir, 'config', 'commit.gpgsign', 'false');
}

function commit(dir, file, text, message) {
  writeFileSync(join(dir, file), text);
  git('-C', dir, 'add', file);
  git('-C', dir, 'commit', '--quiet', '-m', message);
}

let root;
let user;
let npmCalls;
let npmStatus;

/** Runs git for real; records npm and answers with npmStatus. */
function run(cmd, args) {
  if (cmd === 'git') return { status: spawnSync('git', args, { stdio: 'pipe' }).status };
  npmCalls.push([cmd, args]);
  return { status: npmStatus };
}

// A remote with releases v0.1.0 and v0.2.0, and a user's clone made at v0.1.0 that hasn't fetched v0.2.0.
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mainframe-update-'));
  const origin = join(root, 'origin.git');
  const dev = join(root, 'dev');
  user = join(root, 'user');
  git('init', '--quiet', '--bare', '-b', 'trunk', origin);
  cloneAs(origin, dev);
  commit(dev, 'package-lock.json', '{"v":1}\n', 'first');
  git('-C', dev, 'tag', '-a', 'v0.1.0', '-m', 'v0.1.0');
  git('-C', dev, 'push', '--quiet', 'origin', 'trunk', 'v0.1.0');
  cloneAs(origin, user);
  commit(dev, 'package-lock.json', '{"v":2}\n', 'second');
  git('-C', dev, 'tag', '-a', 'v0.2.0', '-m', 'v0.2.0');
  git('-C', dev, 'push', '--quiet', 'origin', 'trunk', 'v0.2.0');
  npmCalls = [];
  npmStatus = 0;
});

afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const head = () => git('-C', user, 'rev-parse', 'HEAD');
const release = () => git('-C', user, 'rev-parse', 'v0.2.0^{commit}');

describe('applyUpdate', () => {
  it('fetches the release, fast-forwards to it and runs npm install once', () => {
    expect(applyUpdate(user, 'v0.2.0', run)).toEqual({ ok: true });
    expect(head()).toBe(release());
    expect(npmCalls).toEqual([['npm', ['install']]]);
  });

  it('restores a lockfile that is the only change, then fast-forwards', () => {
    writeFileSync(join(user, 'package-lock.json'), '{"rewritten":true}\n');
    expect(applyUpdate(user, 'v0.2.0', run)).toEqual({ ok: true });
    expect(head()).toBe(release());
    expect(git('-C', user, 'status', '--porcelain', '--untracked-files=no')).toBe('');
  });

  it('restores a staged lockfile change too', () => {
    writeFileSync(join(user, 'package-lock.json'), '{"rewritten":true}\n');
    git('-C', user, 'add', 'package-lock.json');
    expect(applyUpdate(user, 'v0.2.0', run)).toEqual({ ok: true });
    expect(head()).toBe(release());
    expect(git('-C', user, 'status', '--porcelain', '--untracked-files=no')).toBe('');
  });

  it('changes nothing and skips npm when the branch has a commit of its own', () => {
    commit(user, 'mine.txt', 'mine\n', 'my own');
    const before = head();
    expect(applyUpdate(user, 'v0.2.0', run)).toMatchObject({ ok: false, stage: 'merge' });
    expect(head()).toBe(before);
    expect(npmCalls).toEqual([]);
  });

  it('says the install failed, after the fast-forward', () => {
    npmStatus = 1;
    expect(applyUpdate(user, 'v0.2.0', run)).toMatchObject({ ok: false, stage: 'install' });
    expect(head()).toBe(release());
  });
});

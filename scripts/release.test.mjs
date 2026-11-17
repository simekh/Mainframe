import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cutRelease, nextVersion, unreleasedNotes } from './release.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'release.mjs');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' }).trim();
const which = (tool) => execFileSync(process.platform === 'win32' ? 'where' : 'which', [tool], { encoding: 'utf8' }).split(/\r?\n/)[0];

describe('nextVersion', () => {
  it('starts at 0.1.0 without a tag', () => {
    expect(nextVersion(null, 'Fixed: x')).toBe('0.1.0');
  });
  it('bumps the minor for a New: line', () => {
    expect(nextVersion('v0.4.0', 'New: x\nFixed: y')).toBe('0.5.0');
  });
  it('bumps the patch for fixes only', () => {
    expect(nextVersion('v0.4.0', 'Fixed: y')).toBe('0.4.1');
  });
  it('takes an explicit version above the newest', () => {
    expect(nextVersion('v0.4.0', 'Fixed: y', '1.0.0')).toBe('1.0.0');
  });
  it('refuses an explicit version that is not newer or not x.y.z', () => {
    expect(() => nextVersion('v0.4.0', 'Fixed: y', '0.3.0')).toThrow();
    expect(() => nextVersion('v0.4.0', 'Fixed: y', '0.4.0')).toThrow();
    expect(() => nextVersion('v0.4.0', 'Fixed: y', '1.0')).toThrow();
  });
});

describe('unreleasedNotes and cutRelease', () => {
  const log = '# Changelog\n\n## Unreleased\n\nNew: a\nFixed: b\n\n## 0.4.0 · 1 Nov 2026\n\nNew: old\n';
  it('returns the section lines', () => {
    expect(unreleasedNotes(log)).toBe('New: a\nFixed: b');
  });
  it('is empty for an empty section', () => {
    expect(unreleasedNotes('# Changelog\n\n## Unreleased\n\n## 0.4.0 · 1 Nov 2026\n\nNew: old\n')).toBe('');
    expect(unreleasedNotes('# Changelog\n\n## Unreleased\n')).toBe('');
  });
  it('renames the section, puts an empty Unreleased above it, and returns the notes', () => {
    const out = cutRelease(log, '0.5.0', '17 Nov 2026');
    expect(out.notes).toBe('New: a\nFixed: b');
    expect(out.changelog).toBe(
      '# Changelog\n\n## Unreleased\n\n## 0.5.0 · 17 Nov 2026\n\nNew: a\nFixed: b\n\n## 0.4.0 · 1 Nov 2026\n\nNew: old\n',
    );
  });
});

describe('release.mjs', () => {
  let root, origin, dev, binDir;
  const run = (dir, ...args) =>
    spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: binDir } });
  const commit = (dir, file, text, msg) => {
    writeFileSync(join(dir, file), text);
    git('-C', dir, 'add', file);
    git('-C', dir, 'commit', '--quiet', '-m', msg);
  };
  const clone = (dir) => {
    git('clone', '--quiet', origin, dir);
    git('-C', dir, 'config', 'user.name', 'Test');
    git('-C', dir, 'config', 'user.email', 'test@example.com');
    git('-C', dir, 'config', 'commit.gpgsign', 'false');
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mainframe-release-'));
    // A PATH with git but no gh.
    binDir = join(root, 'bin');
    mkdirSync(binDir);
    symlinkSync(which('git'), join(binDir, 'git'));
    origin = join(root, 'origin.git');
    dev = join(root, 'dev');
    git('init', '--quiet', '--bare', '-b', 'trunk', origin);
    clone(dev);
    commit(dev, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n\nNew: a thing.\n', 'first');
    git('-C', dev, 'push', '--quiet', 'origin', 'HEAD:trunk');
    git('-C', dev, 'branch', '--set-upstream-to=origin/trunk');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

  it('cuts the release: a Markdown-only commit, an annotated tag, both on the remote', () => {
    const r = run(dev, '--yes');
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(git('-C', dev, 'cat-file', '-t', 'v0.1.0')).toBe('tag');
    expect(git('-C', dev, 'show', '--name-only', '--format=%s', 'HEAD')).toBe('Release 0.1.0\n\nCHANGELOG.md');
    expect(git('-C', origin, 'rev-parse', 'trunk')).toBe(git('-C', dev, 'rev-parse', 'HEAD'));
    expect(git('-C', origin, 'cat-file', '-t', 'v0.1.0')).toBe('tag');
    expect(readFileSync(join(dev, 'CHANGELOG.md'), 'utf8')).toMatch(
      /## Unreleased\n\n## 0\.1\.0 · \d+ \w{3} \d{4}\n\nNew: a thing\./,
    );
    expect(r.stdout).toMatch(/skipp\w+ the GitHub Release/i);
  });

  it('advances the upstream branch when the local branch has another name', () => {
    git('-C', dev, 'checkout', '--quiet', '-b', 'foo');
    git('-C', dev, 'branch', '--set-upstream-to=origin/trunk');
    const r = run(dev, '--yes');
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(git('-C', origin, 'rev-parse', 'trunk')).toBe(git('-C', dev, 'rev-parse', 'HEAD'));
    expect(git('-C', origin, 'branch', '--list', 'foo')).toBe('');
  });

  it('refuses an empty Unreleased', () => {
    commit(dev, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n', 'empty');
    git('-C', dev, 'push', '--quiet', 'origin', 'HEAD:trunk');
    const r = run(dev, '--yes');
    expect(r.status).not.toBe(0);
    expect(git('-C', origin, 'tag')).toBe('');
  });

  it('refuses uncommitted changes', () => {
    writeFileSync(join(dev, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\nNew: edited.\n');
    const r = run(dev, '--yes');
    expect(r.status).not.toBe(0);
    expect(git('-C', origin, 'tag')).toBe('');
  });

  it('refuses when behind', () => {
    const other = join(root, 'other');
    clone(other);
    commit(other, 'x.txt', 'x\n', 'more');
    git('-C', other, 'push', '--quiet', 'origin', 'HEAD:trunk');
    const r = run(dev, '--yes');
    expect(r.status).not.toBe(0);
    expect(git('-C', origin, 'tag')).toBe('');
  });

  it('refuses when ahead, so a release never pushes other commits', () => {
    commit(dev, 'x.txt', 'x\n', 'mine');
    const before = git('-C', origin, 'rev-parse', 'trunk');
    const r = run(dev, '--yes');
    expect(r.status).not.toBe(0);
    expect(git('-C', origin, 'rev-parse', 'trunk')).toBe(before);
    expect(git('-C', origin, 'tag')).toBe('');
  });
});

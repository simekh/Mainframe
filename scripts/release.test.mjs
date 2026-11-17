import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cutRelease, githubRepo, nextVersion, unreleasedNotes } from './release.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'release.mjs');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' }).trim();

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
    expect(() => nextVersion('v0.4.0', 'Fixed: y', '1.02.0')).toThrow();
    expect(() => nextVersion('v0.4.0', 'Fixed: y', '01.2.3')).toThrow();
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
  it('renames the section and puts an empty Unreleased above it', () => {
    const out = cutRelease(log, '0.5.0', '17 Nov 2026');
    expect(out.changelog).toBe(
      '# Changelog\n\n## Unreleased\n\n## 0.5.0 · 17 Nov 2026\n\nNew: a\nFixed: b\n\n## 0.4.0 · 1 Nov 2026\n\nNew: old\n',
    );
  });
});

describe('githubRepo', () => {
  it('reads HOST/OWNER/REPO from https and ssh remote URLs', () => {
    expect(githubRepo('https://github.com/acme/tool.git')).toBe('github.com/acme/tool');
    expect(githubRepo('https://github.com/acme/tool')).toBe('github.com/acme/tool');
    expect(githubRepo('https://me@github.com/acme/tool.git/')).toBe('github.com/acme/tool');
    expect(githubRepo('git@github.com:acme/tool.git')).toBe('github.com/acme/tool');
    expect(githubRepo('ssh://git@github.com/acme/tool.git')).toBe('github.com/acme/tool');
    expect(githubRepo('ssh://git@github.com:22/acme/tool')).toBe('github.com/acme/tool');
  });
  it('is null for a remote that is not on github.com', () => {
    expect(githubRepo('/tmp/origin.git')).toBeNull();
    expect(githubRepo('C:\\repos\\origin.git')).toBeNull();
    expect(githubRepo('https://gitlab.com/acme/tool.git')).toBeNull();
    expect(githubRepo('git@notgithub.com:acme/tool.git')).toBeNull();
    expect(githubRepo('https://github.com/acme')).toBeNull();
  });
});

describe('release.mjs', () => {
  // The remotes are local paths, so no run here reaches GitHub, whether or not gh is installed.
  let root, origin, dev;
  const run = (dir, ...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8' });
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
    expect(r.stderr).toMatch(/no notes under "## Unreleased"/);
    expect(git('-C', origin, 'tag')).toBe('');
  });

  it('refuses uncommitted changes', () => {
    writeFileSync(join(dev, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\nNew: edited.\n');
    const r = run(dev, '--yes');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/uncommitted changes/);
    expect(git('-C', origin, 'tag')).toBe('');
  });

  it('refuses when behind', () => {
    const other = join(root, 'other');
    clone(other);
    commit(other, 'x.txt', 'x\n', 'more');
    git('-C', other, 'push', '--quiet', 'origin', 'HEAD:trunk');
    const r = run(dev, '--yes');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/1 commit\(s\) behind its upstream/);
    expect(git('-C', origin, 'tag')).toBe('');
  });

  it('refuses when ahead, so a release never pushes other commits', () => {
    commit(dev, 'x.txt', 'x\n', 'mine');
    const before = git('-C', origin, 'rev-parse', 'trunk');
    const r = run(dev, '--yes');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/1 commit\(s\) ahead of its upstream/);
    expect(git('-C', origin, 'rev-parse', 'trunk')).toBe(before);
    expect(git('-C', origin, 'tag')).toBe('');
  });

  it('refuses an option it does not know, before doing anything', () => {
    const r = run(dev, '--dry-run');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Unknown option --dry-run/);
    expect(git('-C', dev, 'tag')).toBe('');
    expect(git('-C', dev, 'log', '--format=%s')).toBe('first');
  });

  it('refuses plainly when the upstream branch is not on the remote', () => {
    git('-C', dev, 'config', 'branch.trunk.merge', 'refs/heads/gone');
    const r = run(dev, '--yes');
    expect(r.status).not.toBe(0);
    expect(r.stderr.trim()).toBe('The upstream of trunk, gone, is not on origin. Set another with git branch --set-upstream-to.');
    expect(git('-C', origin, 'tag')).toBe('');
  });

  it('counts a branch that tracks a local branch as having no upstream', () => {
    git('-C', dev, 'checkout', '--quiet', '-b', 'foo', '--track', 'trunk');
    const r = run(dev, '--yes');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Branch foo has no upstream/);
    expect(git('-C', origin, 'tag')).toBe('');
  });
});

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Runs git in `dir`. */
export function git(dir: string, ...args: string[]): void {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
}

/** Writes `name` in `dir` and commits it. */
export function commitFile(dir: string, name: string, content: string): void {
  writeFileSync(join(dir, name), content);
  git(dir, 'add', name);
  git(dir, 'commit', '-m', `add ${name}`);
}

/** Clones `origin` to `dir`, with a committer set and signing off. */
export function cloneRepo(origin: string, dir: string): void {
  execFileSync('git', ['clone', origin, dir], { stdio: 'pipe' });
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
}

/**
 * A bare `origin.git` whose only branch is `stage`, and its clone `main` with one commit
 * pushed and `origin/HEAD` set. The caller removes the parent folder of the two paths.
 */
export function makeRepo(): { origin: string; main: string } {
  const root = mkdtempSync(join(tmpdir(), 'mainframe-repo-'));
  const origin = join(root, 'origin.git');
  const main = join(root, 'main');
  execFileSync('git', ['init', '--bare', '-b', 'stage', origin], { stdio: 'pipe' });
  cloneRepo(origin, main);
  writeFileSync(join(main, 'README.md'), 'hi\n');
  git(main, 'add', 'README.md');
  git(main, 'commit', '-m', 'initial');
  git(main, 'push', 'origin', 'stage');
  git(main, 'remote', 'set-head', 'origin', 'stage');
  return { origin, main };
}

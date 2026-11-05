import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function git(...args: string[]): void {
  execFileSync('git', args, { stdio: 'pipe' });
}

/**
 * A bare `origin.git` whose only branch is `stage`, and its clone `main` with one commit
 * pushed and `origin/HEAD` set. The caller removes the parent folder of the two paths.
 */
export function makeRepo(): { origin: string; main: string } {
  const root = mkdtempSync(join(tmpdir(), 'thesource-repo-'));
  const origin = join(root, 'origin.git');
  const main = join(root, 'main');
  git('init', '--bare', '-b', 'stage', origin);
  git('clone', origin, main);
  git('-C', main, 'config', 'user.name', 'Test');
  git('-C', main, 'config', 'user.email', 'test@example.com');
  git('-C', main, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(main, 'README.md'), 'hi\n');
  git('-C', main, 'add', 'README.md');
  git('-C', main, 'commit', '-m', 'initial');
  git('-C', main, 'push', 'origin', 'stage');
  git('-C', main, 'remote', 'set-head', 'origin', 'stage');
  return { origin, main };
}

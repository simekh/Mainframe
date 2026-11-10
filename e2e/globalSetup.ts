import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { findExecutable } from '../src/main/pty/findExecutable';
import { localFiles } from '../src/main/pty/sessionHost';

/**
 * The shell the stand-in `claude` runs on Windows: Git for Windows' own bash, found from the git on PATH,
 * as a `bash` on PATH there can be WSL's. Git's `git.exe` is in `<root>\cmd` or `<root>\bin` (or in
 * `<root>\mingw64\bin`), and its bash at `<root>\bin\bash.exe`.
 */
function gitBash(): string {
  const git = findExecutable('git', {
    env: process.env as Record<string, string>,
    cwd: process.cwd(),
    platform: 'win32',
    files: localFiles,
  });
  const roots = git === null ? [] : [dirname(dirname(git)), dirname(dirname(dirname(git)))];
  const bash = roots.map((root) => join(root, 'bin', 'bash.exe')).find((file) => localFiles.isExecutableFile(file));
  if (bash === undefined) {
    throw new Error(
      `The e2e tests need Git for Windows' bash.exe, and found none beside the git on PATH (${git ?? 'no git'}). ` +
        'Set FAKE_CLAUDE_SHELL to the full path of a bash.exe, for a Git that is not on PATH.',
    );
  }
  return bash;
}

/**
 * On Windows, builds `e2e/fake-claude.cjs` into a real `.exe` (a Node single executable application)
 * and hands its path to the tests as FAKE_CLAUDE_EXE: Mainframe starts `claude` there only as an .exe,
 * never a script. It also names the stand-in's shell in FAKE_CLAUDE_SHELL, unless that is set already.
 * Returns the teardown that removes the .exe. Elsewhere the tests run the script itself.
 */
export default function globalSetup(): (() => void) | undefined {
  if (process.platform !== 'win32') return undefined;
  process.env.FAKE_CLAUDE_SHELL ||= gitBash();
  const dir = mkdtempSync(join(os.tmpdir(), 'mainframe-fake-claude-'));
  const config = join(dir, 'sea-config.json');
  const exe = join(dir, 'fake-claude.exe');
  writeFileSync(
    config,
    JSON.stringify({ main: join(__dirname, 'fake-claude.cjs'), output: exe, disableExperimentalSEAWarning: true }),
  );
  execFileSync(process.execPath, ['--build-sea', config], { stdio: 'inherit' });
  process.env.FAKE_CLAUDE_EXE = exe;
  return () => rmSync(dir, { recursive: true, force: true });
}

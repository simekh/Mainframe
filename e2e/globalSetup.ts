import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

/**
 * On Windows, builds `e2e/fake-claude.cjs` into a real `.exe` (a Node single executable application)
 * and hands its path to the tests as FAKE_CLAUDE_EXE: Mainframe starts `claude` there only as an .exe,
 * never a script. Returns the teardown that removes it. Elsewhere the tests run the script itself.
 */
export default function globalSetup(): (() => void) | undefined {
  if (process.platform !== 'win32') return undefined;
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

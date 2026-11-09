import { tmpdir } from 'node:os';
import { it, expect } from 'vitest';
import { spawnNodePty } from './nodePty';
import { localFiles, SessionHost } from './sessionHost';
import { buildSpawnEnv } from './spawnEnv';

// node, so the test runs the same on every system. The wait before the exit lets ConPTY pass the
// output on first, as the status probe's does.
const SCRIPT = 'process.stdout.write("pty-ok"); setTimeout(() => process.exit(3), 300)';

it('runs a real command in a PTY and reports its output and exit code', async () => {
  const host = new SessionHost({
    spawnPty: spawnNodePty(process.platform),
    outputBatchMs: 8,
    env: buildSpawnEnv(process.env, process.platform),
    platform: process.platform,
    files: localFiles,
  });
  let out = '';
  const code = await new Promise<number>((resolve) => host.spawn('real',
    { argv: [process.execPath, '-e', SCRIPT], cwd: tmpdir(), cols: 80, rows: 24 },
    { onData: (d) => { out += Buffer.from(d).toString(); }, onStatus: () => {}, onExit: (e) => resolve(e.exitCode) }));
  expect(out).toContain('pty-ok');
  expect(code).toBe(3);
});

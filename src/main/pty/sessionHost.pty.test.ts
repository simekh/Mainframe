import { it, expect } from 'vitest';
import * as pty from 'node-pty';
import { localFiles, SessionHost } from './sessionHost';
import { buildSpawnEnv } from './spawnEnv';

it('runs a real command in a PTY and reports its output and exit code', async () => {
  const host = new SessionHost({
    spawnPty: pty.spawn, outputBatchMs: 8, env: buildSpawnEnv(process.env, process.platform), platform: process.platform, files: localFiles,
  });
  let out = '';
  const code = await new Promise<number>((resolve) => host.spawn('real',
    { argv: ['/bin/sh', '-c', 'printf "pty-%s" ok; exit 3'], cwd: '/tmp', cols: 80, rows: 24 },
    { onData: (d) => { out += Buffer.from(d).toString(); }, onStatus: () => {}, onExit: (e) => resolve(e.exitCode) }));
  expect(out).toContain('pty-ok');
  expect(code).toBe(3);
});

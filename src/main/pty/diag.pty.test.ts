// DIAGNOSTIC (Windows e2e diagnosis): measurements, not checks. A flood through a real PTY, read
// with and without the renderer's flow control, so node-pty and ConPTY are timed without Electron.
// Removed before the branch's last commit.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'vitest';
import { OutputFlow } from '../../renderer/src/terminal/outputFlow';
import { spawnNodePty } from './nodePty';
import { localFiles, SessionHost } from './sessionHost';
import { buildSpawnEnv } from './spawnEnv';

const NODE_FLOOD =
  "const b='mainframe\\n'.repeat(1000);let n=0;const w=()=>{while(n<300){n++;if(!process.stdout.write(b))return process.stdout.once('drain',w)}process.stdout.write('flood-5\\n');setTimeout(()=>{},500)};w()";

const bash = process.platform === 'win32' ? join(process.env.ProgramFiles!, 'Git', 'bin', 'bash.exe') : '/bin/bash';

const programs: Record<string, string[]> = {
  node: [process.execPath, '-e', NODE_FLOOD],
  bash: [bash, '--noprofile', '--norc', '-c', 'yes mainframe | head -c 3000000; echo flood-5; sleep 0.5'],
};

async function flood(program: string, flowControl: boolean, writeMs: number): Promise<string> {
  const host = new SessionHost({
    spawnPty: spawnNodePty(process.platform),
    outputBatchMs: 8,
    env: buildSpawnEnv(process.env, process.platform),
    platform: process.platform,
    files: localFiles,
  });
  const t0 = Date.now();
  let bytes = 0;
  let tail = '';
  let pauses = 0;
  let resumes = 0;
  let last = t0;
  let gap = 0;
  let gapAt = 0;
  let doneAt = -1;
  const flow = new OutputFlow({
    write: (data, done) => setTimeout(done, writeMs),
    pause: () => {
      pauses++;
      host.pause('flood');
    },
    resume: () => {
      resumes++;
      host.resume('flood');
    },
    schedule: (f) => {
      const t = setTimeout(f, 16);
      return () => clearTimeout(t);
    },
  });
  const exit = new Promise<number>((resolve) =>
    host.spawn(
      'flood',
      { argv: programs[program], cwd: tmpdir(), cols: 80, rows: 24 },
      {
        onData: (d) => {
          const now = Date.now();
          if (now - last > gap) {
            gap = now - last;
            gapAt = now - t0;
          }
          last = now;
          bytes += d.length;
          tail = (tail + Buffer.from(d).toString()).slice(-200);
          if (doneAt < 0 && tail.includes('flood-5')) doneAt = now - t0;
          if (flowControl) flow.push(d);
        },
        onStatus: () => {},
        onExit: (e) => resolve(e.exitCode),
      },
    ),
  );
  const timedOut = await Promise.race([exit.then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), 90_000))]);
  if (timedOut) host.kill('flood');
  return JSON.stringify({
    platform: process.platform,
    program,
    flowControl,
    writeMs,
    doneAt,
    total: Date.now() - t0,
    timedOut,
    bytes,
    pauses,
    resumes,
    longestGap: gap,
    gapAt,
    tail: tail.slice(-60),
  });
}

it('diag: a flood through a real PTY, with and without flow control', { timeout: 900_000 }, async () => {
  for (const program of Object.keys(programs)) {
    for (const [flowControl, writeMs] of [[false, 0], [true, 1], [true, 10], [true, 50]] as const) {
      console.log(`[diag] ${await flood(program, flowControl, writeMs)}`);
    }
  }
});

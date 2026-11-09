// DIAGNOSTIC (Windows e2e diagnosis): measurements, not checks. The first key after a focus report
// and a resize, through a real PTY with no Electron and no xterm. Push 1's flood measurement found
// Git Bash's 3 MB flood took 42 s on Windows with no flow control, node's 0.2 s.
// Removed before the branch's last commit.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'vitest';
import { spawnNodePty } from './nodePty';
import { localFiles, SessionHost } from './sessionHost';
import { buildSpawnEnv } from './spawnEnv';

const KEYLOG =
  "process.stdin.setRawMode(true);process.stdin.on('data',c=>process.stdout.write('\\r\\nKEYS:'+c.toString('hex')+'\\r\\n$ '));process.stdout.on('resize',()=>process.stdout.write('\\r\\nRESIZE:'+process.stdout.columns+'x'+process.stdout.rows+'\\r\\n'));process.stdout.write('$ ')";

const bash = process.platform === 'win32' ? join(process.env.ProgramFiles!, 'Git', 'bin', 'bash.exe') : '/bin/bash';

const programs: Record<string, string[]> = {
  bash: [bash, '--noprofile', '--norc'],
  keylog: [process.execPath, '-e', KEYLOG],
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function firstKey(program: string, focus: 'none' | 'out' | 'out-in', round: number): Promise<string> {
  const host = new SessionHost({
    spawnPty: spawnNodePty(process.platform),
    outputBatchMs: 8,
    env: { ...buildSpawnEnv(process.env, process.platform), PS1: '$ ' },
    platform: process.platform,
    files: localFiles,
  });
  const t0 = Date.now();
  const log: string[] = [];
  let out = '';
  host.spawn(
    'k',
    { argv: programs[program], cwd: tmpdir(), cols: 80, rows: 30 },
    {
      onData: (d) => {
        const text = Buffer.from(d).toString();
        out += text;
        log.push(`${Date.now() - t0} out ${JSON.stringify(text)}`);
        // As xterm does: answer ConPTY's identity query, and report the focus once it asks for reports.
        if (text.includes('\x1b[c')) host.write('k', '\x1b[?1;2c');
        if (text.includes('\x1b[?1004h')) host.write('k', '\x1b[I');
      },
      onStatus: () => {},
      onExit: () => {},
    },
  );
  const until = async (ms: number, ok: () => boolean) => {
    const end = Date.now() + ms;
    while (Date.now() < end && !ok()) await wait(50);
    return ok();
  };
  const send = (data: string) => {
    log.push(`${Date.now() - t0} in ${JSON.stringify(data)}`);
    host.write('k', data);
  };
  await until(10_000, () => out.includes('$ '));
  await wait(500);
  if (focus !== 'none') send('\x1b[O');
  if (focus === 'out-in') {
    await wait(100);
    send('\x1b[I');
  }
  await wait(300);
  log.push(`${Date.now() - t0} resize 80x27`);
  host.resize('k', 80, 27);
  await wait(1500);
  const tag = `k${round}`;
  const before = out.length;
  send(program === 'keylog' ? 'stty size\r' : `echo ${tag}-$((1+1))\r`);
  let outcome = 'TIMEOUT';
  await until(5000, () => {
    const after = out.slice(before);
    if (program === 'keylog') {
      if (after.includes('737474792073697a650d')) outcome = 'ok';
      else if (after.includes('7474792073697a650d')) outcome = 'LOST-FIRST';
    } else if (new RegExp(`^${tag}-2\\r?$`, 'm').test(after)) outcome = 'ok';
    else if (after.includes('command not found')) outcome = 'LOST-FIRST';
    return outcome !== 'TIMEOUT';
  });
  host.kill('k');
  const fromResize = log.slice(log.findIndex((l) => l.includes(' resize ')) - 3);
  return `[diag] ${process.platform} ${program} focus=${focus} round ${round}: ${outcome}\n${fromResize.map((l) => `    ${l}`).join('\n')}`;
}

it('diag: the first key after a focus report and a resize, through a real PTY', { timeout: 900_000 }, async () => {
  for (const program of Object.keys(programs)) {
    for (const focus of ['none', 'out', 'out-in'] as const) {
      for (const round of [1, 2, 3, 4]) console.log(await firstKey(program, focus, round));
    }
  }
});

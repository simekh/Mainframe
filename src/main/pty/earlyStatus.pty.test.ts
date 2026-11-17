import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { spawnNodePty } from './nodePty';
import { localFiles, SessionHost } from './sessionHost';
import { buildSpawnEnv } from './spawnEnv';

// Whether an early OSC 7501 answer gets through the pty layer Mainframe uses on this system to a program that stops
// waiting for it before its query gets out, as Claude Code does when it resumes a long chat on a busy machine.

const PROBE = fileURLToPath(new URL('./fixtures/lateStatusProbe.mjs', import.meta.url));

function runProbe(answerStatusEarly: boolean): Promise<{ replied: boolean; reported: boolean }> {
  const host = new SessionHost({
    spawnPty: spawnNodePty(process.platform),
    outputBatchMs: 8,
    env: buildSpawnEnv(process.env, process.platform),
    platform: process.platform,
    files: localFiles,
  });
  let output = '';
  const states: string[] = [];
  return new Promise((resolve) => {
    host.spawn(
      'probe',
      { argv: [process.execPath, PROBE], cwd: tmpdir(), cols: 80, rows: 24, answerStatusEarly },
      {
        onData: (data) => {
          output += Buffer.from(data).toString();
        },
        onStatus: (status) => {
          if (status) states.push(status.state);
        },
        onExit: () => {
          const line = /PROBE (\{.*?\})/.exec(output);
          resolve({ replied: line ? (JSON.parse(line[1]) as { replied: boolean }).replied : false, reported: states.includes('idle') });
        },
      },
    );
  });
}

it('a program whose query gets out after its wait has no answer when asked', async () => {
  expect(await runProbe(false)).toEqual({ replied: false, reported: false });
}, 10_000);

it('answered early, the same program has its answer in time and reports', async () => {
  expect(await runProbe(true)).toEqual({ replied: true, reported: true });
}, 10_000);

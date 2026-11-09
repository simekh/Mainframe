import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { spawnNodePty } from './nodePty';
import { localFiles, SessionHost } from './sessionHost';
import { buildSpawnEnv } from './spawnEnv';

// Whether Claude Code's OSC 7501 status gets through the pty layer Mainframe uses on this system
// to Mainframe: the query out, Mainframe's reply back in ahead of the terminal's answer to CSI c,
// and the reports out. On Windows the layer is ConPTY, which can answer CSI c itself and drop
// unknown sequences.

const PROBE = fileURLToPath(new URL('./fixtures/statusProbe.mjs', import.meta.url));

// Under the test's timeout, so a probe that hangs ends with its result on the log, not as a bare timeout.
const GIVE_UP_MS = 15_000;

interface ProbeResult {
  exitCode: number;
  /** Whether the session was killed after GIVE_UP_MS, having not exited. */
  killed: boolean;
  queryReachedHost: boolean;
  /** How many CSI c queries reached Mainframe: ConPTY may send its own at start, ahead of the probe's. */
  da1Queries: number;
  sawReply: boolean;
  sawDa1: boolean;
  replyFirst: boolean;
  states: string[];
}

function runProbe(): Promise<ProbeResult> {
  const logLines: string[] = [];
  const host = new SessionHost({
    spawnPty: spawnNodePty(process.platform),
    outputBatchMs: 8,
    env: buildSpawnEnv(process.env, process.platform),
    platform: process.platform,
    files: localFiles,
    log: (line) => logLines.push(line),
  });
  const id = 'probe';
  let output = '';
  let da1Queries = 0;
  let killed = false;
  const states: string[] = [];
  return new Promise((resolve) => {
    const giveUp = setTimeout(() => {
      killed = true;
      host.kill(id, 'SIGKILL');
    }, GIVE_UP_MS);
    host.spawn(
      id,
      { argv: [process.execPath, PROBE], cwd: tmpdir(), cols: 80, rows: 24 },
      {
        onData: (data) => {
          output += Buffer.from(data).toString();
          // Every CSI c gets xterm's answer, after the round trip to the renderer that xterm's takes;
          // Mainframe's own reply goes out at once.
          const seen = output.match(/\x1b\[0?c/g)?.length ?? 0;
          for (; da1Queries < seen; da1Queries++) setTimeout(() => host.write(id, '\x1b[?1;2c'), 20);
        },
        onStatus: (status) => {
          if (status) states.push(status.kind ? `${status.state}:${status.kind}` : status.state);
        },
        onExit: ({ exitCode }) => {
          clearTimeout(giveUp);
          const line = /PROBE (\{.*?\})/.exec(output);
          const probe = line ? (JSON.parse(line[1]) as Pick<ProbeResult, 'sawReply' | 'sawDa1' | 'replyFirst'>) : undefined;
          resolve({
            exitCode,
            killed,
            queryReachedHost: logLines.some((l) => l.endsWith(' query')),
            da1Queries,
            sawReply: probe?.sawReply ?? false,
            sawDa1: probe?.sawDa1 ?? false,
            replyFirst: probe?.replyFirst ?? false,
            states,
          });
        },
      },
    );
  });
}

it('status gets through the pty Mainframe uses on this system', async () => {
  const r = await runProbe();
  console.log('[status-check]', process.platform, JSON.stringify(r));
  expect(r.killed).toBe(false);
  expect(r.exitCode).toBe(0);
  expect(r.queryReachedHost).toBe(true);
  expect(r.sawReply).toBe(true);
  expect(r.replyFirst).toBe(true);
  expect(r.states).toEqual(expect.arrayContaining(['working', 'blocked:question']));
}, 20_000);

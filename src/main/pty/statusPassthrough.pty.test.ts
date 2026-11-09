import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as pty from 'node-pty';
import { expect, it } from 'vitest';
import { SessionHost } from './sessionHost';
import { buildSpawnEnv } from './spawnEnv';

// Whether Claude Code's OSC 7501 status gets through the pty layer to Mainframe: the query out,
// Mainframe's reply back in ahead of the terminal's answer to CSI c, and the reports out. On
// Windows the layer is ConPTY, which can answer CSI c itself and drop unknown sequences, so the
// test also runs with the ConPTY bundled in node-pty.

const PROBE = fileURLToPath(new URL('./fixtures/statusProbe.mjs', import.meta.url));

interface ProbeResult {
  exitCode: number;
  queryReachedHost: boolean;
  da1QueryReachedHost: boolean;
  sawReply: boolean;
  sawDa1: boolean;
  replyFirst: boolean;
  states: string[];
}

function runProbe(useConptyDll: boolean): Promise<ProbeResult> {
  const logLines: string[] = [];
  const host = new SessionHost({
    spawnPty: (file, args, opts) => pty.spawn(file, args, { ...opts, useConptyDll }),
    outputBatchMs: 8,
    env: buildSpawnEnv(process.env),
    // The launch check isn't portable yet (plan 2); node-pty checks the absolute path itself.
    files: { isExecutableFile: () => true, isDirectory: () => true },
    log: (line) => logLines.push(line),
  });
  const id = 'probe';
  let output = '';
  let da1QueryReachedHost = false;
  const states: string[] = [];
  return new Promise((resolve) => {
    host.spawn(
      id,
      { argv: [process.execPath, PROBE], cwd: tmpdir(), cols: 80, rows: 24 },
      {
        onData: (data) => {
          output += Buffer.from(data).toString();
          if (!da1QueryReachedHost && output.includes('\x1b[c')) {
            da1QueryReachedHost = true;
            // xterm answers after a round trip to the renderer; Mainframe's own reply goes out at once.
            setTimeout(() => host.write(id, '\x1b[?1;2c'), 20);
          }
        },
        onStatus: (status) => {
          if (status) states.push(status.kind ? `${status.state}:${status.kind}` : status.state);
        },
        onExit: ({ exitCode }) => {
          const line = /PROBE (\{.*?\})/.exec(output);
          const probe = line ? (JSON.parse(line[1]) as Pick<ProbeResult, 'sawReply' | 'sawDa1' | 'replyFirst'>) : undefined;
          resolve({
            exitCode,
            queryReachedHost: logLines.some((l) => l.endsWith(' query')),
            da1QueryReachedHost,
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

const log = (mode: string, result: ProbeResult) => console.log('[status-check]', mode, JSON.stringify(result));

function expectStatusGotThrough(r: ProbeResult): void {
  expect(r.exitCode).toBe(0);
  expect(r.queryReachedHost).toBe(true);
  expect(r.sawReply).toBe(true);
  expect(r.replyFirst).toBe(true);
  expect(r.states).toEqual(expect.arrayContaining(['working', 'blocked:question']));
}

it("status gets through the system's own pty layer", async () => {
  const r = await runProbe(false);
  log('own', r);
  expectStatusGotThrough(r);
}, 20_000);

it.runIf(process.platform === 'win32')('status gets through the ConPTY bundled with node-pty', async () => {
  const r = await runProbe(true);
  log('bundled', r);
  expectStatusGotThrough(r);
}, 20_000);

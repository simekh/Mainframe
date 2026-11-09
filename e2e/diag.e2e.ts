// DIAGNOSTIC (Windows e2e diagnosis): measurements, not checks; each test writes what it saw with
// writeDiag, and passes unless the app itself breaks. Removed before the branch's last commit.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type ElectronApplication, type Page } from '@playwright/test';
import { cleanUp, diagOf, formatDiag, launchApp, writeDiag, type DiagRecord } from './launch';
import { run, screen, sendLine, startTask, termSize } from './tasks';

test.afterEach(cleanUp);

const sessionIdOf = (page: Page, taskId: string) =>
  page.evaluate(async (id) => {
    for (const p of await window.mainframe.listProjects()) {
      const task = (await window.mainframe.listTasks(p.dir)).find((t) => t.id === id);
      if (task?.session) return task.session.id;
    }
    return null;
  }, taskId);

/** Resizes the session's PTY through the bridge, as a fit does, with no change of focus. */
const bridgeResize = (page: Page, sessionId: string, cols: number, rows: number) =>
  page.evaluate(([id, c, r]) => window.mainframe.resize(id, c, r), [sessionId, cols, rows] as const);

/** The keylog files of the tasks' sessions: the manager, which runs the same fake, is left out. */
const keysFiles = (dataDir: string) => {
  const dir = join(dataDir, 'fake-claude');
  return readdirSync(dir)
    .filter((n) => n.endsWith('.keys'))
    .filter((n) => !readFileSync(join(dir, n.replace(/\.keys$/, '.argv')), 'utf8').includes('--append-system-prompt'));
};

/** Polls `fn` until it gives a value, for up to `ms`; null after that. */
async function within<T>(page: Page, ms: number, fn: () => Promise<T | null>): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v !== null) return v;
    await page.waitForTimeout(100);
  }
  return null;
}

function eventsOf(d: DiagRecord, sid: string, from: number): string {
  return (d.events[sid] ?? [])
    .filter((e) => e[0] >= from)
    .slice(0, 60)
    .map((e) => `    ${e[0]} ${e[1]} ${e[2]}`)
    .join('\n');
}

type Case = { resize: 'none' | 'before' | 'after'; delay: number };
const CASES: Case[] = [
  { resize: 'none', delay: 0 },
  { resize: 'before', delay: 0 },
  { resize: 'before', delay: 50 },
  { resize: 'before', delay: 150 },
  { resize: 'before', delay: 400 },
  { resize: 'before', delay: 1000 },
  { resize: 'after', delay: 0 },
];

const PROGRAMS: Array<{ name: string; env: Record<string, string> }> = [
  { name: 'bash', env: {} },
  { name: 'keylog', env: { FAKE_CLAUDE_KEYLOG: '1' } },
  ...(process.platform === 'win32'
    ? [{ name: 'usr-bash', env: { FAKE_CLAUDE_SHELL: join(process.env.ProgramFiles!, 'Git', 'usr', 'bin', 'bash.exe') } }]
    : []),
];

test('diag: the first input after a resize of an idle session', async () => {
  test.setTimeout(900_000);
  const out: string[] = [];
  for (const program of PROGRAMS) {
    for (const round of [1, 2]) {
      const { app, page, dataDir } = await launchApp(program.env);
      for (const [i, c] of CASES.entries()) {
        const keysBefore = keysFiles(dataDir);
        const id = await startTask(page, `K${round}${i}`);
        const sid = (await sessionIdOf(page, id))!;
        const size = (await termSize(page, id))!;
        await page.waitForTimeout(1500);
        const tag = `k${round}${i}`;
        const line = program.name === 'keylog' ? 'stty size' : `echo ${tag}-$((1+1))`;
        // The record's clock counts from its own start in main.
        const from = Date.now() - (await diagOf(app)).t0 - 200;
        if (c.resize === 'before') {
          await bridgeResize(page, sid, size.cols, size.rows - 3);
          if (c.delay) await page.waitForTimeout(c.delay);
          await sendLine(page, id, line);
        } else if (c.resize === 'after') {
          await sendLine(page, id, line);
          await bridgeResize(page, sid, size.cols, size.rows - 3);
        } else {
          await sendLine(page, id, line);
        }
        let outcome: string | null;
        let detail = '';
        if (program.name === 'keylog') {
          const file = () => keysFiles(dataDir).find((n) => !keysBefore.includes(n));
          const read = () => {
            const f = file();
            return f ? readFileSync(join(dataDir, 'fake-claude', f), 'utf8') : '';
          };
          const hexOf = (text: string) =>
            text
              .split('\n')
              .filter((l) => l.includes(' in '))
              .map((l) => l.split(' in ')[1])
              .join('');
          outcome = await within(page, 6000, async () => {
            const hex = hexOf(read());
            if (hex.includes('737474792073697a650d')) return 'ok';
            if (hex.includes('7474792073697a650d')) return 'LOST-FIRST';
            return null;
          });
          detail = read();
        } else {
          outcome = await within(page, 6000, async () => {
            const text = await screen(page, id);
            if (new RegExp(`^${tag}-2$`, 'm').test(text)) return 'ok';
            if (text.includes('command not found')) return 'LOST-FIRST';
            return null;
          });
          detail = (await screen(page, id)).split('\n').filter((l) => l.trim()).slice(-8).join('\n');
        }
        out.push(`${program.name} round ${round} case ${c.resize}/${c.delay}ms: ${outcome ?? 'TIMEOUT'}`);
        // The first resize case of each program, and every case that went wrong, in full.
        if (outcome !== 'ok' || (round === 1 && i === 1)) {
          out.push(`  ${detail.split('\n').join('\n  ')}`);
          out.push(eventsOf(await diagOf(app), sid, from));
        }
        // The session's start, once per program: what ConPTY sends first and what xterm answers.
        if (round === 1 && i === 0) out.push(eventsOf(await diagOf(app), sid, 0));
      }
      await app.close();
    }
  }
  writeDiag('first-input', out.join('\n'));
});

function processCount(name: string): number {
  try {
    if (process.platform === 'win32') {
      return execFileSync('tasklist', ['/FI', `IMAGENAME eq ${name}.exe`, '/NH'], { encoding: 'utf8' })
        .split('\n')
        .filter((l) => l.toLowerCase().includes(`${name}.exe`)).length;
    }
    return execFileSync('pgrep', ['-x', name], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function sample(app: ElectronApplication, sid: string): Promise<string> {
  const s = await app.evaluate((_electron, id) => {
    const g = globalThis as unknown as {
      __diag: DiagRecord;
      mainframeHost?: { sessions: Map<string, { proc: { _socket?: Record<string, unknown> & { isPaused(): boolean; _handle?: { reading?: boolean } } } }> };
    };
    const d = g.__diag;
    const sock = g.mainframeHost?.sessions.get(id)?.proc._socket;
    return {
      now: Date.now() - d.t0,
      bytes: d.bytes[id] ?? 0,
      pauses: d.pauses[id] ?? 0,
      resumes: d.resumes[id] ?? 0,
      pausedNow: d.pausedNow[id] ?? false,
      lastData: d.lastData[id] ?? -1,
      sock: sock
        ? {
            flowing: sock.readableFlowing,
            isPaused: sock.isPaused(),
            len: sock.readableLength,
            read: sock.bytesRead,
            reading: sock._handle?.reading,
            destroyed: sock.destroyed,
          }
        : null,
    };
  }, sid);
  return JSON.stringify({ ...s, head: processCount('head'), yes: processCount('yes') });
}

test('diag: a flood, hidden and on screen, and the shell alone', async () => {
  test.setTimeout(600_000);
  const out: string[] = [];
  {
    const { app, page } = await launchApp();
    const id = await startTask(page, 'Pipe');
    await run(page, 'time (yes mainframe | head -c 3000000 > /dev/null); echo pipe-$((1+1))');
    const done = await within(page, 60_000, async () => ((await screen(page, id)).match(/^pipe-2$/m) ? true : null));
    const text = await screen(page, id);
    out.push(`pipe only (${done ? 'done' : 'TIMEOUT'}): ${text.split('\n').filter((l) => /^(real|user|sys)/.test(l)).join(' | ')}`);
    await app.close();
  }
  for (const variant of ['hidden', 'shown', 'hidden']) {
    const { app, page } = await launchApp();
    const a = await startTask(page, 'Flood');
    const sid = (await sessionIdOf(page, a))!;
    const t0 = Date.now();
    await run(page, 'yes mainframe | head -c 3000000; echo flood-$((2+3))');
    if (variant === 'hidden') await startTask(page, 'Other');
    let doneAt = -1;
    const samples: string[] = [];
    while (Date.now() - t0 < 150_000) {
      samples.push(`  ${Date.now() - t0} ${await sample(app, sid)}`);
      if ((await screen(page, a)).includes('flood-5')) {
        doneAt = Date.now() - t0;
        break;
      }
      await page.waitForTimeout(1000);
    }
    out.push(`${variant} flood: flood-5 after ${doneAt} ms (-1: not within 150 s)`);
    out.push(...samples);
    const d = await diagOf(app);
    out.push(formatDiag({ ...d, events: { [sid]: d.events[sid] ?? [] } }, 40));
    await app.close();
  }
  writeDiag('flood', out.join('\n'));
});

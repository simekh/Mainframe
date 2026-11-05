import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { cleanUp, launchApp, removeAfterTest } from './launch';

test.afterEach(cleanUp);

test("a task's session streams output, reports OSC 7501 status and exit", async () => {
  const dir = removeAfterTest(mkdtempSync(join(os.tmpdir(), 'thesource-bridge-')));
  const claude = join(dir, 'claude');
  writeFileSync(claude, "#!/bin/sh\nprintf 'bridge-%s' ok; printf '\\033]7501;state=working\\033\\\\'; sleep 0.3\n", {
    mode: 0o755,
  });
  const { app, page } = await launchApp({ THESOURCE_CLAUDE_BIN: claude });

  const result = await page.evaluate(async () => {
    const api = window.thesource;
    const output = new Map<string, string>();
    const states = new Map<string, string[]>();
    const exits = new Map<string, number>();
    let onExit = () => {};
    // Listening before the start: the renderer mounts the task's terminal and spawns it itself.
    api.onData((e) => output.set(e.sessionId, (output.get(e.sessionId) ?? '') + new TextDecoder().decode(e.data)));
    api.onStatus((e) => states.set(e.sessionId, [...(states.get(e.sessionId) ?? []), e.status ? e.status.state : 'none']));
    api.onExit((e) => {
      exits.set(e.sessionId, e.exitCode);
      onExit();
    });

    const task = await api.startTask({ title: 'Bridge', description: '', noQuestions: false });
    const id = task.session!.id;
    await new Promise<void>((resolve) => {
      onExit = () => exits.has(id) && resolve();
      onExit();
    });
    return { output: output.get(id) ?? '', states: states.get(id), code: exits.get(id) };
  });

  expect(result.output).toContain('bridge-ok');
  expect(result.states).toEqual(['working', 'none']);
  expect(result.code).toBe(0);
  await app.close();
});

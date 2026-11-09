import { test, expect } from '@playwright/test';
import { cleanUp, launchApp } from './launch';

test.afterEach(cleanUp);

test("a task's session streams output, reports OSC 7501 status and exit", async () => {
  // fake-claude prints some output and a working status, then exits a moment later.
  const { app, page } = await launchApp({ FAKE_CLAUDE_BRIDGE: '1' });

  const result = await page.evaluate(async () => {
    const api = window.mainframe;
    const output = new Map<string, string>();
    // Status and exit events in the order they came.
    const events = new Map<string, string[]>();
    let onEvent = () => {};
    const record = (sessionId: string, event: string) => {
      events.set(sessionId, [...(events.get(sessionId) ?? []), event]);
      onEvent();
    };
    // Listening before the start: the renderer mounts the task's terminal and spawns it itself.
    api.onData((e) => output.set(e.sessionId, (output.get(e.sessionId) ?? '') + new TextDecoder().decode(e.data)));
    api.onStatus((e) => record(e.sessionId, `status ${e.status ? e.status.state : 'none'}`));
    api.onExit((e) => record(e.sessionId, `exit ${e.exitCode}`));

    const [{ dir }] = await api.listProjects();
    const task = await api.startTask(dir, { title: 'Bridge', description: '', noQuestions: false });
    const id = task.session!.id;
    // Until the exit and the working state's end have both come, whichever comes first.
    await new Promise<void>((resolve) => {
      onEvent = () => {
        const seen = events.get(id) ?? [];
        if (seen.some((e) => e.startsWith('exit')) && seen.includes('status none')) resolve();
      };
      onEvent();
    });
    return { output: output.get(id) ?? '', events: events.get(id) };
  });

  expect(result.output).toContain('bridge-ok');
  // The exit first: the task closes before its working state goes, so it never shows as starting.
  expect(result.events).toEqual(['status working', 'exit 0', 'status none']);
  await app.close();
});

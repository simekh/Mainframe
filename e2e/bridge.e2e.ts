import { test, expect } from '@playwright/test';
import { launchApp } from './launch';

test('a session runs its command, streams output, reports OSC 7501 status and exit', async () => {
  const { app, page } = await launchApp({
    THESOURCE_SESSION_ARGV: JSON.stringify(['/bin/sh', '-c', "printf 'bridge-%s' ok; printf '\\033]7501;state=working\\033\\\\'; sleep 0.3"]),
  });
  const result = await page.evaluate(async () => {
    const api = window.thesource;
    const s = await api.createSession();
    let output = '';
    const states: string[] = [];
    const exitCode = new Promise<number>((resolve) => {
      api.onData((e) => { if (e.sessionId === s.id) output += new TextDecoder().decode(e.data); });
      api.onStatus((e) => { if (e.sessionId === s.id) states.push(e.status ? e.status.state : 'none'); });
      api.onExit((e) => { if (e.sessionId === s.id) resolve(e.exitCode); });
    });
    await api.spawn({ sessionId: s.id, cols: 80, rows: 24 });
    return { name: s.name, code: await exitCode, output, states };
  });
  expect(result.name).toBe('Session 1');
  expect(result.output).toContain('bridge-ok');
  expect(result.states).toEqual(['working', 'none']);
  expect(result.code).toBe(0);
  await app.close();
});

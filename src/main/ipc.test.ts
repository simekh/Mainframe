import { expect, it, vi } from 'vitest';
import { IPC } from '../shared/ipc';
import type { AgentsInUse } from './setup/agentsInUse';

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn) } }));

const { registerSettingsIpc } = await import('./ipc');

it("Settings' Find opens one picker at a time: a second click while it is open joins the first", async () => {
  const find = vi.fn(async () => {});
  const agents = { view: () => ({ agents: { opencode: { fromEnv: false } } }), find } as unknown as AgentsInUse;
  let pick!: (path: string | undefined) => void;
  const pickAgent = vi.fn(() => new Promise<string | undefined>((resolve) => (pick = resolve)));
  registerSettingsIpc(agents, pickAgent);
  const findAgent = handlers.get(IPC.settingsFindAgent)!;

  const first = findAgent({}, 'opencode');
  const second = findAgent({}, 'opencode');
  pick('/bin/opencode');
  await Promise.all([first, second]);
  expect(pickAgent).toHaveBeenCalledTimes(1);
  expect(find.mock.calls).toEqual([['opencode', '/bin/opencode']]);

  // Once it has closed, the next Find opens a picker again.
  const third = findAgent({}, 'opencode');
  pick(undefined);
  await third;
  expect(pickAgent).toHaveBeenCalledTimes(2);
});

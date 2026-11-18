import { expect, it, vi } from 'vitest';
import { IPC } from '../shared/ipc';
import type { AgentsInUse } from './setup/agentsInUse';

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn), on: () => {} },
}));

const { registerIpc, registerSettingsIpc } = await import('./ipc');

it("a session's status reaches the window before the task list its report changes, so a card never shows the new list with the old state", () => {
  const sent: string[] = [];
  const send = (channel: string) => sent.push(channel);
  let onStatus!: (status: { state: string } | null) => void;
  const host = { has: () => false, spawn: (_id: string, _spec: unknown, cb: { onStatus: typeof onStatus }) => (onStatus = cb.onStatus) };
  const owner = { launchSpec: () => ({}), noteStatus: () => send(IPC.tasksChanged) };
  const projects = { ownerOf: () => owner };
  registerIpc(send, projects as never, async () => {}, host as never, {} as never, {} as never);
  handlers.get(IPC.spawn)!({}, { sessionId: 's1', cols: 80, rows: 24 });

  onStatus({ state: 'working' });
  expect(sent).toEqual([IPC.status, IPC.tasksChanged]);
});

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

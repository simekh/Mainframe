import { describe, expect, it, vi } from 'vitest';
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

it("recordImages takes only well-formed entries from the page, records them in the session's own list, ended or running, and sends that list", async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'mainframe-ipc-'));
  try {
    const sent: [string, unknown][] = [];
    // Each project's owners answer only for their own sessions, running or ended; no session runs here.
    const none = { imagesDir: () => null };
    const open = {
      a: { service: none, manager: none },
      b: { service: { imagesDir: (id: string) => (id === 's1' ? join(root, 'images') : null) }, manager: none },
    };
    const projects = {
      list: () => Object.keys(open).map((dir) => ({ dir })),
      get: (dir: keyof typeof open) => open[dir],
      ownerOf: () => undefined,
    };
    registerIpc((c, p) => sent.push([c, p]), projects as never, async () => {}, {} as never, { pasteDir: join(root, 'paste') } as never, {} as never);
    const record = handlers.get(IPC.recordImages)!;
    const shot = join(root, 'shot.png');
    writeFileSync(shot, 'png');

    for (const bad of [null, 'x', [{ path: 1, number: 1 }], [{ path: shot, number: '1' }], [{ path: shot, number: 1.5 }], [{ path: shot, number: null }], [{ path: shot, number: 0 }], [{ path: '', number: 1 }], [{ path: 'shot.png', number: 1 }], [{ path: join(root, 'id_rsa'), number: 1 }], [{ path: shot }]]) {
      expect(() => record({}, 's1', bad)).toThrow();
    }
    expect(() => record({}, 's9', [{ path: shot, number: 1 }])).toThrow();
    expect(sent).toEqual([]);

    record({}, 's1', [{ path: shot, number: 1, extra: 'dropped' }]);
    const images = [{ number: 1, path: shot, name: 'shot.png', size: 3, mtimeMs: expect.any(Number) }];
    expect(sent).toEqual([[IPC.images, { sessionId: 's1', images }]]);
    expect(handlers.get(IPC.getImages)!({}, 's1')).toEqual(images);
    expect(handlers.get(IPC.getImages)!({}, 's9')).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('the Trello todo calls', () => {
  const pick = {
    boardId: 'b1', boardName: 'Board', boardUrl: 'https://trello.com/b/b1', listId: 'l1', listName: 'TODO',
    inProgressListId: null, mineLabelIds: [], urgentLabelIds: ['u1'],
  };
  const setup = (sourceKind = 'trello') => {
    const todo = { useTrello: vi.fn(async () => ({ cards: 1 })), sync: vi.fn(async () => ({ cards: 1 })), view: () => ({ sourceKind }) };
    const projects = { get: (dir: string) => (dir === '/p' ? { todo } : undefined) };
    registerIpc(() => {}, projects as never, async () => {}, {} as never, {} as never, {} as never);
    return todo;
  };

  it('useTrello refuses a malformed pick', async () => {
    const todo = setup();
    for (const bad of [null, 'x', { ...pick, listId: 1 }, { ...pick, mineLabelIds: undefined }]) {
      await expect(async () => handlers.get(IPC.useTrello)!({}, '/p', bad)).rejects.toThrow("That Trello list can't be used");
    }
    expect(todo.useTrello).not.toHaveBeenCalled();
  });

  it("passes a valid pick to the project's todo", async () => {
    const todo = setup();
    await expect(handlers.get(IPC.useTrello)!({}, '/p', { ...pick, extra: 'dropped' })).resolves.toBeUndefined();
    expect(todo.useTrello.mock.calls).toEqual([[pick]]);
  });

  it('pollTodo syncs quietly', async () => {
    const todo = setup();
    await expect(handlers.get(IPC.pollTodo)!({}, '/p')).resolves.toBeUndefined();
    expect(todo.sync.mock.calls).toEqual([[{ quiet: true }]]);
  });

  it('pollTodo on an agent project starts no sync', async () => {
    const todo = setup('agent');
    await expect(handlers.get(IPC.pollTodo)!({}, '/p')).resolves.toBeUndefined();
    expect(todo.sync).not.toHaveBeenCalled();
  });
});

import { beforeEach, expect, it, vi } from 'vitest';
import type { TaskView } from '../../shared/types';

vi.mock('./terminal/registry', () => ({ getTerminal: () => undefined }));
vi.mock('./todo/todoStore', () => ({ todoOf: () => ({ view: null }) }));

const DIR = '/p/Acme';

const view = (id: string, place: TaskView['place']): TaskView => ({
  id,
  title: id,
  description: '',
  slug: id,
  branch: `worktree-${id}`,
  worktreePath: `/p/Acme/.claude/worktrees/${id}`,
  createdAt: 0,
  closedAt: 5,
  place,
  endedAt: place === null ? null : 6,
  merged: false,
  puttingBack: false,
  problem: null,
  card: null,
  agent: 'claude',
  session: null,
});

/** The main process's side of the bridge: what a test's continueTask answers, and the list it sends. */
const bridge = {
  continueTask: vi.fn<(dir: string, id: string) => Promise<TaskView>>(),
  onTasks: null as ((e: { dir: string; tasks: TaskView[] }) => void) | null,
};

vi.stubGlobal('window', {
  mainframe: {
    continueTask: (dir: string, id: string) => bridge.continueTask(dir, id),
    onTasks: (fn: typeof bridge.onTasks) => (bridge.onTasks = fn),
    onStatus: () => {},
    onTodo: () => {},
  },
});

const store = await import('./tasksStore');

beforeEach(() => {
  bridge.onTasks!({ dir: DIR, tasks: [view('paused', null), view('done', 'finished')] });
  store.select(DIR, 'paused');
});

it('a Continue that main answers without starting the task gives the selection back to the task selected before', async () => {
  // Busy, or the app quitting: the task is still finished.
  bridge.continueTask.mockResolvedValue(view('done', 'finished'));
  await store.continueTask(DIR, 'done');
  expect(store.tasksOf(DIR).selectedId).toBe('paused');
});

it('a Continue that puts the task on the board keeps it selected', async () => {
  bridge.continueTask.mockResolvedValue(view('done', null));
  await store.continueTask(DIR, 'done');
  expect(store.tasksOf(DIR).selectedId).toBe('done');
});

it('a refused Continue gives the selection back, and rejects', async () => {
  bridge.continueTask.mockRejectedValue(new Error('refused'));
  await expect(store.continueTask(DIR, 'done')).rejects.toThrow('refused');
  expect(store.tasksOf(DIR).selectedId).toBe('paused');
});

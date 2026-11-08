import { describe, it, expect } from 'vitest';
import type { ProgramStatus, TaskView } from '../../shared/types';
import { addedTask, nextSessionState, updateTerminals } from './taskModel';

const status = (state: ProgramStatus['state'], msg?: string): ProgramStatus => ({ state, id: '', msg, updatedAt: 0 });

const task = (id: string, sessionId: string | null): TaskView => ({
  id,
  title: id,
  description: '',
  slug: id,
  branch: `worktree-${id}`,
  worktreePath: `/p/.claude/worktrees/${id}`,
  createdAt: 0,
  closedAt: sessionId ? null : 5,
  card: null,
  session: sessionId ? { id: sessionId, startedWithPrompt: true } : null,
});

describe('nextSessionState', () => {
  it('started turns true at the first status other than idle, and stays true', () => {
    const idle = nextSessionState(undefined, status('idle'), 1);
    expect(idle.started).toBe(false);
    const working = nextSessionState(idle, status('working'), 2);
    expect(working.started).toBe(true);
    expect(nextSessionState(working, status('idle'), 3).started).toBe(true);
  });

  it('since moves when the state changes, not when its message does', () => {
    const first = nextSessionState(undefined, status('working'), 1);
    expect(first.since).toBe(1);
    const next = nextSessionState(first, status('working', 'reading files'), 2);
    expect(next).toEqual({ status: status('working', 'reading files'), started: true, since: 1 });
    expect(nextSessionState(next, status('blocked'), 3).since).toBe(3);
  });
});

describe('updateTerminals', () => {
  it('a new session gets a terminal, a reopened task\'s terminal is replaced, a closed task keeps its last one', () => {
    const one = updateTerminals([], [task('a', 's1')]);
    expect(one).toEqual([{ sessionId: 's1', taskId: 'a' }]);

    const two = updateTerminals(one, [task('a', 's1'), task('b', 's2')]);
    expect(two).toEqual([{ sessionId: 's1', taskId: 'a' }, { sessionId: 's2', taskId: 'b' }]);
    expect(two[0]).toBe(one[0]);

    const closed = updateTerminals(two, [task('a', null), task('b', 's2')]);
    expect(closed).toBe(two);

    const reopened = updateTerminals(closed, [task('a', 's3'), task('b', 's2')]);
    expect(reopened).toEqual([{ sessionId: 's3', taskId: 'a' }, { sessionId: 's2', taskId: 'b' }]);
    expect(reopened[1]).toBe(two[1]);
  });
});

describe('addedTask', () => {
  it('is the one task new to the list, and none while that is not clear', () => {
    const before = [task('a', 's1'), task('b', null)];
    expect(addedTask(before, [...before, task('c', 's3')])).toBe('c');
    // A list with nothing new: a status change, a close, or the restore at startup.
    expect(addedTask(before, [task('a', null), task('b', 's2')])).toBeNull();
    // More than one new task (the list not loaded yet): the start's reply picks it.
    expect(addedTask([], [...before, task('c', 's3')])).toBeNull();
  });
});

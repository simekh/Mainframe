import { it, expect } from 'vitest';
import { ProgramStatusRecords } from './programStatus';

it('current() is the summary record, else the most recently updated', () => {
  const r = new ProgramStatusRecords();
  expect(r.current()).toBeNull();
  r.apply({ state: 'working', id: '' }, 1);
  r.apply({ state: 'blocked', id: 'sub', kind: 'permission' }, 2);
  expect(r.current()).toEqual({ state: 'working', id: '', updatedAt: 1 });
  r.apply({ state: 'idle', id: '' }, 3);
  expect(r.current()).toEqual({ state: 'idle', id: '', updatedAt: 3 });
});

it('clear removes a record and its children; clear without id removes all', () => {
  const r = new ProgramStatusRecords();
  r.apply({ state: 'working', id: 'a' }, 1);
  r.apply({ state: 'working', id: 'a/b' }, 2);
  r.apply({ state: 'done', id: 'ab' }, 3);
  r.apply({ state: 'clear', id: 'a' }, 4);
  expect(r.ids()).toEqual(['ab']);
  r.apply({ state: 'clear', id: '' }, 5);
  expect(r.current()).toBeNull();
});

it('process exit drops working and blocked, keeps done, error and idle', () => {
  const r = new ProgramStatusRecords();
  (['working', 'blocked', 'done', 'error', 'idle'] as const).forEach((state, i) => r.apply({ state, id: state }, i));
  r.onProcessExit();
  expect(r.ids().sort()).toEqual(['done', 'error', 'idle']);
});

it('keeps at most 256 records, evicting the least recently updated', () => {
  const r = new ProgramStatusRecords();
  for (let i = 0; i < 257; i++) r.apply({ state: 'idle', id: `r${i}` }, i);
  expect(r.ids()).toHaveLength(256);
  expect(r.ids()).not.toContain('r0');
});

it('returns the summary record over a child updated later', () => {
  const r = new ProgramStatusRecords();
  r.apply({ id: '', state: 'working' }, 1);
  r.apply({ id: 'ses_child', state: 'idle' }, 2);
  expect(r.current()?.state).toBe('working');
});

it('returns the child updated last when there is no summary record', () => {
  const r = new ProgramStatusRecords();
  r.apply({ id: 'a', state: 'working' }, 1);
  r.apply({ id: 'b', state: 'blocked', kind: 'permission' }, 2);
  expect(r.current()?.id).toBe('b');
});

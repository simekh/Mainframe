import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadTasks, NewerStateError, saveTasks, type TaskRecord } from './taskStore';

const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'thesource-store-'));
  cleanup.push(dir);
  return dir;
}

const TASK: TaskRecord = {
  id: 't1',
  projectDir: '/p/Damela',
  title: 'Fix login',
  description: 'Users get logged out',
  slug: 'fix-login',
  name: 'damela-fix-login',
  claudeSessionId: '0b7e8a52-2f4c-4f7e-9a51-6d2c3c1b9e10',
  worktreePath: '/p/Damela/.claude/worktrees/fix-login',
  branch: 'worktree-fix-login',
  createdAt: 500,
  closedAt: null,
  open: true,
};

it('saves and loads tasks, leaving no temp file', () => {
  const dir = folder();
  const file = join(dir, 'state.json');
  const closed = { ...TASK, id: 't2', closedAt: 900, open: false };
  saveTasks(file, [TASK, closed]);
  expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1);
  expect(loadTasks(file, 1000, () => {})).toEqual([TASK, closed]);
  expect(readdirSync(dir)).toEqual(['state.json']);
});

it('a missing file loads as no tasks', () => {
  const file = join(folder(), 'state.json');
  const warnings: string[] = [];
  expect(loadTasks(file, 1000, (m) => warnings.push(m))).toEqual([]);
  expect(warnings).toEqual([]);
});

it('a file that cannot be read is kept aside and loads as no tasks', () => {
  const file = join(folder(), 'state.json');
  writeFileSync(file, '{oops');
  const warnings: string[] = [];
  expect(loadTasks(file, 1000, (m) => warnings.push(m))).toEqual([]);
  expect(existsSync(file)).toBe(false);
  expect(readFileSync(`${file}.bad-1000`, 'utf8')).toBe('{oops');
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain('.bad-1000');
});

it('a file from a newer TheSource is left as it is, and loading says so', () => {
  const dir = folder();
  const file = join(dir, 'state.json');
  const bytes = Buffer.from(JSON.stringify({ version: 2, tasks: [{ id: 'from the future' }] }));
  writeFileSync(file, bytes);
  const warnings: string[] = [];

  expect(() => loadTasks(file, 1000, (m) => warnings.push(m))).toThrow(NewerStateError);
  expect(() => loadTasks(file, 1000, (m) => warnings.push(m))).toThrow(
    `The data folder ${dir} was written by a newer TheSource`,
  );
  expect(readFileSync(file).equals(bytes)).toBe(true);
  expect(readdirSync(dir)).toEqual(['state.json']);
  expect(warnings).toEqual([]);
});

it('a task kept before noQuestions was recorded loads without it', () => {
  const file = join(folder(), 'state.json');
  saveTasks(file, [TASK, { ...TASK, id: 't2', noQuestions: true }]);
  expect(loadTasks(file, 1000, () => {})).toEqual([TASK, { ...TASK, id: 't2', noQuestions: true }]);
});

it('midTurn and askAgain load as saved, and a task kept before them loads without them', () => {
  const file = join(folder(), 'state.json');
  const tasks = [TASK, { ...TASK, id: 't2', midTurn: true }, { ...TASK, id: 't3', midTurn: false }, { ...TASK, id: 't4', midTurn: true, askAgain: true }];
  saveTasks(file, tasks);
  expect(loadTasks(file, 1000, () => {})).toEqual(tasks);
});

it.each([
  ['a list instead of an object', '[]'],
  ['no version', JSON.stringify({ tasks: [] })],
  ['a version that is not a number', JSON.stringify({ version: '2', tasks: [] })],
  ['tasks that are not a list', JSON.stringify({ version: 1, tasks: {} })],
  ['a task missing a field', JSON.stringify({ version: 1, tasks: [{ ...TASK, slug: undefined }] })],
  ['a task whose open is not a boolean', JSON.stringify({ version: 1, tasks: [{ ...TASK, open: 'yes' }] })],
  ['a task whose closedAt is not a number or null', JSON.stringify({ version: 1, tasks: [{ ...TASK, closedAt: '900' }] })],
  ['a task whose noQuestions is not a boolean', JSON.stringify({ version: 1, tasks: [{ ...TASK, noQuestions: 'no' }] })],
  ['a task whose midTurn is not a boolean', JSON.stringify({ version: 1, tasks: [{ ...TASK, midTurn: 'yes' }] })],
  ['a task whose askAgain is not a boolean', JSON.stringify({ version: 1, tasks: [{ ...TASK, midTurn: true, askAgain: 1 }] })],
])('a file with %s is kept aside', (_what, text) => {
  const file = join(folder(), 'state.json');
  writeFileSync(file, text);
  const warnings: string[] = [];
  expect(loadTasks(file, 1000, (m) => warnings.push(m))).toEqual([]);
  expect(readFileSync(`${file}.bad-1000`, 'utf8')).toBe(text);
  expect(warnings[0]).toContain('.bad-1000');
});

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { loadTasks, NewerStateError, renameWithRetry, saveTasks, writeJsonAtomic, type TaskRecord } from './taskStore';

const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mainframe-store-'));
  cleanup.push(dir);
  return dir;
}

const TASK: TaskRecord = {
  id: 't1',
  projectDir: '/p/Acme',
  title: 'Fix login',
  description: 'Users get logged out',
  slug: 'fix-login',
  name: 'acme-fix-login',
  claudeSessionId: '0b7e8a52-2f4c-4f7e-9a51-6d2c3c1b9e10',
  worktreePath: '/p/Acme/.claude/worktrees/fix-login',
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

it('writeJsonAtomic replaces the file whole, leaving no temp file', () => {
  const dir = folder();
  const file = join(dir, 'settings.json');
  writeJsonAtomic(file, { a: 1 });
  writeJsonAtomic(file, { b: [2] });
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ b: [2] });
  expect(readdirSync(dir)).toEqual(['settings.json']);
});

const failure = (code: string) => Object.assign(new Error(`${code}: rename 'state.json.tmp' -> 'state.json'`), { code });

it.each(['EPERM', 'EACCES', 'EBUSY'])('renameWithRetry waits while another program holds the file (%s), and renames it once it lets go', (code) => {
  const rename = vi.fn()
    .mockImplementationOnce(() => { throw failure(code); })
    .mockImplementationOnce(() => { throw failure(code); });
  const wait = vi.fn();
  renameWithRetry('state.json.tmp', 'state.json', rename, wait);
  expect(rename.mock.calls).toEqual(Array(3).fill(['state.json.tmp', 'state.json']));
  expect(wait.mock.calls).toEqual([[100], [100]]);
});

it('renameWithRetry gives up after 10 retries and throws what the rename threw', () => {
  const rename = vi.fn(() => { throw failure('EBUSY'); });
  const wait = vi.fn();
  expect(() => renameWithRetry('state.json.tmp', 'state.json', rename, wait)).toThrow(expect.objectContaining({ code: 'EBUSY' }));
  expect(rename).toHaveBeenCalledTimes(11);
  expect(wait).toHaveBeenCalledTimes(10);
});

it('renameWithRetry throws any other error at once', () => {
  const rename = vi.fn(() => { throw failure('ENOENT'); });
  const wait = vi.fn();
  expect(() => renameWithRetry('state.json.tmp', 'state.json', rename, wait)).toThrow(expect.objectContaining({ code: 'ENOENT' }));
  expect(rename).toHaveBeenCalledTimes(1);
  expect(wait).not.toHaveBeenCalled();
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

it('a file from a newer Mainframe is left as it is, and loading says so', () => {
  const dir = folder();
  const file = join(dir, 'state.json');
  const bytes = Buffer.from(JSON.stringify({ version: 2, tasks: [{ id: 'from the future' }] }));
  writeFileSync(file, bytes);
  const warnings: string[] = [];

  expect(() => loadTasks(file, 1000, (m) => warnings.push(m))).toThrow(NewerStateError);
  expect(() => loadTasks(file, 1000, (m) => warnings.push(m))).toThrow(
    `The data folder ${dir} was written by a newer Mainframe`,
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

it("keeps a task's card", () => {
  const file = join(folder(), 'state.json');
  const card = { sourceKind: 'Tracker', id: 'c128', number: '#128', url: 'https://tracker.example/c/128', labels: ['UI'], position: 2, urgent: true };
  const tasks = [TASK, { ...TASK, id: 't2', card }, { ...TASK, id: 't3', card: { ...card, number: null, url: null, labels: [], urgent: false } }];
  saveTasks(file, tasks);
  expect(loadTasks(file, 1000, () => {})).toEqual(tasks);
});

const CARD = { sourceKind: 'Tracker', id: 'c128', number: '#128', url: null, labels: [], position: 0, urgent: false };

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
  ['a task whose card is null', JSON.stringify({ version: 1, tasks: [{ ...TASK, card: null }] })],
  ['a task whose card lacks a field', JSON.stringify({ version: 1, tasks: [{ ...TASK, card: { ...CARD, position: undefined } }] })],
  ['a task whose card has labels that are not a list', JSON.stringify({ version: 1, tasks: [{ ...TASK, card: { ...CARD, labels: 'UI' } }] })],
])('a file with %s is kept aside', (_what, text) => {
  const file = join(folder(), 'state.json');
  writeFileSync(file, text);
  const warnings: string[] = [];
  expect(loadTasks(file, 1000, (m) => warnings.push(m))).toEqual([]);
  expect(readFileSync(`${file}.bad-1000`, 'utf8')).toBe(text);
  expect(warnings[0]).toContain('.bad-1000');
});

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

it.each(['EPERM', 'EACCES', 'EBUSY'])('on Windows renameWithRetry waits while another program holds the file (%s), and renames it once it lets go', (code) => {
  const rename = vi.fn()
    .mockImplementationOnce(() => { throw failure(code); })
    .mockImplementationOnce(() => { throw failure(code); });
  const wait = vi.fn();
  renameWithRetry('state.json.tmp', 'state.json', rename, wait, 'win32');
  expect(rename.mock.calls).toEqual(Array(3).fill(['state.json.tmp', 'state.json']));
  expect(wait.mock.calls).toEqual([[100], [100]]);
});

// Off Windows nothing holds a file; on Windows only a held file is tried again, ten times.
it.each([
  ['darwin', 'EBUSY', 1],
  ['linux', 'EBUSY', 1],
  ['win32', 'ENOENT', 1],
  ['win32', 'EBUSY', 11],
] as const)('on %s renameWithRetry throws %s after %i tries', (platform, code, tries) => {
  const rename = vi.fn(() => { throw failure(code); });
  const wait = vi.fn();
  expect(() => renameWithRetry('state.json.tmp', 'state.json', rename, wait, platform)).toThrow(expect.objectContaining({ code }));
  expect(rename).toHaveBeenCalledTimes(tries);
  expect(wait).toHaveBeenCalledTimes(tries - 1);
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

const STORED_CARD = { sourceKind: 'Tracker', id: 'c128', number: '#128', url: 'https://tracker.example/c/128', labels: ['UI'], position: 2, urgent: true };

// Each optional field loads as saved, beside a task kept before it existed.
it.each([
  ['noQuestions', [{ ...TASK, id: 't2', noQuestions: true }]],
  ['midTurn and askAgain', [{ ...TASK, id: 't2', midTurn: true }, { ...TASK, id: 't3', midTurn: false }, { ...TASK, id: 't4', midTurn: true, askAgain: true }]],
  ['place and endedAt', [{ ...TASK, id: 't2', place: 'finished' as const, endedAt: 5 }, { ...TASK, id: 't3', place: 'putBack' as const }]],
  ['a card', [
    { ...TASK, id: 't2', card: STORED_CARD },
    { ...TASK, id: 't3', card: { ...STORED_CARD, number: null, url: null, labels: [], urgent: false } },
    // Read by Mainframe itself, so it keeps its text.
    { ...TASK, id: 't4', card: { ...STORED_CARD, sourceKind: 'Trello', text: 'Show the list.' } },
  ]],
  ['an agent', [{ ...TASK, id: 't2', agent: 'claude' as const }, { ...TASK, id: 't3', agent: 'opencode' as const, began: true }]],
  ['a model and effort', [{ ...TASK, id: 't2', model: 'opus', effort: 'high' }, { ...TASK, id: 't3', effort: 'low' }]],
] as [string, TaskRecord[]][])('a task with %s loads as saved', (_what, saved) => {
  const file = join(folder(), 'state.json');
  const tasks = [TASK, ...saved];
  saveTasks(file, tasks);
  const warnings: string[] = [];
  expect(loadTasks(file, 1000, (m) => warnings.push(m))).toEqual(tasks);
  expect(warnings).toEqual([]);
});

it('a model or effort that is not a string loads without it, and the file is kept', () => {
  const file = join(folder(), 'state.json');
  const warnings: string[] = [];
  writeFileSync(file, JSON.stringify({ version: 1, tasks: [{ ...TASK, model: 42, effort: 'high' }, { ...TASK, id: 't2', model: 'opus', effort: null }] }));
  expect(loadTasks(file, 1000, (m) => warnings.push(m))).toEqual([{ ...TASK, effort: 'high' }, { ...TASK, id: 't2', model: 'opus' }]);
  expect(warnings).toEqual([]);
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
  ['an unknown agent', JSON.stringify({ version: 1, tasks: [{ ...TASK, agent: 'gemini' }] })],
  ['a task whose place is none of the three', JSON.stringify({ version: 1, tasks: [{ ...TASK, place: 'gone' }] })],
  ['a task whose began is not a boolean', JSON.stringify({ version: 1, tasks: [{ ...TASK, agent: 'opencode', began: 'yes' }] })],
  ['a task whose card is null', JSON.stringify({ version: 1, tasks: [{ ...TASK, card: null }] })],
  ["a task whose card's text is not a string", JSON.stringify({ version: 1, tasks: [{ ...TASK, card: { ...CARD, text: 7 } }] })],
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

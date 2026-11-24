import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { emptyTodo, loadTodo, NewerTodoError, saveTodo, type TodoRecord } from './todoFile';

const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mainframe-todo-'));
  cleanup.push(dir);
  return dir;
}

it('a missing file is an empty list with no notes', () => {
  const warnings: string[] = [];
  expect(loadTodo(join(folder(), 'todo.json'), 1000, (m) => warnings.push(m))).toEqual({ version: 2, cards: [], notes: [] });
  expect(warnings).toEqual([]);
});

const PICK = {
  boardId: 'b1',
  boardName: 'Sprint',
  boardUrl: 'https://trello.example/b/b1',
  listId: 'l1',
  listName: 'TODO',
  inProgressListId: null,
  mineLabelIds: ['m1'],
  urgentLabelIds: ['u1', 'u2'],
};

it('round-trips a record with a source, cards, notes, confirmed tools, a picked list and a Trello pick', () => {
  const dir = folder();
  // Under a folder that is not there yet: saving makes it.
  const file = join(dir, 'todos', 'acme-1a2b3c4d', 'todo.json');
  const record: TodoRecord = {
    version: 2,
    readTools: { connector: 'Tracker', tools: ['get_board', 'get_card'] },
    pickedList: { name: 'Doing', board: 'Sprint', url: 'https://tracker.example/b/sprint' },
    source: { kind: 'Tracker', board: 'Sprint', list: 'Doing', url: null },
    syncedAt: 1700,
    cards: [
      {
        id: 'c1',
        number: '#12',
        title: 'Fix login',
        description: 'Users get logged out',
        labels: ['bug', 'urgent'],
        checklists: [{ name: 'Steps', items: [{ text: 'Reproduce', done: true }, { text: 'Fix', done: false }] }],
        url: 'https://tracker.example/c/c1',
        forOwner: false,
        urgent: true,
      },
      { id: 'c2', number: null, title: 'Call the bank', description: '', labels: [], checklists: [], url: null, forOwner: true, urgent: false },
    ],
    notes: [{ id: 'n1', title: 'Reminder', text: 'Ask about the budget' }],
    trello: PICK,
  };

  saveTodo(file, record);

  expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(2);
  expect(loadTodo(file, 2000, () => {})).toEqual(record);
  expect(readdirSync(join(dir, 'todos', 'acme-1a2b3c4d'))).toEqual(['todo.json']);
});

it.each([
  '{',
  'null',
  '{"version":2,"cards":"x","notes":[]}',
  '{"version":2,"cards":[{"id":1}],"notes":[]}',
  JSON.stringify({ version: 2, trello: { ...PICK, mineLabelIds: 'x' }, cards: [], notes: [] }),
])(
  'a file it cannot use (%s) is kept aside as .bad-<now>, said, and the list starts empty',
  (text) => {
    const file = join(folder(), 'todo.json');
    writeFileSync(file, text);
    const warnings: string[] = [];

    expect(loadTodo(file, 1000, (m) => warnings.push(m))).toEqual(emptyTodo());

    expect(existsSync(file)).toBe(false);
    expect(readFileSync(`${file}.bad-1000`, 'utf8')).toBe(text);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('.bad-1000');
  },
);

it('a file it can neither use nor set aside is said, with both reasons, and the list starts empty', () => {
  const file = join(folder(), 'todo.json');
  writeFileSync(file, '{');
  // The name it would be set aside under is a folder with something in it, so the rename fails.
  mkdirSync(`${file}.bad-1000`);
  writeFileSync(join(`${file}.bad-1000`, 'taken'), '');
  const warnings: string[] = [];

  expect(loadTodo(file, 1000, (m) => warnings.push(m))).toEqual(emptyTodo());

  // Where it was.
  expect(readFileSync(file, 'utf8')).toBe('{');
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain(file);
  expect(warnings[0]).toContain('SyntaxError');
  expect(warnings[0]).toContain('rename');
});

it('a file from a newer Mainframe throws NewerTodoError and is left as it is', () => {
  const dir = folder();
  const file = join(dir, 'todo.json');
  const bytes = Buffer.from(JSON.stringify({ version: 3, cards: [{ id: 'from the future' }], notes: [] }));
  writeFileSync(file, bytes);
  const warnings: string[] = [];

  expect(() => loadTodo(file, 1000, (m) => warnings.push(m))).toThrow(NewerTodoError);
  expect(() => loadTodo(file, 1000, (m) => warnings.push(m))).toThrow(
    `${file} was written by a newer Mainframe (it is version 3; this one reads version 2)`,
  );

  expect(readFileSync(file).equals(bytes)).toBe(true);
  expect(readdirSync(dir)).toEqual(['todo.json']);
  expect(warnings).toEqual([]);
});

it('reads a version 1 file as the agent source, notes and cards intact', () => {
  const dir = folder();
  const file = join(dir, 'todo.json');
  const v1 = {
    version: 1,
    readTools: { connector: 'Tracker', tools: ['get_card'] },
    pickedList: { name: 'Doing', board: 'Sprint', url: null },
    cards: [{ id: 'c2', number: null, title: 'Call the bank', description: '', labels: [], checklists: [], url: null, forOwner: true, urgent: false }],
    notes: [{ id: 'n1', title: 'Reminder', text: 'Ask about the budget' }],
  };
  writeFileSync(file, JSON.stringify(v1));
  const warnings: string[] = [];

  const record = loadTodo(file, 1000, (m) => warnings.push(m));

  expect(record).toEqual({ ...v1, version: 2 });
  expect(readdirSync(dir)).toEqual(['todo.json']);
  expect(warnings).toEqual([]);
});

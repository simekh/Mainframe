import { mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import * as z from 'zod/v4';
import { writeJsonAtomic } from '../tasks/taskStore';
import { TODO_CARD, TODO_LIST_REF, TODO_NOTE, TODO_SOURCE } from './todoSchema';

/** The version of `todo.json` this build writes and reads. */
const VERSION = 1;

/** What `todo.json` holds for one project: the list as the last sync found it, and what the owner confirmed for it. */
const RECORD = z.object({
  version: z.literal(VERSION),
  /** The tools the owner confirmed the sync may read with. */
  readTools: z.object({ connector: z.string(), tools: z.array(z.string()) }).optional(),
  /** The list the owner picked, where the sync found several. */
  pickedList: TODO_LIST_REF.optional(),
  source: TODO_SOURCE.optional(),
  syncedAt: z.number().optional(),
  cards: z.array(TODO_CARD),
  notes: z.array(TODO_NOTE),
});
export type TodoRecord = z.infer<typeof RECORD>;

export const emptyTodo = (): TodoRecord => ({ version: VERSION, cards: [], notes: [] });

/** A `todo.json` from a newer Mainframe: neither read nor touched, so that build still has it whole. */
export class NewerTodoError extends Error {
  constructor(file: string, version: number) {
    super(
      `The Todo list ${file} was written by a newer Mainframe (it is version ${version}; ` +
        `this one reads version ${VERSION}). It is left as it is. Open this project with the newer Mainframe, ` +
        'or set MAINFRAME_DATA_DIR to another folder.',
    );
    this.name = 'NewerTodoError';
  }
}

/**
 * What `todo.json` says: an empty list when it is missing, and also when it cannot be used, in which case it is
 * kept aside as `.bad-<now>` where it can be. Throws `NewerTodoError` for one a newer Mainframe wrote.
 */
export function loadTodo(file: string, now: number, warn: (msg: string) => void): TodoRecord {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyTodo();
    return keepAside(file, now, warn, String(err));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return keepAside(file, now, warn, String(err));
  }

  const { version } = (parsed ?? {}) as { version?: unknown };
  if (typeof version === 'number' && version > VERSION) throw new NewerTodoError(file, version);
  const record = RECORD.safeParse(parsed);
  if (!record.success) return keepAside(file, now, warn, `does not hold a version ${VERSION} Todo record`);
  return record.data;
}

/** Writes `todo.json` whole or not at all, in a folder it makes if need be. */
export function saveTodo(file: string, record: TodoRecord): void {
  mkdirSync(dirname(file), { recursive: true });
  writeJsonAtomic(file, record);
}

/**
 * A Todo file Mainframe can't read is no reason for a project not to open. It is kept aside whole, the owner's notes in
 * it too, where they can be had back by hand; one that can't be set aside is only said.
 */
function keepAside(file: string, now: number, warn: (msg: string) => void, why: string): TodoRecord {
  const aside = `${file}.bad-${now}`;
  try {
    renameSync(file, aside);
  } catch (err) {
    warn(`Could not use ${file} (${why}), nor set it aside (${String(err)})`);
    return emptyTodo();
  }
  warn(`Could not use ${file} (${why}); kept it as ${aside}`);
  return emptyTodo();
}

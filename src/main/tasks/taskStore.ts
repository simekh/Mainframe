import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { AGENT_NAMES, type AgentName, type TaskCardRef } from '../../shared/types';
import { TASK_CARD_REF } from '../todo/todoSchema';

export interface TaskRecord {
  id: string;
  projectDir: string;
  title: string;
  description: string;
  slug: string;
  name: string;
  claudeSessionId: string;
  worktreePath: string;
  branch: string;
  createdAt: number;
  /** When the last session ended; null while one runs. */
  closedAt: number | null;
  /** Whether the task should be running: set by start and reopen, cleared by close and by an exit. */
  open: boolean;
  /** Whether the opening prompt waives questions. Records kept before it was saved lack it: false. */
  noQuestions?: boolean;
  /**
   * Whether the last session ended in the middle of a turn, working or blocked. Reopen then sends a
   * prompt with the resume (see askAgain), as Claude starts no turn by itself. Records kept before it
   * was saved lack it: false.
   */
  midTurn?: boolean;
  /**
   * Whether that turn was Claude waiting for the owner's answer: Reopen then asks Claude to ask again.
   * Read only while midTurn. Records kept before it was saved lack it: false.
   */
  askAgain?: boolean;
  /** The to-do card the task was started from. Tasks that weren't, and those kept before it was saved, lack it. */
  card?: TaskCardRef;
  /** The agent CLI it runs on. Records kept before it was saved lack it: Claude Code. */
  agent?: AgentName;
}

/** The version of `state.json` this build writes and reads. */
const VERSION = 1;

/** A `state.json` from a newer Mainframe: neither read nor touched, so that build still has it whole. */
export class NewerStateError extends Error {
  constructor(file: string, version: number) {
    super(
      `The data folder ${dirname(file)} was written by a newer Mainframe (its state.json is version ${version}; ` +
        `this one reads version ${VERSION}). It is left as it is. Open it with the newer Mainframe, or set ` +
        'MAINFRAME_DATA_DIR to another folder.',
    );
    this.name = 'NewerStateError';
  }
}

const STRING_FIELDS = [
  'id', 'projectDir', 'title', 'description', 'slug', 'name', 'claudeSessionId', 'worktreePath', 'branch',
] as const;

function isTaskRecord(value: unknown): value is TaskRecord {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    STRING_FIELDS.every((field) => typeof t[field] === 'string') &&
    typeof t.createdAt === 'number' &&
    (t.closedAt === null || typeof t.closedAt === 'number') &&
    typeof t.open === 'boolean' &&
    (t.noQuestions === undefined || typeof t.noQuestions === 'boolean') &&
    (t.midTurn === undefined || typeof t.midTurn === 'boolean') &&
    (t.askAgain === undefined || typeof t.askAgain === 'boolean') &&
    (t.card === undefined || TASK_CARD_REF.safeParse(t.card).success) &&
    (t.agent === undefined || (typeof t.agent === 'string' && Object.hasOwn(AGENT_NAMES, t.agent)))
  );
}

/**
 * Every project's tasks in `state.json`, read once per run. The services of all open projects share
 * it, so each one's save writes back the others' tasks as they are now.
 */
export class TaskRecords {
  readonly all: TaskRecord[];

  /** Throws `NewerStateError` for a file a newer Mainframe wrote; sets any other bad file aside. */
  constructor(
    private readonly file: string,
    now: number,
    warn: (msg: string) => void,
  ) {
    this.all = loadTasks(file, now, warn);
  }

  save(): void {
    saveTasks(this.file, this.all);
  }
}

export function saveTasks(file: string, tasks: TaskRecord[]): void {
  writeJsonAtomic(file, { version: VERSION, tasks });
}

/** Writes `value` to `file` whole or not at all: a crash mid-write leaves the old file. */
export function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameWithRetry(tmp, file);
}

/** What a rename fails with while another program (an antivirus, the indexer, a sync tool) holds the file on Windows. */
const HELD_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RETRIES = 10;
const RETRY_MS = 100;

/**
 * Renames `from` to `to`. On Windows it tries again for a second while the file is held; every save is
 * synchronous, so the wait blocks too. Elsewhere nothing holds a file, and the first failure is thrown
 * at once. Any other error, or a file held past the retries, is thrown.
 */
export function renameWithRetry(
  from: string,
  to: string,
  rename = renameSync,
  wait = (ms: number) => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  platform: NodeJS.Platform = process.platform,
): void {
  for (let attempt = 0; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (err) {
      if (platform !== 'win32' || attempt === RETRIES || !HELD_CODES.has((err as NodeJS.ErrnoException).code ?? '')) throw err;
      wait(RETRY_MS);
    }
  }
}

/** Throws `NewerStateError` for a file a newer Mainframe wrote; sets any other bad file aside. */
export function loadTasks(file: string, now: number, warn: (msg: string) => void): TaskRecord[] {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    return keepAside(file, now, warn, String(err));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return keepAside(file, now, warn, String(err));
  }

  const { version, tasks } = (parsed ?? {}) as { version?: unknown; tasks?: unknown };
  if (typeof version === 'number' && version > VERSION) throw new NewerStateError(file, version);
  if (version !== VERSION || !Array.isArray(tasks) || !tasks.every(isTaskRecord)) {
    return keepAside(file, now, warn, `does not hold version ${VERSION} task records`);
  }
  return tasks;
}

function keepAside(file: string, now: number, warn: (msg: string) => void, why: string): TaskRecord[] {
  const aside = `${file}.bad-${now}`;
  renameSync(file, aside);
  warn(`Could not use ${file} (${why}); kept it as ${aside}`);
  return [];
}

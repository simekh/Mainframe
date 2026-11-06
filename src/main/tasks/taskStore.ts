import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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
    (t.askAgain === undefined || typeof t.askAgain === 'boolean')
  );
}

export function saveTasks(file: string, tasks: TaskRecord[]): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: VERSION, tasks }, null, 2));
  renameSync(tmp, file);
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

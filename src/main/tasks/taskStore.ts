import { readFileSync, renameSync, writeFileSync } from 'node:fs';

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
    typeof t.open === 'boolean'
  );
}

export function saveTasks(file: string, tasks: TaskRecord[]): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, tasks }, null, 2));
  renameSync(tmp, file);
}

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
  if (version !== 1 || !Array.isArray(tasks) || !tasks.every(isTaskRecord)) {
    return keepAside(file, now, warn, 'does not hold version 1 task records');
  }
  return tasks;
}

function keepAside(file: string, now: number, warn: (msg: string) => void, why: string): TaskRecord[] {
  const aside = `${file}.bad-${now}`;
  renameSync(file, aside);
  warn(`Could not use ${file} (${why}); kept it as ${aside}`);
  return [];
}

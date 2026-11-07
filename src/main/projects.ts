import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from './tasks/taskStore';

/**
 * `projects.json`, in the data folder: the project folders Mainframe had open, which it opens again
 * at its next start. A list, as Mainframe runs several projects at once; this build opens one.
 */
const FILE = 'projects.json';
/** The version of `projects.json` this build writes and reads. */
const VERSION = 1;

export interface ProjectPick {
  dataDir: string;
  /** Asks the owner for a project folder; undefined when they cancel. */
  pick: () => Promise<string | undefined>;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The folders `projects.json` lists, or none when it is missing or cannot be used. Throws for one a
 * newer Mainframe wrote: that is neither read nor touched, so that build still has it whole.
 */
function readOpen(dataDir: string, warn: (msg: string) => void): string[] {
  const file = join(dataDir, FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') warn(`Could not read ${file} (${String(err)}); treating it as missing`);
    return [];
  }

  const record = (parsed ?? {}) as Record<string, unknown>;
  if (typeof record.version === 'number' && record.version > VERSION) {
    throw new Error(
      `The list of open projects ${file} was written by a newer Mainframe (it is version ${record.version}; ` +
        `this one reads version ${VERSION}). It is left as it is. Open it with the newer Mainframe, ` +
        'or set MAINFRAME_DATA_DIR to another folder.',
    );
  }
  const { open } = record;
  if (record.version !== VERSION || !Array.isArray(open) || !open.every((path) => typeof path === 'string')) {
    warn(`Could not use ${file} (it does not hold a version ${VERSION} list of folders); treating it as missing`);
    return [];
  }
  return open;
}

function writeOpen(dataDir: string, open: string[]): void {
  writeJsonAtomic(join(dataDir, FILE), { version: VERSION, open });
}

/**
 * The project to open: the remembered one while its folder is there, otherwise the one the owner
 * picks, which is remembered. Undefined when they cancel: Mainframe has no project of its own to
 * fall back on.
 */
export async function chooseProject(deps: ProjectPick & { warn: (msg: string) => void }): Promise<string | undefined> {
  const [remembered] = readOpen(deps.dataDir, deps.warn);
  if (remembered !== undefined && isDirectory(remembered)) return remembered;
  const picked = await deps.pick();
  if (picked !== undefined) writeOpen(deps.dataDir, [picked]);
  return picked;
}

/** Open Project…: this build opens one project, so it remembers the picked one in its place and restarts on it. */
export async function openProject(deps: ProjectPick & { current: string; restart: () => void }): Promise<void> {
  const picked = await deps.pick();
  if (picked === undefined || picked === deps.current) return;
  writeOpen(deps.dataDir, [picked]);
  deps.restart();
}

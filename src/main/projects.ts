import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { localFiles } from './pty/sessionHost';
import { writeJsonAtomic } from './tasks/taskStore';

/**
 * `projects.json`, in the data folder: the project folders Mainframe has open, in the order its
 * project list shows them. It opens them all again at its next start.
 */
const FILE = 'projects.json';
/**
 * The version of `projects.json` this build writes and reads. An earlier build, which opened one
 * project, reads the same version and opens the first one listed: kept at 1 so that build still
 * starts, as it would refuse a newer one.
 */
const VERSION = 1;

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

export function writeOpenProjects(dataDir: string, open: string[]): void {
  writeJsonAtomic(join(dataDir, FILE), { version: VERSION, open });
}

/** Whether Mainframe has remembered projects before, even if the file can no longer be used. */
export function hasProjectsFile(dataDir: string): boolean {
  return existsSync(join(dataDir, FILE));
}

/**
 * The remembered folders that are still there, and no more: nothing is asked or written. A folder
 * that has gone is left out, and drops out of `projects.json` at the next change to the list.
 */
export function rememberedProjects(dataDir: string, warn: (msg: string) => void): string[] {
  return readOpen(dataDir, warn).filter((dir) => {
    const there = localFiles.isDirectory(dir);
    if (!there) warn(`The project folder ${dir} has gone; Mainframe leaves it out`);
    return there;
  });
}

/**
 * The projects to open at start: the remembered ones whose folders are there, or else the one the
 * owner picks, which is remembered. None when they cancel.
 */
export async function chooseProjects(deps: {
  dataDir: string;
  /** Asks the owner for a project folder; undefined when they cancel. */
  pick: () => Promise<string | undefined>;
  warn: (msg: string) => void;
}): Promise<string[]> {
  const present = rememberedProjects(deps.dataDir, deps.warn);
  if (present.length > 0) return present;
  const picked = await deps.pick();
  if (picked === undefined) return [];
  writeOpenProjects(deps.dataDir, [picked]);
  return [picked];
}

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { localFiles } from './pty/sessionHost';
import { readVersionedJson, writeJsonAtomic } from './tasks/taskStore';

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
  return (
    readVersionedJson<string[]>(
      file,
      VERSION,
      warn,
      (found) =>
        `The list of open projects ${file} was written by a newer Mainframe (it is version ${found}; ` +
        `this one reads version ${VERSION}). It is left as it is. Open it with the newer Mainframe, ` +
        'or set MAINFRAME_DATA_DIR to another folder.',
      `it does not hold a version ${VERSION} list of folders`,
      ({ open }) => (Array.isArray(open) && open.every((path) => typeof path === 'string') ? open : undefined),
    ) ?? []
  );
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

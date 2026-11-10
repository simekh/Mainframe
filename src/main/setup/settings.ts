import { join } from 'node:path';
import { readVersionedJson, writeJsonAtomic } from '../tasks/taskStore';

/**
 * `settings.json`, in the data folder: what Mainframe remembers for every open project alike. Nothing
 * here belongs to one project.
 */
const FILE = 'settings.json';
const VERSION = 1;

export interface AppSettings {
  /** The claude Mainframe found last time. Not set when MAINFRAME_CLAUDE_BIN named it. */
  claudeBin?: string;
  /** The welcome has been shown and a first project chosen. Kept apart from `claudeBin`, so it holds when MAINFRAME_CLAUDE_BIN is set. */
  welcomeSeen?: boolean;
}

/**
 * The settings, or none when the file is missing or cannot be used. Throws for one a newer Mainframe
 * wrote: that is neither read nor touched, so that build still has it whole.
 */
export function readSettings(dataDir: string, warn: (msg: string) => void): AppSettings {
  return (
    readVersionedJson<AppSettings>(
      join(dataDir, FILE),
      VERSION,
      warn,
      () => 'settings.json was written by a newer Mainframe; update this one, or move the file away',
      `it does not hold version ${VERSION} settings`,
      ({ claudeBin, welcomeSeen }) =>
        (claudeBin !== undefined && typeof claudeBin !== 'string') || (welcomeSeen !== undefined && typeof welcomeSeen !== 'boolean')
          ? undefined
          : { ...(claudeBin !== undefined && { claudeBin }), ...(welcomeSeen !== undefined && { welcomeSeen }) },
    ) ?? {}
  );
}

export function writeSettings(dataDir: string, settings: AppSettings): void {
  writeJsonAtomic(join(dataDir, FILE), { version: VERSION, ...settings });
}

import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import type { ImageEntry } from '../../shared/types';
import { writeJsonAtomic } from '../tasks/taskStore';

const LIST_FILE = 'images.json';

const isEntry = (e: unknown): e is ImageEntry => {
  const { number, path, name, size, mtimeMs } = (e ?? {}) as Record<string, unknown>;
  return typeof number === 'number' && typeof path === 'string' && typeof name === 'string' &&
    (size === undefined || typeof size === 'number') && (mtimeMs === undefined || typeof mtimeMs === 'number');
};

/** The conversation's images, in the order it received them; none for a missing list, null for one that can't be used. */
function loadImages(dir: string): ImageEntry[] | null {
  const file = join(dir, LIST_FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    console.warn(`Could not read ${file} (${String(err)}); treating it as empty`);
    return null;
  }
  // A bad entry spoils the whole list: the page finds images by their place in it.
  if (Array.isArray(parsed) && parsed.every(isEntry)) return parsed;
  console.warn(`Could not use ${file} (it does not hold a list of images); treating it as empty`);
  return null;
}

/** The conversation's images, in the order it received them; none for a list that is missing or can't be used. */
export function readImages(dir: string): ImageEntry[] {
  return loadImages(dir) ?? [];
}

/**
 * Whether the entry's file is still the one recorded: same size, same modified time. A file changed since is another
 * image under the old number, so it counts as gone. An entry recorded before these were kept passes.
 */
export function unchanged(entry: ImageEntry): boolean {
  if (entry.size === undefined) return true;
  try {
    const { size, mtimeMs } = statSync(entry.path);
    return size === entry.size && mtimeMs === entry.mtimeMs;
  } catch {
    return false;
  }
}

/**
 * Adds the images to the conversation's list and returns the whole list. A pasted image (a file in `pasteDir`) is copied
 * into `dir`, so it stays once the paste folder is emptied; copied, not moved: the pasted file is
 * left as the agent was given it. A dropped file is listed where it is. One that can't be copied or read is warned of and
 * left out; the others are still listed. A list that is there but can't be used is left as it is, and nothing is recorded.
 */
export function recordImages(dir: string, added: { path: string; number: number }[], pasteDir: string): ImageEntry[] {
  mkdirSync(dir, { recursive: true });
  const images = loadImages(dir);
  if (!images) {
    console.warn(`Mainframe records no images in ${dir} while its list can't be used`);
    return [];
  }
  for (const { path, number } of added) {
    const name = basename(path);
    const inPaste = relative(resolve(pasteDir), resolve(path));
    const pasted = inPaste !== '' && !inPaste.startsWith('..') && !isAbsolute(inPaste);
    try {
      const listed = pasted ? copyInto(dir, path) : path;
      const { size, mtimeMs } = statSync(listed);
      images.push({ number, path: listed, name, size, mtimeMs });
    } catch (err) {
      console.warn(`Could not record ${path} in ${dir} (${String(err)}); it is left out of the list`);
    }
  }
  writeJsonAtomic(join(dir, LIST_FILE), images);
  return images;
}

/** Copies the file into `dir`; returns the copy's path. */
function copyInto(dir: string, path: string): string {
  const to = join(dir, basename(path));
  copyFileSync(path, to);
  return to;
}

/** Removes the conversation's images and their list. Never throws: a folder that can't go is warned of and left. */
export function clearImages(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`Could not remove ${dir} (${String(err)}); its images stay`);
  }
}

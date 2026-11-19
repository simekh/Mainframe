import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import type { ImageEntry } from '../../shared/types';
import { writeJsonAtomic } from '../tasks/taskStore';

const LIST_FILE = 'images.json';

const isEntry = (e: unknown): e is ImageEntry => {
  const { number, path, name } = (e ?? {}) as Record<string, unknown>;
  return (number === null || typeof number === 'number') && typeof path === 'string' && typeof name === 'string';
};

/** The conversation's images, in the order it received them; none for a list that is missing or can't be used. */
export function readImages(dir: string): ImageEntry[] {
  const file = join(dir, LIST_FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`Could not read ${file} (${String(err)}); treating it as empty`);
    return [];
  }
  // A bad entry spoils the whole list: the page finds images by their place in it.
  if (Array.isArray(parsed) && parsed.every(isEntry)) return parsed;
  console.warn(`Could not use ${file} (it does not hold a list of images); treating it as empty`);
  return [];
}

/**
 * Adds the images to the conversation's list and returns the whole list. A pasted image (a file in `pasteDir`) moves
 * into `dir`, so it stays once the paste folder is emptied; a dropped file is listed where it is.
 */
export function recordImages(dir: string, added: { path: string; number: number | null }[], pasteDir: string): ImageEntry[] {
  mkdirSync(dir, { recursive: true });
  const images = readImages(dir);
  for (const { path, number } of added) {
    const name = basename(path);
    const inPaste = relative(resolve(pasteDir), resolve(path));
    const pasted = inPaste !== '' && !inPaste.startsWith('..') && !isAbsolute(inPaste);
    images.push({ number, path: pasted ? moveInto(dir, path) : path, name });
  }
  writeJsonAtomic(join(dir, LIST_FILE), images);
  return images;
}

/** Moves the file into `dir`, copying when the two are on different volumes; returns its new path. */
function moveInto(dir: string, path: string): string {
  const to = join(dir, basename(path));
  try {
    renameSync(path, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    copyFileSync(path, to);
    unlinkSync(path);
  }
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

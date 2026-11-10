// Adapted from Parallel Code (MIT): electron/ipc/register.ts (ResolveClipboardPaste) at 97c3558. See THIRD_PARTY_NOTICES.md.
// Rewritten for Electron 44's async clipboard, which replaced availableFormats/read(format)/readImage.
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ClipboardPaste } from '../shared/types';

/** The part of Electron's `clipboard` that paste resolution reads. */
export interface ClipboardReader {
  read(): Promise<Array<{ types: string[]; getType(type: string): Promise<unknown> }>>;
  readText(): Promise<string>;
}

type Items = Awaited<ReturnType<ClipboardReader['read']>>;

async function readBlob(items: Items, type: string): Promise<Blob | null> {
  const item = items.find((i) => i.types.includes(type));
  if (!item) return null;
  const blob = await item.getType(type);
  return blob instanceof Blob ? blob : null;
}

/** A file copied in Finder: `text/uri-list` maps to macOS's file reference (`public.file-url`). */
async function readFilePath(items: Items): Promise<string | null> {
  const blob = await readBlob(items, 'text/uri-list');
  if (!blob) return null;
  const url = (await blob.text())
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('file://'));
  if (!url) return null;
  try {
    return fileURLToPath(url);
  } catch {
    return null;
  }
}

/**
 * What a paste into a terminal should insert, in order: a file copied in Finder becomes its path
 * (reading text would give only the basename), an image is saved as its own PNG and becomes that
 * path, text stays text.
 */
export async function resolveClipboardPaste(
  clipboard: ClipboardReader,
  writeFile: (path: string, data: Buffer) => Promise<void>,
  newImagePath: () => string,
): Promise<ClipboardPaste> {
  try {
    const items = await clipboard.read();
    const filePath = await readFilePath(items);
    if (filePath) return { kind: 'file', path: filePath };
    const png = await readBlob(items, 'image/png');
    if (png) {
      const path = newImagePath();
      await writeFile(path, Buffer.from(await png.arrayBuffer()));
      return { kind: 'image', path };
    }
    const text = await clipboard.readText();
    if (text) return { kind: 'text', text };
    return { kind: 'empty' };
  } catch (err) {
    console.error('[clipboard] resolveClipboardPaste failed:', err);
    return { kind: 'empty' };
  }
}

/**
 * Empties the folder pasted images are saved to, and makes sure it is there. A file that can't go
 * (an image still open on Windows) is warned of and left: the start goes on.
 */
export function clearPasteFolder(dir: string, warn: (m: string) => void, rm = rmSync): void {
  try {
    rm(dir, { recursive: true, force: true });
  } catch (err) {
    warn(`Could not empty ${dir} (${String(err)}); images pasted before stay in it`);
  }
  mkdirSync(dir, { recursive: true });
}

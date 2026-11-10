import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, it, expect } from 'vitest';
import { clearPasteFolder, resolveClipboardPaste } from './clipboard';

const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A paste folder with an image left from the last run. */
function pasteFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'mainframe-paste-'));
  cleanup.push(root);
  const dir = join(root, 'mainframe-paste');
  mkdirSync(dir);
  writeFileSync(join(dir, 'old.png'), 'p');
  return dir;
}

it('clearPasteFolder empties the folder, and makes it when it is missing', () => {
  const warnings: string[] = [];
  const dir = pasteFolder();
  clearPasteFolder(dir, (m) => warnings.push(m));
  expect(readdirSync(dir)).toEqual([]);

  rmSync(dir, { recursive: true });
  clearPasteFolder(dir, (m) => warnings.push(m));
  expect(existsSync(dir)).toBe(true);
  expect(warnings).toEqual([]);
});

it('clearPasteFolder warns when a file in it cannot go, as one still open on Windows, and the folder stays', () => {
  const warnings: string[] = [];
  const dir = pasteFolder();
  const busy = () => {
    throw Object.assign(new Error(`EBUSY: resource busy or locked, rm '${join(dir, 'old.png')}'`), { code: 'EBUSY' });
  };
  clearPasteFolder(dir, (m) => warnings.push(m), busy);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain('EBUSY');
  expect(existsSync(dir)).toBe(true);
});

// Electron 44's clipboard: read() gives ClipboardItems; a Finder file copy is `text/uri-list`.
const board = (o: { uriList?: string; png?: Buffer; text?: string }) => {
  const blobs: Record<string, Blob> = {};
  if (o.uriList) blobs['text/uri-list'] = new Blob([o.uriList]);
  if (o.png) blobs['image/png'] = new Blob([new Uint8Array(o.png)]);
  if (o.text) blobs['text/plain'] = new Blob([o.text]);
  const types = Object.keys(blobs);
  return {
    read: async () => (types.length ? [{ types, getType: async (t: string) => blobs[t] }] : []),
    readText: async () => o.text ?? '',
  };
};
const written: Array<[string, Buffer]> = [];
const write = async (p: string, d: Buffer) => { written.push([p, d]); };
let n = 0;
const nextPath = () => `/tmp/paste-${++n}.png`;
const inTmp = (name: string) => join(tmpdir(), name);

it('a Finder file copy becomes its path, ahead of image and text', async () => {
  const uriList = pathToFileURL(inTmp('My Shot.png')).href;
  expect(await resolveClipboardPaste(board({ uriList, png: Buffer.from('p'), text: 't' }), write, nextPath))
    .toEqual({ kind: 'file', path: inTmp('My Shot.png') });
});

it('of several copied files the first one is used', async () => {
  const uriList = `# comment\r\n${pathToFileURL(inTmp('1.txt')).href}\r\n${pathToFileURL(inTmp('2.txt')).href}`;
  expect(await resolveClipboardPaste(board({ uriList }), write, nextPath))
    .toEqual({ kind: 'file', path: inTmp('1.txt') });
});

it('each image is saved to its own PNG', async () => {
  const png = Buffer.from([0x89, 0x50]);
  const first = await resolveClipboardPaste(board({ png }), write, nextPath);
  const second = await resolveClipboardPaste(board({ png }), write, nextPath);
  expect(first.kind).toBe('image');
  expect(second.kind).toBe('image');
  expect(first).not.toEqual(second);
  expect(written.at(-1)?.[1]).toEqual(png);
});

it('text stays text and nothing is empty', async () => {
  expect(await resolveClipboardPaste(board({ text: 'hej' }), write, nextPath)).toEqual({ kind: 'text', text: 'hej' });
  expect(await resolveClipboardPaste(board({}), write, nextPath)).toEqual({ kind: 'empty' });
});

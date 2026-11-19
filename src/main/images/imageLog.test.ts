import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { clearImages, readImages, recordImages, unchanged } from './imageLog';

const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'mainframe-images-'));
  cleanup.push(root);
  const pasteDir = join(root, 'paste');
  mkdirSync(pasteDir);
  const dir = join(root, 'data', 'tasks', 't1', 'images');
  const file = (path: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'png');
    return path;
  };
  return { root, pasteDir, dir, file };
}

// Copied, not moved: Codex reads an attached image's file only when its message is sent.
it("a pasted image is copied into the conversation's folder, and the paste folder keeps its own until it is emptied", () => {
  const { pasteDir, dir, file } = setup();
  const pasted = file(join(pasteDir, 'a1.png'));

  const images = recordImages(dir, [{ path: pasted, number: 1 }], pasteDir);

  expect(existsSync(pasted)).toBe(true);
  expect(images).toMatchObject([{ number: 1, path: join(dir, 'a1.png'), name: 'a1.png' }]);
  expect(existsSync(join(dir, 'a1.png'))).toBe(true);
});

it('a dropped file stays where it is', () => {
  const { root, pasteDir, dir, file } = setup();
  const dropped = file(join(root, 'Desktop', 'shot.png'));
  // A folder beside the paste folder whose name starts the same is not inside it.
  const beside = file(join(`${pasteDir}-other`, 'b.png'));

  const images = recordImages(dir, [{ path: dropped, number: 1 }, { path: beside, number: 2 }], pasteDir);

  expect(images).toMatchObject([
    { number: 1, path: dropped, name: 'shot.png' },
    { number: 2, path: beside, name: 'b.png' },
  ]);
  expect(existsSync(dropped)).toBe(true);
  expect(existsSync(beside)).toBe(true);
});

it("a pasted image that can't be copied is left out, with a warning, and the others are listed", () => {
  const { root, pasteDir, dir, file } = setup();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const dropped = file(join(root, 'b.png'));

  const images = recordImages(dir, [{ path: join(pasteDir, 'gone.png'), number: 1 }, { path: dropped, number: 2 }], pasteDir);

  expect(images).toMatchObject([{ number: 2, path: dropped, name: 'b.png' }]);
  expect(readImages(dir)).toEqual(images);
  expect(warn).toHaveBeenCalledTimes(1);
});

it('entries append in order and survive a read', () => {
  const { root, pasteDir, dir, file } = setup();
  recordImages(dir, [{ path: file(join(pasteDir, 'a.png')), number: 1 }], pasteDir);
  const all = recordImages(dir, [{ path: file(join(root, 'b.png')), number: 2 }, { path: file(join(root, 'c.png')), number: 3 }], pasteDir);

  expect(all.map((e) => e.number)).toEqual([1, 2, 3]);
  expect(readImages(dir)).toEqual(all);
});

it('a missing or broken list reads as none', () => {
  const { dir } = setup();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(readImages(dir)).toEqual([]);
  expect(warn).not.toHaveBeenCalled();

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'images.json'), '{not json');
  expect(readImages(dir)).toEqual([]);
  // One entry of the wrong shape makes the list unusable: indexes into what is left would point at other images.
  writeFileSync(join(dir, 'images.json'), JSON.stringify([{ number: 1, path: '/a.png', name: 'a.png' }, { number: '2', path: '/b.png', name: 'b.png' }]));
  expect(readImages(dir)).toEqual([]);
  expect(warn).toHaveBeenCalledTimes(2);
});

it('clearing removes the folder and the list', () => {
  const { pasteDir, dir, file } = setup();
  recordImages(dir, [{ path: file(join(pasteDir, 'a.png')), number: 1 }], pasteDir);

  clearImages(dir);

  expect(existsSync(dir)).toBe(false);
  expect(readImages(dir)).toEqual([]);
  // A folder that isn't there is nothing to clear.
  expect(() => clearImages(dir)).not.toThrow();
});

it("each entry keeps its file's size and modified time, and a file that changes after is no longer its image", () => {
  const { root, pasteDir, dir, file } = setup();
  const dropped = file(join(root, 'shot.png'));
  const [pasted, listed] = recordImages(dir, [{ path: file(join(pasteDir, 'a.png')), number: 1 }, { path: dropped, number: 2 }], pasteDir);

  expect(pasted).toMatchObject({ size: statSync(pasted.path).size, mtimeMs: statSync(pasted.path).mtimeMs });
  expect(listed).toMatchObject({ size: 3, mtimeMs: statSync(dropped).mtimeMs });
  expect(unchanged(listed)).toBe(true);

  writeFileSync(dropped, 'another png');
  expect(unchanged(listed)).toBe(false);
  // Same size, another time: also another file.
  writeFileSync(pasted.path, 'png');
  utimesSync(pasted.path, new Date(2020, 0, 1), new Date(2020, 0, 1));
  expect(unchanged(pasted)).toBe(false);
  rmSync(dropped);
  expect(unchanged(listed)).toBe(false);
  // An entry from before sizes were kept goes by its path alone, as before.
  expect(unchanged({ number: 1, path: '/not/checked.png', name: 'checked.png' })).toBe(true);
});

it("a list that is there but can't be used is never written over", () => {
  const { root, pasteDir, dir, file } = setup();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'images.json'), '{not json');

  expect(recordImages(dir, [{ path: file(join(pasteDir, 'a.png')), number: 1 }, { path: file(join(root, 'b.png')), number: 2 }], pasteDir)).toEqual([]);

  expect(readFileSync(join(dir, 'images.json'), 'utf8')).toBe('{not json');
  expect(existsSync(join(dir, 'a.png'))).toBe(false);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('records no images'));
});

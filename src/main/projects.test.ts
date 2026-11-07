import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { chooseProject, openProject } from './projects';

let root: string;
let dataDir: string;
let acme: string;
let globex: string;
const warn = () => {};

beforeEach(() => {
  root = mkdtempSync(join(os.tmpdir(), 'mainframe-projects-'));
  dataDir = join(root, 'data');
  acme = join(root, 'acme');
  globex = join(root, 'globex');
  for (const dir of [dataDir, acme, globex]) mkdirSync(dir);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const projectsFile = () => join(dataDir, 'projects.json');
const remember = (value: unknown) => writeFileSync(projectsFile(), JSON.stringify(value));
const remembered = () => JSON.parse(readFileSync(projectsFile(), 'utf8'));
const picker = (answer: string | undefined) => vi.fn(async () => answer);

describe('chooseProject', () => {
  it('asks for a folder the first time and remembers it', async () => {
    const pick = picker(acme);
    expect(await chooseProject({ dataDir, pick, warn })).toBe(acme);
    expect(remembered()).toEqual({ version: 1, open: [acme] });
  });

  it('opens the remembered folder without asking', async () => {
    remember({ version: 1, open: [acme] });
    const pick = picker(globex);
    expect(await chooseProject({ dataDir, pick, warn })).toBe(acme);
    expect(pick).not.toHaveBeenCalled();
  });

  it('asks again when the remembered folder has gone, and remembers the new one', async () => {
    remember({ version: 1, open: [join(root, 'gone')] });
    expect(await chooseProject({ dataDir, pick: picker(globex), warn })).toBe(globex);
    expect(remembered()).toEqual({ version: 1, open: [globex] });
  });

  it('opens nothing and remembers nothing when the owner cancels', async () => {
    expect(await chooseProject({ dataDir, pick: picker(undefined), warn })).toBeUndefined();
    expect(() => remembered()).toThrow('ENOENT');
  });

  it.each([
    ['is not JSON', '{'],
    ['has no version', JSON.stringify({ open: ['/x'] })],
    ['holds no list', JSON.stringify({ version: 1, open: '/x' })],
    ['lists a non-path', JSON.stringify({ version: 1, open: [7] })],
  ])('asks again when projects.json %s', async (_case, text) => {
    writeFileSync(projectsFile(), text);
    const pick = picker(acme);
    expect(await chooseProject({ dataDir, pick, warn })).toBe(acme);
    expect(pick).toHaveBeenCalledOnce();
  });

  it('leaves a projects.json from a newer Mainframe as it is, and says so', async () => {
    remember({ version: 2, open: [acme] });
    const pick = picker(globex);
    await expect(chooseProject({ dataDir, pick, warn })).rejects.toThrow('newer Mainframe');
    expect(pick).not.toHaveBeenCalled();
    expect(remembered()).toEqual({ version: 2, open: [acme] });
  });
});

describe('openProject', () => {
  it('remembers the picked folder and restarts on it', async () => {
    remember({ version: 1, open: [acme] });
    const restart = vi.fn();
    await openProject({ dataDir, current: acme, pick: picker(globex), restart });
    expect(remembered()).toEqual({ version: 1, open: [globex] });
    expect(restart).toHaveBeenCalledOnce();
  });

  it.each([
    ['the owner cancels', undefined],
    ['the owner picks the open folder', 'acme'],
  ])('changes nothing when %s', async (_case, answer) => {
    remember({ version: 1, open: [acme] });
    const restart = vi.fn();
    await openProject({ dataDir, current: acme, pick: picker(answer && join(root, answer)), restart });
    expect(remembered()).toEqual({ version: 1, open: [acme] });
    expect(restart).not.toHaveBeenCalled();
  });
});

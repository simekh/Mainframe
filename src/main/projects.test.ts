import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { chooseProjects, writeOpenProjects } from './projects';

let root: string;
let dataDir: string;
let acme: string;
let globex: string;
let warnings: string[];
const warn = (msg: string) => warnings.push(msg);

beforeEach(() => {
  root = mkdtempSync(join(os.tmpdir(), 'mainframe-projects-'));
  dataDir = join(root, 'data');
  acme = join(root, 'acme');
  globex = join(root, 'globex');
  for (const dir of [dataDir, acme, globex]) mkdirSync(dir);
  warnings = [];
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const projectsFile = () => join(dataDir, 'projects.json');
const remember = (value: unknown) => writeFileSync(projectsFile(), JSON.stringify(value));
const remembered = () => JSON.parse(readFileSync(projectsFile(), 'utf8'));
const picker = (answer: string | undefined) => vi.fn(async () => answer);

describe('chooseProjects', () => {
  it('asks for a folder the first time and remembers it', async () => {
    const pick = picker(acme);
    expect(await chooseProjects({ dataDir, pick, warn })).toEqual([acme]);
    expect(remembered()).toEqual({ version: 1, open: [acme] });
  });

  it('opens every remembered folder, in order, without asking', async () => {
    writeOpenProjects(dataDir, [globex, acme]);
    const pick = picker(undefined);
    expect(await chooseProjects({ dataDir, pick, warn })).toEqual([globex, acme]);
    expect(pick).not.toHaveBeenCalled();
  });

  it('leaves out a remembered folder that has gone, and says so', async () => {
    const gone = join(root, 'gone');
    writeOpenProjects(dataDir, [gone, acme]);
    const pick = picker(globex);
    expect(await chooseProjects({ dataDir, pick, warn })).toEqual([acme]);
    expect(pick).not.toHaveBeenCalled();
    expect(warnings).toEqual([`The project folder ${gone} has gone; Mainframe leaves it out`]);
  });

  it('asks again when every remembered folder has gone, and remembers the new one', async () => {
    writeOpenProjects(dataDir, [join(root, 'gone')]);
    expect(await chooseProjects({ dataDir, pick: picker(globex), warn })).toEqual([globex]);
    expect(remembered()).toEqual({ version: 1, open: [globex] });
  });

  it('opens nothing and remembers nothing when the owner cancels', async () => {
    expect(await chooseProjects({ dataDir, pick: picker(undefined), warn })).toEqual([]);
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
    expect(await chooseProjects({ dataDir, pick, warn })).toEqual([acme]);
    expect(pick).toHaveBeenCalledOnce();
  });

  it('leaves a projects.json from a newer Mainframe as it is, and says so', async () => {
    remember({ version: 2, open: [acme] });
    const pick = picker(globex);
    await expect(chooseProjects({ dataDir, pick, warn })).rejects.toThrow('newer Mainframe');
    expect(pick).not.toHaveBeenCalled();
    expect(remembered()).toEqual({ version: 2, open: [acme] });
  });
});

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { hasProjectsFile, rememberedProjects, writeOpenProjects } from './projects';

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

describe('rememberedProjects', () => {
  it('lists the remembered folders that are still there, in order, and says which one has gone', () => {
    const gone = join(root, 'gone');
    writeOpenProjects(dataDir, [globex, gone, acme]);
    expect(rememberedProjects(dataDir, warn)).toEqual([globex, acme]);
    expect(warnings).toEqual([`The project folder ${gone} has gone; Mainframe leaves it out`]);
  });

  it('writes nothing, and lists nothing when there is no file', () => {
    expect(rememberedProjects(dataDir, warn)).toEqual([]);
    expect(hasProjectsFile(dataDir)).toBe(false);
  });

  it.each([
    ['is not JSON', '{'],
    ['has no version', JSON.stringify({ open: ['/x'] })],
    ['holds no list', JSON.stringify({ version: 1, open: '/x' })],
    ['lists a non-path', JSON.stringify({ version: 1, open: [7] })],
  ])('lists nothing, and says so, when projects.json %s', (_case, text) => {
    writeFileSync(projectsFile(), text);
    expect(rememberedProjects(dataDir, warn)).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it('leaves a projects.json from a newer Mainframe as it is, and says so', () => {
    remember({ version: 2, open: [acme] });
    expect(() => rememberedProjects(dataDir, warn)).toThrow('newer Mainframe');
    expect(remembered()).toEqual({ version: 2, open: [acme] });
  });
});

describe('hasProjectsFile', () => {
  it('is false before projects are remembered, and true once the file is there', () => {
    expect(hasProjectsFile(dataDir)).toBe(false);
    writeOpenProjects(dataDir, []);
    expect(hasProjectsFile(dataDir)).toBe(true);
  });

  it('is true for a file that cannot be used: it was there', () => {
    writeFileSync(projectsFile(), '{');
    expect(hasProjectsFile(dataDir)).toBe(true);
  });
});

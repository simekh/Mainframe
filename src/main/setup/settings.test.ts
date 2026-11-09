import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSettings, writeSettings } from './settings';

let dataDir: string;
let warnings: string[];
const warn = (message: string) => warnings.push(message);

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'mainframe-settings-'));
  warnings = [];
});

afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

const file = () => join(dataDir, 'settings.json');
const onDisk = () => JSON.parse(readFileSync(file(), 'utf8'));

describe('settings.json', () => {
  it('reads back what was written, as a version 1 file', () => {
    const claudeBin = join(dataDir, 'claude');
    writeSettings(dataDir, { claudeBin, welcomeSeen: true });
    expect(onDisk()).toEqual({ version: 1, claudeBin, welcomeSeen: true });
    expect(readSettings(dataDir, warn)).toEqual({ claudeBin, welcomeSeen: true });
    expect(warnings).toEqual([]);
  });

  it('holds each entry on its own', () => {
    writeSettings(dataDir, { welcomeSeen: true });
    expect(readSettings(dataDir, warn)).toStrictEqual({ welcomeSeen: true });
    writeSettings(dataDir, { claudeBin: '/x/claude' });
    expect(readSettings(dataDir, warn)).toStrictEqual({ claudeBin: '/x/claude' });
    writeSettings(dataDir, {});
    expect(readSettings(dataDir, warn)).toStrictEqual({});
  });

  it('is empty, and quiet, when there is no file', () => {
    expect(readSettings(dataDir, warn)).toStrictEqual({});
    expect(warnings).toEqual([]);
  });

  it.each([
    ['is not JSON', '{'],
    ['is JSON null', 'null'],
    ['holds a list', '[]'],
    ['has no version', JSON.stringify({ claudeBin: '/x/claude' })],
    ['has an older version', JSON.stringify({ version: 0 })],
    ['holds a claudeBin that is no path', JSON.stringify({ version: 1, claudeBin: 7 })],
    ['holds a welcomeSeen that is no flag', JSON.stringify({ version: 1, welcomeSeen: 'yes' })],
  ])('is empty, with one warning, when the file %s', (_case, text) => {
    writeFileSync(file(), text);
    expect(readSettings(dataDir, warn)).toStrictEqual({});
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(file());
  });

  it('is empty, with one warning, when the file cannot be read', () => {
    mkdirSync(file());
    expect(readSettings(dataDir, warn)).toStrictEqual({});
    expect(warnings).toHaveLength(1);
  });

  it('refuses a file from a newer Mainframe, and leaves it as it is', () => {
    const text = JSON.stringify({ version: 2, claudeBin: '/x/claude' });
    writeFileSync(file(), text);
    expect(() => readSettings(dataDir, warn)).toThrow(
      'settings.json was written by a newer Mainframe; update this one, or move the file away',
    );
    expect(readFileSync(file(), 'utf8')).toBe(text);
    expect(warnings).toEqual([]);
  });
});

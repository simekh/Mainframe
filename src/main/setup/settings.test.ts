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
  it('a version 1 file reads as version 2', () => {
    writeFileSync(file(), JSON.stringify({ version: 1, claudeBin: '/x/claude', welcomeSeen: true }));
    expect(readSettings(dataDir, warn)).toStrictEqual({
      agents: { claude: { enabled: true, bin: '/x/claude' } },
      defaultAgent: 'claude',
      welcomeSeen: true,
    });
    expect(warnings).toEqual([]);
  });

  it('a version 1 file without claudeBin', () => {
    writeFileSync(file(), JSON.stringify({ version: 1 }));
    expect(readSettings(dataDir, warn)).toStrictEqual({ agents: { claude: { enabled: true } }, defaultAgent: 'claude' });
  });

  it('version 2 round-trips', () => {
    const settings = {
      agents: { claude: { enabled: false }, opencode: { enabled: true, bin: '/o', managerAgent: 'build', syncModel: 'p/m' } },
      defaultAgent: 'opencode' as const,
      welcomeSeen: true,
    };
    writeSettings(dataDir, settings);
    expect(onDisk()).toEqual({ version: 2, ...settings });
    expect(readSettings(dataDir, warn)).toStrictEqual(settings);
    expect(warnings).toEqual([]);
  });

  it('holds each entry on its own', () => {
    writeSettings(dataDir, { welcomeSeen: true });
    expect(readSettings(dataDir, warn)).toStrictEqual({ welcomeSeen: true });
    writeSettings(dataDir, { agents: { claude: { bin: '/x/claude' } } });
    expect(readSettings(dataDir, warn)).toStrictEqual({ agents: { claude: { bin: '/x/claude' } } });
    writeSettings(dataDir, {});
    expect(readSettings(dataDir, warn)).toStrictEqual({});
  });

  it('an unknown key is ignored and the rest kept, at the top and in an agent, for both versions', () => {
    writeFileSync(
      file(),
      JSON.stringify({ version: 2, later: 1, agents: { opencode: { enabled: true, later: 'x' } }, defaultAgent: 'opencode' }),
    );
    expect(readSettings(dataDir, warn)).toStrictEqual({ agents: { opencode: { enabled: true } }, defaultAgent: 'opencode' });
    writeFileSync(file(), JSON.stringify({ version: 1, claudeBin: '/x/claude', later: true }));
    expect(readSettings(dataDir, warn)).toStrictEqual({ agents: { claude: { enabled: true, bin: '/x/claude' } }, defaultAgent: 'claude' });
    expect(warnings).toEqual([]);
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
    ['holds a welcomeSeen that is no flag', JSON.stringify({ version: 2, welcomeSeen: 'yes' })],
    ['holds an agent that is unknown', JSON.stringify({ version: 2, agents: { gemini: {} } })],
    ['holds a default agent that is unknown', JSON.stringify({ version: 2, defaultAgent: 'gemini' })],
    ['holds a bin that is no path', JSON.stringify({ version: 2, agents: { claude: { bin: 7 } } })],
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

  it('a newer file is refused, and left as it is', () => {
    const text = JSON.stringify({ version: 3, claudeBin: '/x/claude' });
    writeFileSync(file(), text);
    expect(() => readSettings(dataDir, warn)).toThrow(
      'settings.json was written by a newer Mainframe; update this one, or move the file away',
    );
    expect(readFileSync(file(), 'utf8')).toBe(text);
    expect(warnings).toEqual([]);
  });
});

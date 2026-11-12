import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentName, ProgramCheck } from '../../shared/types';
import { ADAPTERS } from '../agents/adapters';
import { AgentsInUse } from './agentsInUse';
import { readSettings, type AppSettings } from './settings';

const C = '/bin/claude';
const O = '/bin/opencode';
const found = (path: string): ProgramCheck => ({ state: 'found', path, version: '9.9.9' });
const missing: ProgramCheck = { state: 'missing' };

const agents = (settings: AppSettings, checks: Record<AgentName, ProgramCheck>) =>
  new AgentsInUse({ dataDir: '/data', settings, checks, envBins: {} });

describe('AgentsInUse', () => {
  it('runs on the saved default while it works', () => {
    const a = agents({ defaultAgent: 'opencode' }, { claude: found(C), opencode: found(O) });
    expect(a.defaultAgent()).toBe('opencode');
    expect(a.fellBack()).toBe(false);
  });

  it('falls back to another ticked agent when the saved default does not work', () => {
    const a = agents({ defaultAgent: 'claude', agents: { claude: { enabled: true } } }, { claude: missing, opencode: found(O) });
    expect(a.defaultAgent()).toBe('opencode');
    expect(a.fellBack()).toBe(true);
  });

  it('ticked() leaves out an agent that is not found', () => {
    const a = agents({ agents: { claude: { enabled: true }, opencode: { enabled: true } } }, { claude: missing, opencode: found(O) });
    expect(a.ticked()).toEqual(['opencode']);
  });

  it('bin() is the found path, ticked or not, and null otherwise', () => {
    const a = agents({ agents: { opencode: { enabled: false } } }, { claude: found(C), opencode: found(O) });
    expect(a.ticked()).toEqual(['claude']);
    expect(a.bin('claude')).toBe(C);
    expect(a.bin('opencode')).toBe(O);
    expect(agents({}, { claude: found(C), opencode: missing }).bin('opencode')).toBeNull();
  });

  it('inUse() is the default agent with its adapter, path and setting', () => {
    const setting = { enabled: true, syncModel: 'm' };
    const a = agents({ defaultAgent: 'opencode', agents: { opencode: setting } }, { claude: found(C), opencode: found(O) });
    expect(a.inUse()).toEqual({ adapter: ADAPTERS.opencode, bin: O, setting });
    expect(agents({}, { claude: found(C), opencode: missing }).inUse()).toEqual({ adapter: ADAPTERS.claude, bin: C, setting: {} });
  });

  it('saveAgentSetting writes settings.json and inUse() sees it', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'mainframe-agents-'));
    try {
      const settings: AppSettings = { defaultAgent: 'opencode', agents: { opencode: { enabled: true, syncModel: 'p/old' } }, welcomeSeen: true };
      const a = new AgentsInUse({ dataDir, settings, checks: { claude: found(C), opencode: found(O) }, envBins: {} });

      a.saveAgentSetting('opencode', { syncModel: 'p/new' });

      const setting = { enabled: true, syncModel: 'p/new' };
      expect(a.inUse().setting).toEqual(setting);
      expect(JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'))).toEqual({
        version: 2,
        defaultAgent: 'opencode',
        agents: { opencode: setting },
        welcomeSeen: true,
      });
      expect(readSettings(dataDir, () => {})).toEqual({ defaultAgent: 'opencode', agents: { opencode: setting }, welcomeSeen: true });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

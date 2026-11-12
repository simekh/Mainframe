import { describe, expect, it } from 'vitest';
import type { ProgramCheck, SettingsView } from '../../../shared/types';
import { defaultChoice } from './defaultChoice';

const found: ProgramCheck = { state: 'found', path: '/bin/x', version: '9.9.9' };
const missing: ProgramCheck = { state: 'missing' };

const view = (o: { claude: [ProgramCheck, boolean]; opencode: [ProgramCheck, boolean]; defaultAgent: 'claude' | 'opencode'; runDefault: 'claude' | 'opencode' }): SettingsView => ({
  agents: {
    claude: { check: o.claude[0], fromEnv: false, ticked: o.claude[1] },
    opencode: { check: o.opencode[0], fromEnv: false, ticked: o.opencode[1] },
  },
  defaultAgent: o.defaultAgent,
  runDefault: o.runDefault,
});

describe('defaultChoice', () => {
  it('offers both while two ticked agents work', () => {
    expect(defaultChoice(view({ claude: [found, true], opencode: [found, true], defaultAgent: 'claude', runDefault: 'claude' }))).toEqual([
      { name: 'claude', works: true },
      { name: 'opencode', works: true },
    ]);
  });

  it('offers nothing while one ticked agent works and it is the saved default', () => {
    expect(defaultChoice(view({ claude: [found, true], opencode: [found, false], defaultAgent: 'claude', runDefault: 'claude' }))).toEqual([]);
    expect(defaultChoice(view({ claude: [missing, false], opencode: [found, true], defaultAgent: 'opencode', runDefault: 'opencode' }))).toEqual([]);
  });

  it('while another agent stands in, lists the saved default as not choosable and the stand-in as choosable', () => {
    expect(defaultChoice(view({ claude: [missing, true], opencode: [found, true], defaultAgent: 'claude', runDefault: 'opencode' }))).toEqual([
      { name: 'claude', works: false },
      { name: 'opencode', works: true },
    ]);
  });
});

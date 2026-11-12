import { describe, expect, it } from 'vitest';
import type { AgentView, SettingsView } from '../../../shared/types';
import { newTaskAgents } from './newTaskAgents';

const found: AgentView = { check: { state: 'found', path: '/bin/x', version: '2.1.300' }, fromEnv: false, ticked: true };

const view = (claude: Partial<AgentView>, opencode: Partial<AgentView>, runDefault: 'claude' | 'opencode' = 'claude'): SettingsView => ({
  agents: { claude: { ...found, ...claude }, opencode: { ...found, ...opencode } },
  defaultAgent: runDefault,
  runDefault,
});

describe('newTaskAgents', () => {
  it('offers both ticked, found agents and starts on the default', () => {
    expect(newTaskAgents(view({}, {}, 'opencode'))).toEqual({ options: ['claude', 'opencode'], start: 'opencode', hints: [] });
  });

  it('leaves out an unticked agent without a hint', () => {
    expect(newTaskAgents(view({}, { ticked: false }))).toEqual({ options: ['claude'], start: 'claude', hints: [] });
  });

  it('says why a ticked agent that is too old is not offered', () => {
    const old: Partial<AgentView> = { check: { state: 'too-old', path: '/bin/opencode', version: '1.18.35' } };
    expect(newTaskAgents(view({}, old)).hints).toEqual(['OpenCode 1.18.35 is installed. Mainframe needs 2.1.0 or later.']);
  });

  it('says why a ticked agent that is broken is not offered', () => {
    const broken: Partial<AgentView> = { check: { state: 'broken', path: '/bin/opencode' } };
    expect(newTaskAgents(view({}, broken)).hints).toEqual(["The opencode at /bin/opencode didn't say its version, so Mainframe can't use it."]);
  });

  it('gives an OpenCode-only view that agent alone', () => {
    expect(newTaskAgents(view({ ticked: false }, {}, 'opencode'))).toEqual({ options: ['opencode'], start: 'opencode', hints: [] });
  });
});

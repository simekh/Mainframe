import { describe, expect, it } from 'vitest';
import type { AgentName, ProgramCheck } from '../../shared/types';
import { runDefault, tickedAgents } from './agentChoice';

const found: ProgramCheck = { state: 'found', path: '/x' };
const broken: ProgramCheck = { state: 'broken' };
const missing: ProgramCheck = { state: 'missing' };
const checks = (claude: ProgramCheck, opencode: ProgramCheck): Record<AgentName, ProgramCheck> => ({ claude, opencode });

describe('tickedAgents', () => {
  it('ticks an agent with no saved choice only when it is found', () => {
    expect(tickedAgents({}, checks(found, missing))).toEqual(['claude']);
    expect(tickedAgents({}, checks(found, found))).toEqual(['claude', 'opencode']);
  });

  it('never ticks enabled: false', () => {
    expect(tickedAgents({ agents: { claude: { enabled: false } } }, checks(found, found))).toEqual(['opencode']);
  });

  it('ticks enabled: true even when broken', () => {
    expect(tickedAgents({ agents: { opencode: { enabled: true } } }, checks(missing, broken))).toEqual(['opencode']);
  });
});

describe('runDefault', () => {
  it('runs a saved default that works', () => {
    expect(runDefault({ defaultAgent: 'opencode' }, checks(found, found))).toBe('opencode');
  });

  it('falls back to the other ticked, found agent when the saved default is broken', () => {
    expect(runDefault({ defaultAgent: 'opencode', agents: { opencode: { enabled: true } } }, checks(found, broken))).toBe('claude');
  });

  it('is null when no ticked agent is found', () => {
    expect(runDefault({ agents: { claude: { enabled: true }, opencode: { enabled: false } } }, checks(broken, found))).toBeNull();
    expect(runDefault({}, checks(missing, missing))).toBeNull();
  });

  it('takes the first ticked agent when no default is saved', () => {
    expect(runDefault({}, checks(found, found))).toBe('claude');
  });
});

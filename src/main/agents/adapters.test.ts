import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { AGENT_NAMES, type AgentName } from '../../shared/types';
import { buildSpawnEnv } from '../pty/spawnEnv';
import { ADAPTERS } from './adapters';
import type { TaskStart } from './agent';
import { startArgv } from './claude';
import { OPENCODE_ENV } from './opencode';

const UUID_1 = '0b7e8a52-2f4c-4f7e-9a51-6d2c3c1b9e10';

describe('the agent adapters', () => {
  let dir: string;
  let o: TaskStart;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mainframe-adapters-'));
    o = { bin: 'claude', nodeBin: 'node', taskDir: dir, slug: 's', name: 'p-s', sessionId: UUID_1, prompt: 'P' };
  });

  it('each adapter is filed under its own name', () => {
    for (const name of Object.keys(AGENT_NAMES) as AgentName[]) expect(ADAPTERS[name].name).toBe(name);
  });

  it('Claude Code makes its own worktree, and Mainframe makes OpenCode its worktree', () => {
    expect(ADAPTERS.claude.mainframeAddsWorktree).toBe(false);
    expect(ADAPTERS.opencode.mainframeAddsWorktree).toBe(true);
    expect(ADAPTERS.claude.worktreesDir).toBe('.claude/worktrees');
    expect(ADAPTERS.opencode.worktreesDir).toBe('.mainframe/worktrees');
  });

  it("a Claude task's start is today's argv, with no env", () => {
    expect(ADAPTERS.claude.taskStart(o)).toEqual({
      argv: startArgv({ claudeBin: 'claude', slug: 's', name: 'p-s', claudeSessionId: UUID_1, settingsPath: join(dir, 'settings.json'), prompt: 'P' }),
    });
  });

  it("an OpenCode task's start carries the tabs-off env", () => {
    expect(ADAPTERS.opencode.taskStart({ ...o, bin: 'oc', sessionId: 'ses_' + 'a'.repeat(28) }).env).toEqual(OPENCODE_ENV);
  });

  it('a session drops every key an adapter names, and keeps the rest', () => {
    for (const key of Object.values(ADAPTERS).flatMap((a) => a.droppedEnv)) {
      const env = buildSpawnEnv({ [key]: '1', KEEP: '1' }, 'darwin');
      expect(env).not.toHaveProperty(key);
      expect(env.KEEP).toBe('1');
    }
  });
});

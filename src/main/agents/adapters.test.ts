import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { AGENT_NAMES, type AgentName } from '../../shared/types';
import { buildSpawnEnv } from '../pty/spawnEnv';
import { ADAPTERS } from './adapters';
import type { TaskStart } from './agent';
import { SESSION_START_FILE, startArgv } from './claude';
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

  it("a Claude task's start is today's argv, with no env, answered early", () => {
    expect(ADAPTERS.claude.taskStart(o)).toEqual({
      argv: startArgv({ claudeBin: 'claude', slug: 's', name: 'p-s', claudeSessionId: UUID_1, settingsPath: join(dir, 'settings.json'), prompt: 'P' }),
      answerStatusEarly: true,
    });
    expect(ADAPTERS.claude.taskReopen({ ...o, prompt: undefined }).answerStatusEarly).toBe(true);
  });

  it("an OpenCode task's start carries the tabs-off env, and is answered only when it asks", () => {
    const start = ADAPTERS.opencode.taskStart({ ...o, bin: 'oc', sessionId: 'ses_' + 'a'.repeat(28) });
    expect(start.env).toEqual(OPENCODE_ENV);
    expect(start.answerStatusEarly).toBeUndefined();
  });

  it("a Claude task began once SessionStart recorded its conversation; forgetChat drops that record", () => {
    const taskDir = mkdtempSync(join(tmpdir(), 'mainframe-began-'));
    // The task's own flag is OpenCode's: it says nothing of a Claude task.
    expect(ADAPTERS.claude.began(taskDir, { began: true })).toBe(false);
    writeFileSync(join(taskDir, SESSION_START_FILE), JSON.stringify({ session_id: UUID_1, source: 'startup' }));
    expect(ADAPTERS.claude.began(taskDir, {})).toBe(true);
    ADAPTERS.claude.forgetChat(taskDir);
    expect(existsSync(join(taskDir, SESSION_START_FILE))).toBe(false);
    expect(ADAPTERS.claude.began(taskDir, {})).toBe(false);
  });

  it('an OpenCode task began once it took the brief, whatever its folder holds; forgetChat leaves the folder alone', () => {
    const taskDir = mkdtempSync(join(tmpdir(), 'mainframe-began-'));
    writeFileSync(join(taskDir, SESSION_START_FILE), JSON.stringify({ session_id: UUID_1, source: 'startup' }));
    expect(ADAPTERS.opencode.began(taskDir, {})).toBe(false);
    expect(ADAPTERS.opencode.began(taskDir, { began: true })).toBe(true);
    ADAPTERS.opencode.forgetChat(taskDir);
    expect(existsSync(join(taskDir, SESSION_START_FILE))).toBe(true);
  });

  it('a session drops every key an adapter names, and keeps the rest', () => {
    for (const key of Object.values(ADAPTERS).flatMap((a) => a.droppedEnv)) {
      const env = buildSpawnEnv({ [key]: '1', KEEP: '1' }, 'darwin');
      expect(env).not.toHaveProperty(key);
      expect(env.KEEP).toBe('1');
    }
  });
});

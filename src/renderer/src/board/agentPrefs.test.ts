import { describe, it, expect } from 'vitest';
import { loadAgent, saveAgent } from './agentPrefs';

/** A Storage stand-in over a plain map. */
function memoryStorage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe('agentPrefs', () => {
  it('starts on Claude Code when nothing is stored', () => {
    expect(loadAgent(memoryStorage(), '/acme', true)).toBe('claude');
  });

  it('keeps OpenCode per project, and only while OpenCode is found', () => {
    const storage = memoryStorage();
    saveAgent(storage, '/acme', 'opencode');
    expect(storage.map.get('mainframe.new-task-agent:/acme')).toBe('opencode');
    expect(loadAgent(storage, '/acme', true)).toBe('opencode');
    expect(loadAgent(storage, '/acme', false)).toBe('claude');
    expect(loadAgent(storage, '/globex', true)).toBe('claude');

    saveAgent(storage, '/acme', 'claude');
    expect(loadAgent(storage, '/acme', true)).toBe('claude');
  });

  it('a storage that refuses the write leaves the pick for this run only', () => {
    const full = {
      setItem: () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      },
    };
    expect(() => saveAgent(full, '/acme', 'opencode')).not.toThrow();
  });
});

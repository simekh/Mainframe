import { expect } from 'vitest';
import type { VersionRunner } from '../setup/programChecks';

/** A fake `run`: each file's stdout, or null for a file that can't run. It records what it was asked to run. */
export function fakeRun(outputs: Record<string, string | null>): VersionRunner & { calls: string[] } {
  const calls: string[] = [];
  const run = async (file: string, args: string[]) => {
    calls.push(file);
    expect(args).toEqual(['--version']);
    return outputs[file] ?? null;
  };
  return Object.assign(run, { calls });
}

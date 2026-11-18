import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SESSION_START_FILE } from './claude';
import { readResumableSession } from './claudeChat';

const U = '0b7e8a52-2f4c-4f7e-9a51-6d2c3c1b9e10';

/**
 * A session folder whose SessionStart payload is `payload(<projects>/-main/<U>.jsonl)`, beside Claude Code's
 * projects folder with a project folder for the main checkout and one for a worktree. `saveIn` writes a
 * chat's transcript.
 */
function recordedIn(payload: (transcriptPath: string) => object) {
  const root = mkdtempSync(join(tmpdir(), 'mainframe-recorded-'));
  const dir = join(root, 'session');
  const projects = join(root, 'projects');
  mkdirSync(dir);
  mkdirSync(join(projects, '-main'), { recursive: true });
  mkdirSync(join(projects, '-worktree'));
  writeFileSync(join(dir, SESSION_START_FILE), JSON.stringify(payload(join(projects, '-main', `${U}.jsonl`))));
  const saveIn = (folder: string, id = U) => writeFileSync(join(projects, folder, `${id}.jsonl`), '');
  return { dir, saveIn };
}

/** A SessionStart payload of `source` (none when undefined) that names its transcript. */
const startedBy = (source?: string) => (transcript_path: string) => ({ session_id: U, source, transcript_path });

// Only a chat that began (startup) or was cleared (clear) can be unsaved: it exists on disk once it has a message.
// Any other source continues a chat that was resumed, compacted or forked, so it has been saved.
it.each([['resume'], ['compact'], ['fork'], [undefined]])('a %s record is resumable though no transcript is saved', (source) => {
  expect(readResumableSession(recordedIn(startedBy(source)).dir)).toBe(U);
});

it.each([['startup'], ['clear']])('a %s record is not resumable while no project folder holds its chat, whatever others hold', (source) => {
  const { dir, saveIn } = recordedIn(startedBy(source));
  saveIn('-worktree', '11111111-1111-4111-8111-111111111111');
  expect(readResumableSession(dir)).toBeNull();
});

it('a startup record is resumable once Claude Code has saved the chat in the folder it named', () => {
  const { dir, saveIn } = recordedIn(startedBy('startup'));
  saveIn('-main');
  expect(readResumableSession(dir)).toBe(U);
});

// A chat resumed from the main checkout, as when a task's worktree branch is gone, records the main checkout's
// project folder, but Claude Code finds the chat in the worktree's and keeps writing it there.
it('a startup record is resumable when the chat is saved in another project folder than the one named', () => {
  const { dir, saveIn } = recordedIn(startedBy('startup'));
  saveIn('-worktree');
  expect(readResumableSession(dir)).toBe(U);
});

it('a startup record is not resumable when the projects folder cannot be read', () => {
  const { dir } = recordedIn((transcript_path) => startedBy('startup')(transcript_path.replace('projects', 'gone')));
  expect(readResumableSession(dir)).toBeNull();
});

it('a startup record that names no transcript is not resumable', () => {
  const { dir, saveIn } = recordedIn(() => ({ session_id: U, source: 'startup' }));
  saveIn('-main');
  expect(readResumableSession(dir)).toBeNull();
});

it('nothing is resumable while SessionStart has not fired', () => {
  expect(readResumableSession(mkdtempSync(join(tmpdir(), 'mainframe-recorded-')))).toBeNull();
});

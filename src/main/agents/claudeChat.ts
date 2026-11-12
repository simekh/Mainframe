import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readRecordedStart } from './claude';

/**
 * The conversation SessionStart recorded in `dir`, when `claude --resume` can open it. The manager may never
 * have been typed to, and Claude Code writes a chat's transcript with its first message. Only the manager
 * looks: tasks launch with a prompt, and stay off Claude Code's undocumented layout of chat files.
 */
export function readResumableSession(dir: string): string | null {
  const start = readRecordedStart(dir);
  if (start === null) return null;
  // Only a chat that has just begun (startup) or been cleared (clear) can be unsaved. Any other source
  // (resume, compact, fork) continues one that has been, so it is resumed without a look at Claude Code's files.
  if (start.source !== 'startup' && start.source !== 'clear') return start.id;
  if (start.transcriptPath === undefined) return null;
  // Any project folder under Claude Code's projects folder may hold the chat, not only the one the payload
  // names: a chat resumed from the main checkout, as when a task's worktree branch is gone, names the main
  // checkout's folder while it stays in the worktree's. Ids are UUIDs, so a file of that name elsewhere is it.
  const projects = dirname(dirname(start.transcriptPath));
  try {
    return readdirSync(projects).some((folder) => existsSync(join(projects, folder, `${start.id}.jsonl`))) ? start.id : null;
  } catch {
    return null;
  }
}

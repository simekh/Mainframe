import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readRecordedStart } from './claude';

/**
 * Whether Claude Code has the chat `id` saved. Any project folder under Claude Code's projects folder may hold it,
 * not only the one `transcriptPath` names: a chat resumed from the main checkout, as a task's once was when its
 * worktree branch was gone, names the main checkout's folder while it stays in the worktree's. Ids are UUIDs, so a
 * file of that name elsewhere is it.
 */
function chatSaved(id: string, transcriptPath: string): boolean {
  const projects = dirname(dirname(transcriptPath));
  try {
    return readdirSync(projects).some((folder) => existsSync(join(projects, folder, `${id}.jsonl`)));
  } catch {
    return false;
  }
}

/**
 * The conversation SessionStart recorded in `dir`, when `claude --resume` can open it. The manager may never
 * have been typed to, and Claude Code writes a chat's transcript with its first message. A task's Reopen doesn't
 * look: tasks launch with a prompt. Only the manager, and a task's Continue (`chatKept`), read Claude Code's
 * undocumented layout of chat files.
 */
export function readResumableSession(dir: string): string | null {
  const start = readRecordedStart(dir);
  if (start === null) return null;
  // Only a chat that has just begun (startup) or been cleared (clear) can be unsaved. Any other source
  // (resume, compact, fork) continues one that has been, so it is resumed without a look at Claude Code's files.
  if (start.source !== 'startup' && start.source !== 'clear') return start.id;
  if (start.transcriptPath === undefined) return null;
  return chatSaved(start.id, start.transcriptPath) ? start.id : null;
}

/**
 * Whether a task's chat is still there to resume: Claude Code deletes chats older than its `cleanupPeriodDays`,
 * whatever their source. A record that names no transcript gives nothing to look for, so its chat counts as kept.
 */
export function chatKept(dir: string): boolean {
  const start = readRecordedStart(dir);
  return start !== null && (start.transcriptPath === undefined || chatSaved(start.id, start.transcriptPath));
}

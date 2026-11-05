// Adapted from Parallel Code (MIT): src/components/next-attention-task.ts (stepInQueue) at 97c3558. See THIRD_PARTY_NOTICES.md.
import type { ProgramKind, TaskView } from '../../../shared/types';
import type { SessionState } from '../taskModel';

export type Lane = 'needs-you' | 'working' | 'closed';
export type Glyph = 'ask' | 'error' | 'spin' | 'start' | 'ready' | 'wait' | 'dot';
export type Tone = 'warn' | 'error' | 'strong' | 'muted' | 'subtle' | 'accent';

/** One row of the lane table: where a task stands, from its session's OSC 7501 reports. */
type Standing = 'closed' | 'starting' | 'waiting' | 'working' | 'blocked' | 'done' | 'error';

const ROWS: Record<Standing, { lane: Lane; glyph: Glyph; label: string; tone: Tone }> = {
  closed: { lane: 'closed', glyph: 'dot', label: 'Closed', tone: 'subtle' },
  starting: { lane: 'working', glyph: 'start', label: 'Starting…', tone: 'muted' },
  waiting: { lane: 'needs-you', glyph: 'wait', label: 'Waiting for you', tone: 'muted' },
  working: { lane: 'working', glyph: 'spin', label: 'Working', tone: 'accent' },
  blocked: { lane: 'needs-you', glyph: 'ask', label: 'Needs input', tone: 'warn' },
  done: { lane: 'needs-you', glyph: 'ready', label: 'Finished its turn', tone: 'strong' },
  error: { lane: 'needs-you', glyph: 'error', label: 'Stopped', tone: 'error' },
};

/** Why a blocked session without a `msg` needs the owner. */
const BLOCKED_BY: Record<ProgramKind, string> = {
  permission: 'Waiting for your permission',
  question: 'Asking you a question',
  auth: 'Needs you to sign in',
};

function standingOf(task: TaskView, s: SessionState | undefined): Standing {
  if (!task.session) return 'closed';
  if (!s?.status) return 'starting';
  // Idle until Claude submits the opening prompt: without this, every new task would flash
  // through Needs you.
  if (s.status.state === 'idle') return task.session.startedWithPrompt && !s.started ? 'starting' : 'waiting';
  return s.status.state;
}

export const laneOf = (task: TaskView, s: SessionState | undefined): Lane => ROWS[standingOf(task, s)].lane;

export const glyphOf = (task: TaskView, s: SessionState | undefined): Glyph => ROWS[standingOf(task, s)].glyph;

export function stateLabel(task: TaskView, s: SessionState | undefined): { text: string; tone: Tone } {
  const row = ROWS[standingOf(task, s)];
  return { text: row.label, tone: row.tone };
}

/** Claude's own line while it has one; the branch otherwise, or the reason it needs the owner. */
export function cardActivity(
  task: TaskView,
  s: SessionState | undefined,
): { text: string; kind: 'msg' | 'busy' | 'branch' } {
  const standing = standingOf(task, s);
  if (standing === 'starting') return { text: 'Starting…', kind: 'busy' };
  const status = s?.status;
  if (standing !== 'closed' && status?.msg) return { text: status.msg, kind: 'msg' };
  if (standing === 'blocked') return { text: status?.kind ? BLOCKED_BY[status.kind] : 'Blocked', kind: 'busy' };
  if (standing === 'error') return { text: 'Stopped with an error', kind: 'busy' };
  return { text: task.branch, kind: 'branch' };
}

/** How long the task has been in its state: since it closed, or since its session's state changed. */
export function cardAge(task: TaskView, s: SessionState | undefined, now: number): string {
  const from = task.session ? s?.since : task.closedAt;
  if (from == null) return '';
  const minutes = Math.floor((now - from) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h`;
}

/** Each lane's tasks in board order. Open lanes go oldest first (to-do order until plan 2b). */
export function laneOrder(tasks: TaskView[], sessions: Record<string, SessionState>): Record<Lane, TaskView[]> {
  const lanes: Record<Lane, TaskView[]> = { 'needs-you': [], working: [], closed: [] };
  for (const task of tasks) lanes[laneOf(task, task.session ? sessions[task.session.id] : undefined)].push(task);
  lanes['needs-you'].sort((a, b) => a.createdAt - b.createdAt);
  lanes.working.sort((a, b) => a.createdAt - b.createdAt);
  lanes.closed.sort((a, b) => b.createdAt - a.createdAt);
  return lanes;
}

/**
 * The queue entry `step` places from `current`, wrapping around. When `current` is not in the queue
 * (nothing selected, or a task that doesn't need the owner), it starts at the first entry going
 * forward and the last going back. A queue of one gives that one again.
 */
export function nextNeedsYou(queue: string[], current: string | null, step: 1 | -1): string | null {
  if (queue.length === 0) return null;
  const at = current === null ? -1 : queue.indexOf(current);
  if (at === -1) return queue[step === 1 ? 0 : queue.length - 1];
  return queue[(at + step + queue.length) % queue.length];
}

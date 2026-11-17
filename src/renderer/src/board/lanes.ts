// Adapted from Parallel Code (MIT): src/components/next-attention-task.ts (stepInQueue) at 97c3558. See THIRD_PARTY_NOTICES.md.
import type { ProgramKind, TaskView, TodoCard } from '../../../shared/types';
import { onBoard, type SessionState } from '../taskModel';

export type Lane = 'needs-you' | 'working' | 'paused' | 'done';
export type Glyph = 'ask' | 'error' | 'spin' | 'start' | 'ready' | 'wait' | 'dot';
export type Tone = 'warn' | 'error' | 'strong' | 'muted' | 'subtle' | 'accent' | 'success';

/** One row of the lane table: where a task stands, from its session's OSC 7501 reports. */
type Standing = 'closed' | 'starting' | 'waiting' | 'working' | 'blocked' | 'done' | 'error';

const ROWS: Record<Standing, { lane: Lane; glyph: Glyph; label: string; tone: Tone }> = {
  closed: { lane: 'paused', glyph: 'dot', label: 'Paused', tone: 'subtle' },
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

/** A task's, or the manager's: both have a session of the same shape. */
type HasSession = Pick<TaskView, 'session'>;

function standingOf(task: HasSession, s: SessionState | undefined): Standing {
  if (!task.session) return 'closed';
  if (!s?.status) return 'starting';
  // Idle until Claude submits the opening prompt: without this, every new task would flash
  // through Needs you.
  if (s.status.state === 'idle') return task.session.startedWithPrompt && !s.started ? 'starting' : 'waiting';
  return s.status.state;
}

/**
 * The table's lane, but Done for a running task the round found merged once its turn is over: its card says Merged and
 * offers Finish. A question, a permission prompt or an error still needs the owner; a Put back's session closes itself.
 */
export function laneOf(task: TaskView, s: SessionState | undefined): Lane {
  const standing = standingOf(task, s);
  if (task.merged && !task.puttingBack && (standing === 'done' || standing === 'waiting')) return 'done';
  return ROWS[standing].lane;
}

export const glyphOf = (task: HasSession, s: SessionState | undefined): Glyph => ROWS[standingOf(task, s)].glyph;

export function stateLabel(task: HasSession, s: SessionState | undefined): { text: string; tone: Tone } {
  const row = ROWS[standingOf(task, s)];
  return { text: row.label, tone: row.tone };
}

/**
 * Claude's own line while it has one; the branch otherwise, or the reason it needs the owner, or why Put back or a
 * removal of its worktree failed. A Put back under way says so over all of these.
 */
export function cardActivity(
  task: TaskView,
  s: SessionState | undefined,
): { text: string; kind: 'msg' | 'busy' | 'branch' | 'problem' } {
  if (task.puttingBack) return { text: 'Putting back…', kind: 'busy' };
  const standing = standingOf(task, s);
  if (standing === 'starting') return { text: 'Starting…', kind: 'busy' };
  if (standing === 'closed' && task.problem) return { text: task.problem, kind: 'problem' };
  const status = s?.status;
  if (standing !== 'closed' && status?.msg) return { text: status.msg, kind: 'msg' };
  if (standing === 'blocked') return { text: status?.kind ? BLOCKED_BY[status.kind] : 'Blocked', kind: 'busy' };
  if (standing === 'error') return { text: 'Stopped with an error', kind: 'busy' };
  return { text: task.branch, kind: 'branch' };
}

/** What a card offers on its last row: Answer, Finish on a Done card, or a Paused card's three. */
export type CardAct = 'answer' | 'finish' | 'paused';

/**
 * The card's last row, its label and what it offers; none in Working, where the session is busy, nor on a Paused card
 * while a Put back runs. A Done card says Merged and offers Finish.
 */
export function cardAsk(
  task: TaskView,
  s: SessionState | undefined,
  lane: Lane,
): { text: string; tone: Tone; act: CardAct } | null {
  if (lane === 'working' || (lane === 'paused' && task.puttingBack)) return null;
  if (lane === 'done') return { text: 'Merged', tone: 'success', act: 'finish' };
  return { ...stateLabel(task, s), act: lane === 'paused' ? 'paused' : 'answer' };
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

/**
 * Each lane's tasks in board order. Needs you follows the to-do list as `listed` has it now (the synced cards, in
 * order): tasks whose card is urgent, then the other tasks with a card, each by the card's place in the list, then
 * tasks without a card, oldest first. A card no longer on the list goes after those on it, by its place and urgency
 * when its task started. Ties go oldest first. Working and Done go oldest first and Paused newest first. A task off the
 * board (put back, finished or discarded) is in no lane.
 */
export function laneOrder(
  tasks: TaskView[],
  sessions: Record<string, SessionState>,
  listed: readonly Pick<TodoCard, 'id' | 'urgent'>[] = [],
): Record<Lane, TaskView[]> {
  const lanes: Record<Lane, TaskView[]> = { 'needs-you': [], working: [], paused: [], done: [] };
  for (const task of tasks.filter(onBoard)) lanes[laneOf(task, task.session ? sessions[task.session.id] : undefined)].push(task);
  const place = new Map(listed.map((card, at) => [card.id, { at, urgent: card.urgent }]));
  const rank = (t: TaskView) => {
    if (!t.card) return { group: 2, at: 0 };
    const now = place.get(t.card.id) ?? { at: listed.length + t.card.position, urgent: t.card.urgent };
    return { group: now.urgent ? 0 : 1, at: now.at };
  };
  lanes['needs-you'].sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    return ra.group - rb.group || ra.at - rb.at || a.createdAt - b.createdAt;
  });
  lanes.working.sort((a, b) => a.createdAt - b.createdAt);
  lanes.done.sort((a, b) => a.createdAt - b.createdAt);
  lanes.paused.sort((a, b) => b.createdAt - a.createdAt);
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

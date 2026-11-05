import type { ProgramStatus, TaskView } from '../../shared/types';

/** What the renderer knows of one session from its OSC 7501 reports. */
export interface SessionState {
  status: ProgramStatus | null;
  /** Whether the session has reported anything other than `idle` yet. */
  started: boolean;
  /** When the state last changed; a new `msg` alone leaves it. */
  since: number;
}

export function nextSessionState(prev: SessionState | undefined, status: ProgramStatus | null, now: number): SessionState {
  return {
    status,
    started: (prev?.started ?? false) || (status !== null && status.state !== 'idle'),
    since: prev && prev.status?.state === status?.state ? prev.since : now,
  };
}

/** One mounted terminal: a session, and the task it belongs to. */
export interface TerminalEntry {
  sessionId: string;
  taskId: string;
}

/**
 * Gives each new session a terminal, in place of its task's earlier one. A closed task keeps its
 * last terminal so its final output stays readable. Unchanged entries keep their identity, so
 * their terminals stay mounted.
 */
export function updateTerminals(current: TerminalEntry[], tasks: TaskView[]): TerminalEntry[] {
  let next = current;
  for (const task of tasks) {
    const sessionId = task.session?.id;
    if (!sessionId || next.some((entry) => entry.sessionId === sessionId)) continue;
    const entry = { sessionId, taskId: task.id };
    const earlier = next.findIndex((e) => e.taskId === task.id);
    next = earlier === -1 ? [...next, entry] : next.map((e, i) => (i === earlier ? entry : e));
  }
  return next;
}

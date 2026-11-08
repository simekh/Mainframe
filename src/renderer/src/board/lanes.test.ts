import { describe, it, expect } from 'vitest';
import type { ProgramStatus, TaskView } from '../../../shared/types';
import type { SessionState } from '../taskModel';
import { cardActivity, cardAge, glyphOf, laneOf, laneOrder, nextNeedsYou, stateLabel } from './lanes';

const task = (over: Partial<TaskView> = {}): TaskView => ({
  id: 'a',
  title: 'Fix login',
  description: '',
  slug: 'fix-login',
  branch: 'worktree-fix-login',
  worktreePath: '/p/.claude/worktrees/fix-login',
  createdAt: 0,
  closedAt: null,
  card: null,
  session: { id: 's1', startedWithPrompt: true },
  ...over,
});

const closedTask = (over: Partial<TaskView> = {}) => task({ session: null, closedAt: 5, ...over });

const state = (
  s: ProgramStatus['state'],
  over: Partial<ProgramStatus> = {},
  rest: Partial<SessionState> = {},
): SessionState => ({ status: { state: s, id: '', updatedAt: 0, ...over }, started: true, since: 0, ...rest });

const branch = { text: 'worktree-fix-login', kind: 'branch' };
const starting = { text: 'Starting…', kind: 'busy' };

describe('the lane table', () => {
  it.each([
    ['session null', closedTask(), undefined, 'closed', 'dot', 'Closed', 'subtle', branch],
    ['no report yet', task(), undefined, 'working', 'start', 'Starting…', 'muted', starting],
    [
      'idle, startedWithPrompt and not started',
      task(),
      state('idle', {}, { started: false }),
      'working',
      'start',
      'Starting…',
      'muted',
      starting,
    ],
    ['idle otherwise', task(), state('idle'), 'needs-you', 'wait', 'Waiting for you', 'muted', branch],
    ['working', task(), state('working'), 'working', 'spin', 'Working', 'accent', branch],
    [
      'blocked, permission',
      task(),
      state('blocked', { kind: 'permission' }),
      'needs-you',
      'ask',
      'Needs input',
      'warn',
      { text: 'Waiting for your permission', kind: 'busy' },
    ],
    [
      'blocked, question',
      task(),
      state('blocked', { kind: 'question' }),
      'needs-you',
      'ask',
      'Needs input',
      'warn',
      { text: 'Asking you a question', kind: 'busy' },
    ],
    [
      'blocked, auth',
      task(),
      state('blocked', { kind: 'auth' }),
      'needs-you',
      'ask',
      'Needs input',
      'warn',
      { text: 'Needs you to sign in', kind: 'busy' },
    ],
    [
      'blocked, no kind',
      task(),
      state('blocked'),
      'needs-you',
      'ask',
      'Needs input',
      'warn',
      { text: 'Blocked', kind: 'busy' },
    ],
    ['done', task(), state('done'), 'needs-you', 'ready', 'Finished its turn', 'strong', branch],
    [
      'error',
      task(),
      state('error'),
      'needs-you',
      'error',
      'Stopped',
      'error',
      { text: 'Stopped with an error', kind: 'busy' },
    ],
  ])('%s', (_name, t, s, lane, glyph, label, tone, activity) => {
    expect(laneOf(t, s)).toBe(lane);
    expect(glyphOf(t, s)).toBe(glyph);
    expect(stateLabel(t, s)).toEqual({ text: label, tone });
    expect(cardActivity(t, s)).toEqual(activity);
  });

  it("blocked with a msg shows the msg as its activity", () => {
    const s = state('blocked', { kind: 'permission', msg: 'approve Bash: git status' });
    expect(cardActivity(task(), s)).toEqual({ text: 'approve Bash: git status', kind: 'msg' });
    expect(stateLabel(task(), s).text).toBe('Needs input');
  });

  it('a reopened session at idle needs you, without counting as starting', () => {
    const reopened = task({ session: { id: 's2', startedWithPrompt: false } });
    const s = state('idle', {}, { started: false });
    expect(laneOf(reopened, s)).toBe('needs-you');
    expect(glyphOf(reopened, s)).toBe('wait');
  });

  it('a closed task whose last state had a msg shows its branch, and a starting one says so', () => {
    expect(cardActivity(closedTask(), state('done', { msg: 'All tests pass' }))).toEqual(branch);
    expect(cardActivity(task(), state('idle', { msg: 'Reading the brief' }, { started: false }))).toEqual(starting);
  });
});

describe('cardAge', () => {
  it('cardAge reads closedAt for closed tasks and since otherwise', () => {
    const now = 10_000_000;
    expect(cardAge(task(), state('working', {}, { since: now - 30_000 }), now)).toBe('just now');
    expect(cardAge(task(), state('working', {}, { since: now - 12 * 60_000 }), now)).toBe('12 min');
    expect(cardAge(closedTask({ closedAt: now - 140 * 60_000 }), state('done', {}, { since: now }), now)).toBe('2 h');
    expect(cardAge(task(), undefined, now)).toBe('');
  });

  it('a closed task without closedAt has no age', () => {
    expect(cardAge(closedTask({ closedAt: null }), state('done', {}, { since: 0 }), 10_000_000)).toBe('');
  });
});

describe('laneOrder', () => {
  it('laneOrder sorts open lanes oldest first and Closed newest first', () => {
    const open = (id: string, createdAt: number, sessionId: string) =>
      task({ id, createdAt, session: { id: sessionId, startedWithPrompt: true } });
    const tasks = [
      open('w2', 20, 's-w2'),
      closedTask({ id: 'c1', createdAt: 10 }),
      open('n2', 40, 's-n2'),
      open('w1', 5, 's-w1'),
      closedTask({ id: 'c2', createdAt: 30 }),
      open('n1', 15, 's-n1'),
    ];
    const sessions = {
      's-w2': state('working'),
      's-n2': state('done'),
      's-n1': state('blocked', { kind: 'question' }),
    };
    const order = laneOrder(tasks, sessions);
    const ids = (lane: keyof typeof order) => order[lane].map((t) => t.id);
    expect(ids('needs-you')).toEqual(['n1', 'n2']);
    expect(ids('working')).toEqual(['w1', 'w2']);
    expect(ids('closed')).toEqual(['c2', 'c1']);
  });

  const cardAt = (position: number, urgent = false): TaskView['card'] => ({
    sourceKind: 'Tracker',
    id: `c${position}`,
    number: `#${position}`,
    url: null,
    labels: [],
    position,
    urgent,
  });

  const idsOf = (tasks: TaskView[], sessions: Record<string, SessionState>, lane: keyof ReturnType<typeof laneOrder>) =>
    laneOrder(tasks, sessions)[lane].map((t) => t.id);

  it('Needs you puts urgent cards first, then other cards by their place in the list, then tasks without a card by age', () => {
    const blocked = (id: string, createdAt: number, card: TaskView['card']) =>
      task({ id, createdAt, card, session: { id: `s-${id}`, startedWithPrompt: true } });
    const tasks = [
      blocked('loose-new', 30, null),
      blocked('listed', 50, cardAt(1)),
      blocked('urgent-second', 10, cardAt(5, true)),
      blocked('loose-old', 10, null),
      blocked('urgent-first', 60, cardAt(2, true)),
    ];
    const sessions = Object.fromEntries(tasks.map((t) => [t.session!.id, state('blocked', { kind: 'question' })]));
    expect(idsOf(tasks, sessions, 'needs-you')).toEqual([
      'urgent-first',
      'urgent-second',
      'listed',
      'loose-old',
      'loose-new',
    ]);
  });

  it('cards at the same place in the list go by age', () => {
    const blocked = (id: string, createdAt: number) =>
      task({ id, createdAt, card: cardAt(3), session: { id: `s-${id}`, startedWithPrompt: true } });
    const tasks = [blocked('newer', 20), blocked('older', 5)];
    const sessions = { 's-newer': state('done'), 's-older': state('done') };
    expect(idsOf(tasks, sessions, 'needs-you')).toEqual(['older', 'newer']);
  });

  it('Working and Closed keep their order whatever the cards', () => {
    const working = (id: string, createdAt: number, card: TaskView['card']) =>
      task({ id, createdAt, card, session: { id: `s-${id}`, startedWithPrompt: true } });
    const tasks = [
      working('w-urgent', 20, cardAt(0, true)),
      working('w-plain', 10, cardAt(9)),
      closedTask({ id: 'c-old', createdAt: 10, card: cardAt(0, true) }),
      closedTask({ id: 'c-new', createdAt: 30, card: cardAt(5) }),
    ];
    const sessions = { 's-w-urgent': state('working'), 's-w-plain': state('working') };
    expect(idsOf(tasks, sessions, 'working')).toEqual(['w-plain', 'w-urgent']);
    expect(idsOf(tasks, sessions, 'closed')).toEqual(['c-new', 'c-old']);
  });
});

describe('nextNeedsYou', () => {
  it('nextNeedsYou cycles the queue and starts at its end when nothing in it is selected', () => {
    const queue = ['a', 'b', 'c'];
    expect(nextNeedsYou(queue, 'a', 1)).toBe('b');
    expect(nextNeedsYou(queue, 'c', 1)).toBe('a');
    expect(nextNeedsYou(queue, 'a', -1)).toBe('c');
    expect(nextNeedsYou(queue, null, 1)).toBe('a');
    expect(nextNeedsYou(queue, 'x', 1)).toBe('a');
    expect(nextNeedsYou(queue, null, -1)).toBe('c');
    expect(nextNeedsYou(['a'], 'a', 1)).toBe('a');
    expect(nextNeedsYou([], null, 1)).toBeNull();
  });
});

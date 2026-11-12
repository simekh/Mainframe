import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AgentName, TaskView, TodoAsk, TodoItemRef, TodoNote, TodoNoteDraft, TodoView } from '../../shared/types';
import { cheapestKnown, type AgentAdapter, type AgentInUse, type AgentSetting, type SyncRunSpec } from '../agents/agent';
import { projectKey } from '../tasks/naming';
import type { TaskService } from '../tasks/taskService';
import { LONG_SYNC_MS, runSync, SYNC_STOPPED, SYNC_TIMEOUT_MS, type SyncStep } from './syncRun';
import { emptyTodo, loadTodo, NewerTodoError, saveTodo, type TodoRecord } from './todoFile';
import type { SyncAnswer } from './todoSchema';

const TODO_FILE = 'todo.json';
const UNASKED = "The sync run answered something Mainframe didn't ask for";

export interface TodoServiceDeps {
  projectDir: string;
  dataDir: string;
  /** What an agent's sync guard may run: a real program path; null when no node was found. */
  nodeBin: string | null;
  env: Record<string, string>;
  /** The agent the next sync runs on: asked at each sync, so a change in Settings takes effect at the next one. */
  agent(): AgentInUse;
  /** Saves an agent's setting for every project, so the next `agent()` has it. */
  saveAgentSetting(name: AgentName, patch: Partial<AgentSetting>): void;
  startTask: TaskService['start'];
  onChange(view: TodoView): void;
  run?: typeof runSync;
  newId?: () => string;
  now?: () => number;
  warn?: (msg: string) => void;
  /** Calls `fn` after `ms`; the function it returns cancels that. */
  setTimer?: (fn: () => void, ms: number) => () => void;
}

export type SyncOutcome = { cards: number } | { ask: TodoAsk['kind'] } | { error: string };

/** The sync run that is under way. Whatever a run answers after it stopped being this one is ignored. */
interface Running {
  outcome: Promise<SyncOutcome>;
  settle(outcome: SyncOutcome): void;
  cancel(): void;
  /** Whether it has gone on past LONG_SYNC_MS and the owner has not said to keep going. */
  long: boolean;
  stopTimer(): void;
}

/** One project's to-do list: the synced cards, the owner's notes, and the sync run that fills the cards. */
export class TodoService {
  private readonly dir: string;
  private readonly file: string;
  private readonly newId: () => string;
  private readonly now: () => number;
  /** Why the file is not used, when a newer Mainframe wrote it: this one then neither syncs nor saves. */
  private readonly newer: string | null = null;
  private record: TodoRecord;
  private running: Running | null = null;
  /** Once the project's close or the app's quit has begun, for good: no sync starts after it. */
  private closed = false;
  // What the sync last said: not kept in the file, so a restart starts without them.
  private ask: TodoAsk | null = null;
  /** The agent whose sync asked about tools or a model: the names in that ask are its own. */
  private askedBy: AgentName | null = null;
  private error: string | null = null;

  constructor(private readonly deps: TodoServiceDeps) {
    this.newId = deps.newId ?? randomUUID;
    this.now = deps.now ?? Date.now;
    this.dir = join(deps.dataDir, 'todo', projectKey(deps.projectDir));
    this.file = join(this.dir, TODO_FILE);
    try {
      this.record = loadTodo(this.file, this.now(), deps.warn ?? console.warn);
    } catch (err) {
      if (!(err instanceof NewerTodoError)) throw err;
      this.record = emptyTodo();
      this.newer = this.error = err.message;
    }
  }

  view(): TodoView {
    const { source, syncedAt, cards, notes, readTools, pickedList } = this.record;
    return {
      source: source ?? null,
      syncedAt: syncedAt ?? null,
      cards,
      notes,
      syncing: this.running !== null,
      longSync: this.running?.long ?? false,
      error: this.error,
      ask: this.ask,
      setUp: readTools !== undefined || pickedList !== undefined,
    };
  }

  /**
   * Reads the list with a background run. A call while one runs gets that run's outcome. Tools confirmed on another
   * agent are not this one's names, so the run finds the connector again.
   */
  sync(): Promise<SyncOutcome> {
    if (this.closed) return Promise.reject(new Error('The project is closing'));
    if (this.running) return this.running.outcome;
    if (this.newer) return Promise.reject(new Error(this.newer));
    const agent = this.deps.agent();
    const { readTools, pickedList } = this.record;
    const confirmed = readTools !== undefined && (readTools.agent ?? 'claude') === agent.adapter.name;
    const step: SyncStep = confirmed ? { kind: 'read', list: pickedList ?? null } : { kind: 'discover' };
    return agent.adapter.sync.models ? this.withModel(agent, step) : this.launch(agent, step);
  }

  /** Keeps the model the sync asked about as the one it runs on, in settings.json, then syncs. */
  async pickModel(id: string): Promise<SyncOutcome> {
    if (this.ask?.kind !== 'model' || !this.askedBy || !this.ask.models.some((m) => m.id === id)) throw new Error('No such model; sync again');
    this.deps.saveAgentSetting(this.askedBy, { syncModel: id });
    return this.sync();
  }

  /** Keeps the tools the sync asked about as the ones it may read with, then syncs. */
  async confirmTools(): Promise<SyncOutcome> {
    if (this.ask?.kind !== 'tools' || !this.askedBy) throw new Error('Nothing to allow; sync again');
    const { connector, tools } = this.ask;
    this.save({ ...this.record, readTools: { connector, tools, agent: this.askedBy } });
    return this.sync();
  }

  /** Keeps the list the sync asked about as the one to read, then syncs. */
  async pickList(index: number): Promise<SyncOutcome> {
    const list = this.ask?.kind === 'lists' ? this.ask.lists[index] : undefined;
    if (!list) throw new Error('No such list; sync again');
    this.save({ ...this.record, pickedList: list });
    return this.sync();
  }

  /** Forgets the confirmed tools and the picked list, so the next sync begins again. The cards and notes stay. */
  resetSource(): void {
    this.cancel();
    const { readTools, pickedList, ...kept } = this.record;
    this.save(kept);
    this.ask = this.error = null;
    this.changed();
  }

  saveNote(note: TodoNoteDraft): TodoNote {
    this.writable();
    const title = note.title.trim();
    if (!title) throw new Error('A todo needs a title');
    const saved = { id: note.id ?? this.newId(), title, text: note.text };
    const { notes } = this.record;
    if (note.id === undefined) {
      this.save({ ...this.record, notes: [...notes, saved] });
    } else {
      if (!notes.some((n) => n.id === note.id)) throw new Error(`No todo ${note.id}`);
      this.save({ ...this.record, notes: notes.map((n) => (n.id === note.id ? saved : n)) });
    }
    this.changed();
    return saved;
  }

  deleteNote(id: string): void {
    this.writable();
    if (!this.record.notes.some((n) => n.id === id)) return;
    this.save({ ...this.record, notes: this.record.notes.filter((n) => n.id !== id) });
    this.changed();
  }

  /**
   * Starts a task from a card or a note. A card is found by its id, or when none has that id, by its number as the
   * list shows it, with or without a leading #: a card whose id matches comes before one whose number does. A card
   * marked for the owner starts only with `ownersCard`, which only the ticket's Start anyway sets: the manager's tools
   * never do. A note leaves the list once its task has started.
   */
  async startItem(item: TodoItemRef, opts: { noQuestions: boolean; brief?: string; ownersCard?: boolean }): Promise<TaskView> {
    if (item.kind === 'card') {
      const { source, cards } = this.record;
      const bare = (s: string) => s.replace(/^#/, '');
      let position = cards.findIndex((c) => c.id === item.id);
      if (position < 0) position = cards.findIndex((c) => c.number !== null && bare(c.number) === bare(item.id));
      if (position < 0 || !source) throw new Error(`No card ${item.id} in the synced list; sync it again`);
      const card = cards[position];
      if (card.forOwner && !opts.ownersCard) {
        throw new Error(`${card.number ?? card.title} is marked as the owner's; the owner starts it from its ticket with Start anyway`);
      }
      return this.deps.startTask({
        title: card.title,
        description: opts.brief ?? '',
        noQuestions: opts.noQuestions,
        card: { sourceKind: source.kind, id: card.id, number: card.number, url: card.url, labels: card.labels, position, urgent: card.urgent },
      });
    }

    this.writable();
    const note = this.record.notes.find((n) => n.id === item.id);
    if (!note) throw new Error(`No todo ${item.id}`);
    const task = await this.deps.startTask({ title: note.title, description: note.text, noQuestions: opts.noQuestions });
    this.deleteNote(note.id);
    return task;
  }

  /** The owner chose to go on past the long-sync line: it stays hidden for the rest of this run. */
  keepSyncing(): void {
    if (!this.running?.long) return;
    this.running.long = false;
    this.changed();
  }

  /** Stops a running sync: its callers get the stopped outcome, the view shows no error, and nothing the run answers is kept. */
  cancel(): void {
    const running = this.running;
    if (!running) return;
    running.cancel();
    this.end(running, () => ({ error: SYNC_STOPPED }));
  }

  /** As the project's close or the app's quit begins: stops a running sync as `cancel` does, and refuses every later one. */
  close(): void {
    this.closed = true;
    this.cancel();
  }

  /**
   * Lists the agent's models before the run, and asks the owner for one when the saved model is not among them (none
   * saved yet, or its provider since removed). While it lists, the sync counts as running: a second Sync joins it and
   * Stop ends it.
   */
  private withModel(agent: AgentInUse, step: SyncStep): Promise<SyncOutcome> {
    const { adapter, bin, setting } = agent;
    let settle!: Running['settle'];
    const outcome = new Promise<SyncOutcome>((resolve) => (settle = resolve));
    const listing: Running = { outcome, settle, cancel: () => {}, long: false, stopTimer: () => {} };
    this.running = listing;
    this.ask = this.error = null;
    this.changed();

    adapter.sync.models!({ bin, dir: this.dir, env: this.deps.env }).then(
      (models) => {
        if (this.running !== listing) return;
        if (models.some((m) => m.id === setting.syncModel)) {
          this.running = null;
          void this.launch(agent, step).then(settle);
          return;
        }
        this.end(listing, () => {
          this.ask = { kind: 'model', models, suggested: cheapestKnown(models) };
          this.askedBy = adapter.name;
          return { ask: 'model' };
        });
      },
      (err: Error) => this.end(listing, () => this.refuse(err.message)),
    );
    return outcome;
  }

  private launch({ adapter, bin, setting }: AgentInUse, step: SyncStep): Promise<SyncOutcome> {
    const { nodeBin, projectDir, env } = this.deps;
    const tools = step.kind === 'read' ? (this.record.readTools?.tools ?? []) : [];
    let spec: SyncRunSpec;
    try {
      spec = adapter.sync.prepare({ bin, nodeBin, dir: this.dir, projectDir, env, step, tools, setting });
    } catch (err) {
      // Said in the view, as a run that fails is: Sync is pressed from the panel, which only logs a call main refuses.
      this.ask = null;
      const refused = this.refuse((err as Error).message);
      this.changed();
      return Promise.resolve(refused);
    }
    const { done, cancel } = (this.deps.run ?? runSync)({ ...spec, input: adapter.sync.prompt(step), timeoutMs: SYNC_TIMEOUT_MS });

    let settle!: Running['settle'];
    const outcome = new Promise<SyncOutcome>((resolve) => (settle = resolve));
    const setTimer = this.deps.setTimer ?? ((fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    });
    const running: Running = {
      outcome,
      settle,
      cancel,
      long: false,
      stopTimer: setTimer(() => {
        if (this.running !== running) return;
        running.long = true;
        this.changed();
      }, LONG_SYNC_MS),
    };
    this.running = running;
    this.ask = this.error = null;
    this.changed();

    done.then(
      (stdout) => {
        adapter.sync.afterRun({ bin, dir: this.dir, env, stdout });
        this.end(running, () => this.apply(adapter, step, adapter.sync.readAnswer(stdout, tools)));
      },
      (err: Error) => this.end(running, () => this.refuse(err.message)),
    );
    return outcome;
  }

  /** Ends `running` with what `compute` makes of its answer, unless it was stopped or replaced meanwhile. */
  private end(running: Running, compute: () => SyncOutcome): void {
    if (this.running !== running) return;
    running.stopTimer();
    this.running = null;
    let outcome: SyncOutcome;
    try {
      outcome = compute();
    } catch (err) {
      outcome = this.refuse((err as Error).message);
    }
    this.changed();
    running.settle(outcome);
  }

  /** What the answer of `adapter`'s run for `step` changes: the cards, an ask for the owner, or an error. */
  private apply(adapter: AgentAdapter, step: SyncStep, answer: SyncAnswer): SyncOutcome {
    if (answer.kind === 'none') {
      const message = answer.message ?? 'The sync run found nothing to read, and did not say why';
      const { noConnector } = adapter.sync.words;
      return this.refuse(step.kind === 'discover' && noConnector !== '' ? `${message} ${noConnector}` : message);
    }

    if (step.kind === 'discover') {
      const { connector, readTools } = answer;
      if (answer.kind !== 'tools' || !connector || !readTools?.length) return this.refuse(UNASKED);
      const notTools = readTools.filter((name) => !adapter.sync.isToolName(name));
      if (notTools.length > 0) return this.refuse(`The sync named tools that aren't a connector's: ${notTools.join(', ')}`);
      this.ask = { kind: 'tools', connector, tools: readTools };
      this.askedBy = adapter.name;
      return { ask: 'tools' };
    }

    if (answer.kind === 'lists' && answer.lists?.length) {
      this.ask = { kind: 'lists', lists: answer.lists };
      return { ask: 'lists' };
    }
    const { source, cards } = answer;
    if (answer.kind !== 'cards' || !source || !cards) return this.refuse(UNASKED);
    // The panel keys a row by its card's id, and a task's card guard matches by it.
    if (cards.some((c) => c.id.trim() === '')) return this.refuse('The sync gave a card no id; sync again');
    const seen = new Set<string>();
    for (const { id } of cards) {
      if (seen.has(id)) return this.refuse(`The sync gave two cards the id ${id}; sync again`);
      seen.add(id);
    }
    this.save({ ...this.record, source, cards, syncedAt: this.now() });
    return { cards: cards.length };
  }

  private refuse(error: string): { error: string } {
    this.error = error;
    return { error };
  }

  private writable(): void {
    if (this.newer) throw new Error(this.newer);
  }

  /** Writes the file first, so that what the service holds is never ahead of it. */
  private save(next: TodoRecord): void {
    this.writable();
    saveTodo(this.file, next);
    this.record = next;
  }

  private changed(): void {
    this.deps.onChange(this.view());
  }
}

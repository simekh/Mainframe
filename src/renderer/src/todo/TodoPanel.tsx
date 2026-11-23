import { createEffect, createMemo, createSignal, createUniqueId, For, Match, onCleanup, Show, Switch, untrack } from 'solid-js';
import { httpUrl } from '../../../shared/httpUrl';
import type { StartCheck, SyncModel } from '../../../shared/types';
import { now } from '../board/ageClock';
import { aheadOf } from '../board/StartCheckWarning';
import { errorMessage } from '../bridgeError';
import { openLinkLogged } from '../openLink';
import { stripShows, type PanelState } from '../panel/panelPrefs';
import PanelStrip, { createFoldHandOff, FoldButton } from '../panel/PanelStrip';
import PinIcon from '../panel/PinIcon';
import ResizeEdge from '../panel/ResizeEdge';
import { useProject } from '../projects/projectContext';
import { connectTrello, trelloConnection, trelloSignedIn } from '../settings/trelloStore';
import { reopenTask, startTask, startTodoItem, tasksOf } from '../tasksStore';
import { plainText } from './markdown';
import FinishedList from './FinishedList';
import TicketPanel from './TicketPanel';
import {
  finishedTasks, reopenTaskId, sourcePlace, startsFromTicket, syncedLine, todoItems, visibleItems, type StartOptions, type TodoItem,
} from './todoItems';
import { loadHideMine, loadTodoTab, saveHideMine, saveTodoTab, TODO_WIDTH, type TodoTab } from './todoPrefs';
import {
  cancelTodoSync, confirmTodoTools, keepNoteDraft, keepTodoSync, pickTodoList, pickTodoModel, pollTodo, resetTodoSource, syncTodo, todoOf,
  useTrello,
} from './todoStore';
import { startPolling } from './poller';
import TrelloSetup, { SourceChoice } from './TrelloSetup';

// Its buttons don't take the focus on click: typing stays where it was. Most of them go, or wait, once pressed.
const keepFocus = (e: MouseEvent) => e.preventDefault();

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const priceLine = (price: SyncModel['price']) => (price ? `${usd(price.input)} / ${usd(price.output)}` : 'price unknown');

/** The models the sync can run on, cheapest first: the suggested one starts picked, and nothing runs until the button. */
function ModelAsk(props: { dir: string; models: SyncModel[]; suggested: string | null }) {
  const [picked, setPicked] = createSignal<string | null>(null);
  // A later ask may not hold the earlier pick: it then starts from its own suggestion.
  const chosen = () => {
    const id = picked();
    return id !== null && props.models.some((m) => m.id === id) ? id : props.suggested;
  };
  return (
    <div class="todo-ask todo-model-ask">
      <p>Pick the model the sync runs on. Cheapest first, with the price per million tokens in and out.</p>
      <div class="todo-models" role="radiogroup" aria-label="Sync model">
        <For each={props.models}>
          {(model) => (
            <button
              class="todo-pick todo-model"
              data-testid="todo-model"
              role="radio"
              aria-checked={chosen() === model.id ? 'true' : 'false'}
              onMouseDown={keepFocus}
              onClick={() => setPicked(model.id)}
            >
              <span class="todo-model-dot" aria-hidden="true" />
              {/* Two providers can offer one model by one name: the id tells them apart. */}
              <span class="todo-model-name">
                <span class="todo-model-title">{model.name}</span>
                <span class="todo-model-id">{model.id}</span>
              </span>
              <span class="todo-model-price" classList={{ unknown: !model.price }}>
                {priceLine(model.price)}
              </span>
            </button>
          )}
        </For>
      </div>
      <button
        class="btn primary"
        data-testid="todo-pick-model"
        disabled={chosen() === null}
        onMouseDown={keepFocus}
        onClick={() => {
          const id = chosen();
          if (id !== null) pickTodoModel(props.dir, id);
        }}
      >
        Use this and sync
      </button>
    </div>
  );
}

function SyncIcon() {
  return (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M11.5 7A4.5 4.5 0 0 1 3.6 9.9M2.5 7a4.5 4.5 0 0 1 7.9-2.9" />
      <path d="M10.6 1.6v2.6H8M3.4 12.4V9.8H6" />
    </svg>
  );
}

/** New task's plus sign: all Quick Add shows of itself where the header is narrow. */
function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}

/**
 * The project's to-do list, at its pane's far left: the synced cards and the owner's notes, with Sync and what it
 * asks of the owner, and the ticket of the item open. Pinned and open, it takes the pane's left edge and the manager
 * sits right of it; unpinned, it floats over the manager right of the strips, as that floats over the board, and under
 * it while the manager is the one used last. Folded, pinned or not, it slides away and leaves its strip at the pane's
 * edge.
 */
export default function TodoPanel(props: {
  /** The width it shows; the edge reports where a drag or a key takes it. */
  width: number;
  /** The widest it can be in the room the pane gives it, which the edge announces. */
  maxWidth: number;
  onDrag(w: number): void;
  onDone(w: number): void;
  pinned: boolean;
  onPinnedChange(pinned: boolean): void;
  /** Folded, its strip is all that shows; off, nothing does. */
  state: PanelState;
  onOpenChange(open: boolean): void;
  /** Open under the manager: its strip brings it up rather than folding it. */
  behind: boolean;
  /** How far from the pane's left edge it floats: right of its strip, and of the manager's while that shows. */
  floatLeft: number;
  /** The open ticket: an item's key, or `'new-note'`. The pane closes it too. */
  ticket: string | null;
  onTicketChange(ticket: string | null): void;
}) {
  const project = useProject();
  const view = () => todoOf(project.dir);
  // Whether the list leaves out the cards for the owner: the project's own choice, kept for the next start.
  const [hideMine, setHideMine] = createSignal(loadHideMine(localStorage, project.dir));
  const toggleHideMine = () => {
    setHideMine(!hideMine());
    saveHideMine(localStorage, project.dir, hideMine());
  };
  // The tab on show: the project's own choice, kept for the next start. The Finished tab has no ticket.
  const [tab, setTab] = createSignal<TodoTab>(loadTodoTab(localStorage, project.dir));
  const showTab = (next: TodoTab) => {
    if (next === 'finished') props.onTicketChange(null);
    setTab(next);
    saveTodoTab(localStorage, project.dir, next);
  };
  const finished = createMemo(() => finishedTasks(tasksOf(project.dir).tasks, ''));
  // Each pane's own, as several projects' panels show at once.
  const ids = createUniqueId();
  const tabId = (t: TodoTab) => `todo-tab-${t}-${ids}`;
  const panelId = (t: TodoTab) => `todo-tabpanel-${t}-${ids}`;
  const allItems = createMemo(() => {
    const v = view();
    return v ? todoItems(v, tasksOf(project.dir).tasks) : [];
  });
  const shownItems = createMemo(() => visibleItems(allItems(), hideMine()));
  const hiddenCount = () => allItems().length - shownItems().length;
  // The rows go by key, as todoItems builds new objects each time: a sync, or a task that opens or closes, updates a
  // row in place, so a button in it keeps the focus. A card the switch hides is off the list, so its ticket closes.
  const itemByKey = createMemo(() => new Map(shownItems().map((item) => [item.key, item])));
  // None while its item is off the list.
  const ticketItem = (): TodoItem | 'new-note' | undefined =>
    props.ticket === 'new-note' ? 'new-note' : props.ticket ? itemByKey().get(props.ticket) : undefined;
  // A ticket whose item left the list another way (a sync dropped the card, the manager started it) closes, rather
  // than come back unasked with the item.
  createEffect(() => {
    if (props.ticket && ticketItem() === undefined) props.onTicketChange(null);
  });

  // What the open ticket's footer shows: they are set each time a ticket opens.
  const [warning, setWarning] = createSignal<StartCheck | null>(null);
  const [startError, setStartError] = createSignal<string | null>(null);
  // Its start check is under way: its Start waits, so it never starts without the warning.
  const [checking, setChecking] = createSignal(false);
  // One start at a time, as in New task.
  const [starting, setStarting] = createSignal(false);
  // Each ticket that opens numbers its start check, so one that comes back late never speaks for the ticket that has
  // opened since, even the same item's.
  let latestCheck = 0;
  // What a Start from the list found may open that item's ticket only where it takes nothing from the owner: when no
  // ticket is open, or the item's own is. Another item's ticket may hold what is being typed in it.
  const ticketFreeFor = (key: string) => props.ticket === null || props.ticket === key;

  // What the start check warns of. One that fails warns of nothing, from the list as from the ticket: it is logged, and
  // the start goes ahead.
  const checkStart = () =>
    window.mainframe.startCheck(project.dir).then(aheadOf, (err: unknown) => {
      console.error(`[todo] start check failed for ${project.dir}: ${errorMessage(err)}`);
      return null;
    });

  /**
   * Opens a ticket in place of the one open. One a Start opens says what that Start found; any other with a Start runs
   * the start check, so its Start warns as New task's does.
   */
  function openTicket(key: string, found?: { warning: StartCheck | null; error: string | null }) {
    // A ticket is To do's: a Start that failed after the owner turned to Finished brings To do back with it.
    if (tab() !== 'todo') showTab('todo');
    const opening = ++latestCheck;
    setWarning(found?.warning ?? null);
    setStartError(found?.error ?? null);
    const target = itemByKey().get(key);
    const check = !found && (key === 'new-note' || (target !== undefined && startsFromTicket(target)));
    setChecking(check);
    props.onTicketChange(key);
    if (!check) return;
    void checkStart().then((warns) => {
      if (props.ticket !== key || opening !== latestCheck) return;
      setWarning(warns);
      setChecking(false);
    });
  }

  /**
   * Starts the item, or the new note as New task would, and closes its ticket; a failure shows in the item's ticket.
   * From the list it runs the start check first, and a warning opens the ticket instead, whose Start goes ahead.
   */
  async function start(
    item: TodoItem | 'new-note',
    o: StartOptions,
    check = false,
  ): Promise<void> {
    if (starting()) return;
    setStarting(true);
    const key = item === 'new-note' ? item : item.key;
    try {
      if (check) {
        const warns = await checkStart();
        if (warns) {
          if (ticketFreeFor(key)) return openTicket(key, { warning: warns, error: null });
          // Not started, and still on the list with its Start: the ticket open meanwhile stays.
          console.warn(`[todo] ${key} was not started for ${project.dir}: its start check warned (${warns.branch} is ahead of ${warns.base})`);
          return;
        }
      }
      if (item === 'new-note') {
        await startTask(project.dir, { title: o.note!.title, description: o.note!.text, noQuestions: o.noQuestions });
      } else {
        // A note's edits are saved first, so its task starts from them.
        if (o.note && item.note) await window.mainframe.saveTodoNote(project.dir, { id: item.note.id, ...o.note });
        await startTodoItem(project.dir, { item: { kind: item.kind, id: item.id }, noQuestions: o.noQuestions, ownersCard: o.ownersCard });
      }
      // Started, a note's typing is its task's brief, so no draft is kept.
      keepNoteDraft(project.dir, key, null);
      // Another item's ticket stays, with what is typed in it.
      if (props.ticket === key) props.onTicketChange(null);
    } catch (err) {
      // Its item may have left the list, so there is no ticket to show the error in: a reopened one would close at once.
      // Another item's ticket, open meanwhile, stays as it is.
      const gone = item !== 'new-note' && !itemByKey().has(key);
      if (gone || !ticketFreeFor(key)) {
        console.error(`[todo] could not start ${key} for ${project.dir}: ${errorMessage(err)}`);
      } else {
        openTicket(key, { warning: props.ticket === key ? warning() : null, error: errorMessage(err) });
      }
    } finally {
      setStarting(false);
    }
  }

  // A put-back or finished task's item continues it, through the item as Start goes, so main takes a note off the list
  // once its task runs. No start check: the task goes on from its own branch. A card for the owner is the owner's
  // own choice here, as Start anyway is.
  const continueItem = (item: TodoItem) => void start(item, { noQuestions: false, ownersCard: item.forOwner });

  // As the board's Reopen; the card leaves the list, so its ticket goes.
  const reopen = (taskId: string) => {
    props.onTicketChange(null);
    reopenTask(project.dir, taskId).catch((err: unknown) =>
      console.error(`[tasks] could not reopen task ${taskId}: ${errorMessage(err)}`),
    );
  };

  let aside!: HTMLElement;
  let addNote!: HTMLButtonElement;
  // A ticket that goes with the focus in it hands it to what opened it, while that is there: the keyboard never ends
  // up nowhere.
  const handBackFocus = (key: string) => {
    if (!aside.querySelector('.ticket-panel')?.contains(document.activeElement)) return;
    const opener =
      key === 'new-note' ? addNote : aside.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"] .todo-open`);
    opener?.focus();
  };
  const toolsAsk = () => {
    const ask = view()?.ask;
    return ask?.kind === 'tools' ? ask : undefined;
  };
  const listsAsk = () => {
    const ask = view()?.ask;
    return ask?.kind === 'lists' ? ask : undefined;
  };
  const modelAsk = () => {
    const ask = view()?.ask;
    return ask?.kind === 'model' ? ask : undefined;
  };
  // Choosing where the list lives is the panel's own: 'auto' asks only while the project has no source and nothing set
  // up, and no sync is under way or asking; Set up again asks in any case; 'agent' is the owner's answer for today's
  // sync, which then shows as it always has.
  const [setup, setSetup] = createSignal<'auto' | 'choice' | 'trello' | 'agent'>('auto');
  const choosing = () => {
    const v = view();
    if (setup() === 'choice') return true;
    return setup() === 'auto' && v !== undefined && !v.setUp && !v.source && !v.syncing && !v.ask;
  };
  const chooseAgent = () => {
    resetTodoSource(project.dir);
    setSetup('agent');
  };
  const trello = () => view()?.sourceKind === 'trello';
  // A Trello list stays fresh while it shows, its project on screen: at once, then on its interval and at each return
  // to the window. A memo, so a change elsewhere in the sign-in (its name coming in) doesn't start it again; a
  // reconnect, or the project showing again, does, and so reads. Only that drives it: started untracked, so a new
  // interval (main backing off) is read at the next wait rather than restarting it with a poll.
  const polls = createMemo(() => props.state === 'open' && project.shown() && trello() && trelloSignedIn());
  createEffect(() => {
    if (!polls()) return;
    const dir = project.dir;
    const onFocus = () => pollTodo(dir);
    const stop = untrack(() =>
      startPolling({
        every: () => view()?.pollMs ?? 60_000,
        active: () => document.visibilityState === 'visible' && document.hasFocus(),
        poll: () => pollTodo(dir),
      }),
    );
    window.addEventListener('focus', onFocus);
    onCleanup(() => {
      stop();
      window.removeEventListener('focus', onFocus);
    });
  });

  const handOff = createFoldHandOff('Fold the Todo panel', () => props.state === 'open' && !props.behind, (open) =>
    props.onOpenChange(open),
  );

  return (
    <>
      {/* Before the panel: laid out at the pane's left edge. */}
      <Show when={stripShows(props.state, props.pinned)}>
        <PanelStrip
          class="todo-strip"
          name="Todo"
          label="Show Todo"
          side="left"
          testId="todo-strip"
          handOff={handOff}
        />
      </Show>

      <aside
        ref={aside}
        class="todo-panel"
        data-testid="todo-panel"
        aria-label="Todo"
        data-pinned={String(props.pinned)}
        data-open={String(props.state === 'open')}
        data-state={props.state}
        // What the pane leaves right of the panel, its margin kept: the ticket is no wider. Floating, the panel sits
        // beside the strips.
        style={{
          width: `${props.width}px`,
          '--float-left': `${props.floatLeft}px`,
          '--ticket-room': `${project.width() - props.width - 8 - (props.pinned ? 8 : props.floatLeft)}px`,
        }}
      >
        <FoldButton points="left" testId="todo-fold" handOff={handOff} />
        <button
          class="panel-pin"
          data-testid="todo-pin"
          aria-pressed={props.pinned ? 'true' : 'false'}
          aria-label="Pin Todo panel"
          title={props.pinned ? 'Unpin Todo panel' : 'Pin Todo panel'}
          onMouseDown={keepFocus}
          onClick={() => props.onPinnedChange(!props.pinned)}
        >
          <PinIcon />
        </button>
        {/* The two tabs, and To do's Quick Add and Sync beside the fold button, as the session panel's title bar holds
            its buttons: the row under it keeps its width for the source's name. While a sync runs, the same button, kept
            so that it keeps the focus, is its Stop, and the row under it says Syncing…. */}
        <div class="todo-tabs">
          <div class="todo-tablist" role="tablist" aria-label="Todo">
            <button
              class="todo-tab"
              role="tab"
              data-testid="todo-tab-todo"
              id={tabId('todo')}
              aria-controls={panelId('todo')}
              aria-selected={tab() === 'todo' ? 'true' : 'false'}
              onMouseDown={keepFocus}
              onClick={() => showTab('todo')}
            >
              To do
            </button>
            <button
              class="todo-tab"
              role="tab"
              data-testid="todo-tab-finished"
              id={tabId('finished')}
              aria-controls={panelId('finished')}
              aria-selected={tab() === 'finished' ? 'true' : 'false'}
              onMouseDown={keepFocus}
              onClick={() => showTab('finished')}
            >
              Finished <span class="todo-tab-count">{finished().length}</span>
            </button>
          </div>
          <Show when={tab() === 'todo' && view()}>
            {(v) => (
              <>
                <button
                  class="btn todo-add"
                  data-testid="todo-add-note"
                  aria-label="Quick Add"
                  title="Add a todo that stays in Mainframe. It isn't added to your tracker: Sync only reads from it."
                  ref={addNote}
                  onMouseDown={keepFocus}
                  onClick={() => openTicket('new-note')}
                >
                  <PlusIcon />
                  <span>Quick Add</span>
                </button>
                {/* Its word goes where the header is narrow, as Quick Add's does; its name stays. A Trello list reads
                    in a moment, so it is a Refresh with nothing to stop. */}
                <Show
                  when={!trello()}
                  fallback={
                    <button
                      class="btn todo-sync"
                      data-testid="todo-refresh"
                      aria-label="Refresh"
                      title="Refresh"
                      onMouseDown={keepFocus}
                      onClick={() => syncTodo(project.dir)}
                    >
                      <SyncIcon />
                      <span>Refresh</span>
                    </button>
                  }
                >
                  <button
                    class="btn todo-sync"
                    data-testid={v().syncing ? 'todo-stop-sync' : 'todo-sync'}
                    aria-label={v().syncing ? 'Stop the sync' : 'Sync'}
                    title={v().syncing ? 'Stop the sync' : 'Sync'}
                    onMouseDown={keepFocus}
                    onClick={() => (v().syncing ? cancelTodoSync(project.dir) : syncTodo(project.dir))}
                  >
                    {v().syncing ? <StopIcon /> : <SyncIcon />}
                    <span>{v().syncing ? 'Stop' : 'Sync'}</span>
                  </button>
                </Show>
              </>
            )}
          </Show>
        </div>

        <Show when={tab() === 'finished'}>
          <div class="todo-tabpanel" role="tabpanel" id={panelId('finished')} aria-labelledby={tabId('finished')}>
            <FinishedList tasks={finished()} />
          </div>
        </Show>

        <Show when={tab() === 'todo' && view()}>
          {(v) => (
            <div class="todo-tabpanel" role="tabpanel" id={panelId('todo')} aria-labelledby={tabId('todo')}>
              {/* Laid out as the manager's row under its title, so the two headers' dividers line up. */}
              <div class="p-branch-bar">
                {/* The service's name opens the list where it lives, as the ticket's Open in does for a card. */}
                <Show when={v().source}>
                  {(source) => (
                    <span class="todo-source-name" data-testid="todo-source" title={`${source().kind} · ${sourcePlace(source())}`}>
                      <Show when={httpUrl(source().url)} fallback={source().kind}>
                        {(url) => (
                          <button
                            class="todo-source-link"
                            data-testid="todo-source-link"
                            title={`Open in ${source().kind}`}
                            onMouseDown={keepFocus}
                            onClick={() => openLinkLogged(url(), 'todo')}
                          >
                            {source().kind} ↗
                          </button>
                        )}
                      </Show>
                      {` · ${sourcePlace(source())}`}
                    </span>
                  )}
                </Show>
                <span class="todo-synced">
                  <Show when={v().syncing} fallback={syncedLine(v(), now())}>
                    <SyncIcon />
                    {trello() ? 'Refreshing…' : 'Syncing…'}
                  </Show>
                </span>
                {/* Quiet, beside when it was read: the list under it is the last copy. */}
                <Show when={v().notice}>
                  {(notice) => (
                    <span class="todo-notice" data-testid="todo-notice" role="status" title={notice()}>
                      {notice()}
                    </span>
                  )}
                </Show>
              </div>

              <Show when={trello() && trelloConnection()?.needsReconnect}>
                <div class="todo-reconnect-row">
                  <p>Trello asked to sign in again. The list shows the last copy.</p>
                  <button
                    class="btn"
                    data-testid="todo-reconnect"
                    disabled={trelloConnection()?.connecting}
                    onMouseDown={keepFocus}
                    onClick={connectTrello}
                  >
                    {trelloConnection()?.connecting ? 'Waiting for your browser…' : 'Reconnect Trello'}
                  </button>
                </div>
              </Show>

              <Show when={!trello() && !choosing() && setup() !== 'trello' && v().source?.kind.toLowerCase() === 'trello'}>
                <button class="todo-reset todo-trello-hint" data-testid="todo-trello-hint" onMouseDown={keepFocus} onClick={() => setSetup('trello')}>
                  Connect Trello for instant sync
                </button>
              </Show>

              <Switch>
                <Match when={setup() === 'trello'}>
                  <TrelloSetup
                    onUse={(pick) => {
                      useTrello(project.dir, pick);
                      setSetup('auto');
                    }}
                    onCancel={() => setSetup('auto')}
                  />
                </Match>
                <Match when={choosing()}>
                  <SourceChoice
                    onTrello={() => setSetup('trello')}
                    onAgent={chooseAgent}
                    onCancel={setup() === 'choice' ? () => setSetup('auto') : undefined}
                  />
                </Match>
              </Switch>

              {/* A run past two minutes: said in words, with the choice, as a sync that may cost the owner real money. */}
              <Show when={v().longSync}>
                <div class="todo-long-sync" data-testid="todo-long-sync" role="status">
                  <p>Still syncing (2 min). Large syncs can use a lot of tokens.</p>
                  <div class="todo-long-actions">
                    <button
                      class="btn"
                      data-testid="todo-long-stop"
                      onMouseDown={keepFocus}
                      onClick={() => cancelTodoSync(project.dir)}
                    >
                      Stop
                    </button>
                    <button
                      class="btn"
                      data-testid="todo-keep-going"
                      onMouseDown={keepFocus}
                      onClick={() => keepTodoSync(project.dir)}
                    >
                      Keep going
                    </button>
                  </div>
                </div>
              </Show>

              <Switch>
                <Match when={toolsAsk()}>
                  {(ask) => (
                    <div class="todo-ask">
                      <p>
                        Sync wants to read your to-do list in <strong>{ask().connector}</strong> with these tools. Allow them only if none of
                        them can change it:
                      </p>
                      <ul class="todo-tools">
                        <For each={ask().tools}>
                          {(tool) => (
                            <li>
                              <code>{tool}</code>
                            </li>
                          )}
                        </For>
                      </ul>
                      <button
                        class="btn primary"
                        data-testid="todo-confirm-tools"
                        onMouseDown={keepFocus}
                        onClick={() => confirmTodoTools(project.dir)}
                      >
                        Allow and sync
                      </button>
                    </div>
                  )}
                </Match>
                <Match when={listsAsk()}>
                  {(ask) => (
                    <div class="todo-ask">
                      <p>Which list is your to-do list?</p>
                      <For each={ask().lists}>
                        {(list, i) => (
                          <button
                            class="todo-pick"
                            data-testid="todo-pick-list"
                            onMouseDown={keepFocus}
                            onClick={() => pickTodoList(project.dir, i())}
                          >
                            <span>{list.name}</span>
                            <Show when={list.board}>{(board) => <span class="todo-pick-board">{board()}</span>}</Show>
                          </button>
                        )}
                      </For>
                    </div>
                  )}
                </Match>
                <Match when={modelAsk()}>
                  {(ask) => <ModelAsk dir={project.dir} models={ask().models} suggested={ask().suggested} />}
                </Match>
              </Switch>

              <Show when={v().error}>
                {(message) => (
                  <p class="todo-error" data-testid="todo-error" role="alert">
                    {message()}
                  </p>
                )}
              </Show>

              {/* Until there is a list or a note; an ask, or the choice of where the list lives, says more. */}
              <Show when={!v().source && v().notes.length === 0 && !v().ask && !choosing() && setup() !== 'trello'}>
                <p class="todo-empty">
                  Sync reads your to-do list through the connector you use for it. Todos you add stay in Mainframe.
                </p>
              </Show>
              <div class="todo-scroll">
                {/* While the list has a card for the owner, and while it is pressed, so it can always be turned off. */}
                <Show when={hideMine() || v().cards.some((card) => card.forOwner)}>
                  <button
                    class="todo-hide-mine"
                    data-testid="todo-hide-mine"
                    aria-pressed={hideMine() ? 'true' : 'false'}
                    onMouseDown={keepFocus}
                    onClick={toggleHideMine}
                  >
                    Hide my tasks
                    <Show when={hiddenCount() > 0}>
                      <span class="todo-hide-count">{hiddenCount()} hidden</span>
                    </Show>
                  </button>
                </Show>
                <ul class="todo-list" aria-label="To do">
                  <For each={[...itemByKey().keys()]}>
                    {(key) => {
                      // A row whose key leaves the list goes before this reads it again.
                      const item = () => itemByKey().get(key)!;
                      const reopenId = () => reopenTaskId(item().action);
                      // What the row shows of its text: a card's as a reader sees it, a note's as typed. Memos by value, so a
                      // sync that leaves the text as it was doesn't read it again.
                      const body = createMemo(() => item().body);
                      const isCard = createMemo(() => item().kind === 'card');
                      const preview = createMemo(() => (isCard() ? plainText(body()) : body()));
                      return (
                        <li
                          class="todo-item"
                          data-testid="todo-item"
                          data-key={key}
                          data-for-owner={String(item().forOwner)}
                          data-open={String(props.ticket === key)}
                        >
                          {/* Stretched over the row, so a click anywhere opens its ticket, and a second one closes it. */}
                          <button
                            class="todo-open"
                            aria-expanded={props.ticket === key}
                            onMouseDown={keepFocus}
                            onClick={() => (props.ticket === key ? props.onTicketChange(null) : openTicket(key))}
                          >
                            <Show when={item().number}>{(number) => <span class="card-number">{number()} </span>}</Show>
                            {item().title}
                          </button>
                          <Show when={preview()}>
                            <p class="todo-body">{preview()}</p>
                          </Show>
                          {/* A note always has its Start, or its Continue. */}
                          <Show when={item().action || item().labels.length > 0}>
                            <div class="todo-row">
                              <Show when={item().kind === 'note'}>
                                <span class="todo-label note">Todo</span>
                              </Show>
                              <For each={item().labels}>{(label) => <span class="todo-label">{label}</span>}</For>
                              <Switch>
                                <Match when={reopenId()}>
                                  {(taskId) => (
                                    <button
                                      class="card-act"
                                      data-testid="todo-reopen"
                                      aria-label={`Reopen ${item().title}`}
                                      onMouseDown={keepFocus}
                                      onClick={() => reopen(taskId())}
                                    >
                                      Reopen
                                    </button>
                                  )}
                                </Match>
                                <Match when={item().action?.kind === 'continue'}>
                                  <button
                                    class="card-act"
                                    data-testid="todo-continue"
                                    aria-label={`Continue ${item().title}`}
                                    onMouseDown={keepFocus}
                                    onClick={() => continueItem(item())}
                                  >
                                    Continue
                                  </button>
                                </Match>
                                <Match when={item().action?.kind === 'start'}>
                                  <button
                                    class="card-act"
                                    data-testid="todo-start"
                                    aria-label={`Start ${item().title}`}
                                    onMouseDown={keepFocus}
                                    onClick={() => void start(item(), { noQuestions: false }, true)}
                                  >
                                    Start
                                  </button>
                                </Match>
                              </Switch>
                            </div>
                          </Show>
                        </li>
                      );
                    }}
                  </For>
                </ul>
                {/* Hiding left no row, not even a note. */}
                <Show when={shownItems().length === 0 && allItems().length > 0}>
                  <p class="todo-all-mine">Every card on the list is one of yours.</p>
                </Show>
              </div>

              <Show when={v().setUp}>
                <div class="todo-foot">
                  <button
                    class="todo-reset"
                    data-testid="todo-reset"
                    onMouseDown={keepFocus}
                    onClick={() => setSetup('choice')}
                  >
                    Set up again
                  </button>
                </div>
              </Show>
            </div>
          )}
        </Show>

        {/* Keyed, so another item mounts a ticket of its own. */}
        <Show when={props.ticket} keyed>
          {(key) => (
            <Show when={ticketItem()}>
              {(item) => {
                onCleanup(() => handBackFocus(key));
                return (
                  <TicketPanel
                    item={item()}
                    warning={warning()}
                    error={startError()}
                    starting={starting() || checking()}
                    onClose={() => props.onTicketChange(null)}
                    onStart={(o) => void start(item(), o)}
                    onReopen={reopen}
                  />
                );
              }}
            </Show>
          )}
        </Show>

        <ResizeEdge
          width={props.width}
          onDrag={props.onDrag}
          onDone={props.onDone}
          grows="right"
          label="Todo width"
          testId="todo-resize"
          min={TODO_WIDTH.min}
          max={props.maxWidth}
        />
      </aside>
    </>
  );
}

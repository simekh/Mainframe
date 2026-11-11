import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from 'solid-js';
import { httpUrl } from '../../../shared/httpUrl';
import type { StartCheck } from '../../../shared/types';
import { now } from '../board/ageClock';
import { aheadOf } from '../board/StartCheckWarning';
import { errorMessage } from '../bridgeError';
import { openLinkLogged } from '../openLink';
import { stripShows, STRIP_WIDTH, type PanelState } from '../panel/panelPrefs';
import PanelStrip, { createFoldHandOff, FoldButton } from '../panel/PanelStrip';
import PinIcon from '../panel/PinIcon';
import ResizeEdge from '../panel/ResizeEdge';
import { useProject } from '../projects/projectContext';
import { reopenTask, startTask, startTodoItem, tasksOf } from '../tasksStore';
import { plainText } from './markdown';
import TicketPanel from './TicketPanel';
import {
  reopenTaskId, sourcePlace, startsFromTicket, syncedLine, todoItems, visibleItems, type StartOptions, type TodoItem,
} from './todoItems';
import { loadHideMine, saveHideMine, TODO_WIDTH } from './todoPrefs';
import { cancelTodoSync, confirmTodoTools, keepNoteDraft, pickTodoList, resetTodoSource, syncTodo, todoOf } from './todoStore';

// Its buttons don't take the focus on click: typing stays where it was. Most of them go, or wait, once pressed.
const keepFocus = (e: MouseEvent) => e.preventDefault();

function SyncIcon() {
  return (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M11.5 7A4.5 4.5 0 0 1 3.6 9.9M2.5 7a4.5 4.5 0 0 1 7.9-2.9" />
      <path d="M10.6 1.6v2.6H8M3.4 12.4V9.8H6" />
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
 * sits right of it; unpinned, it floats over the manager beside its strip, as that floats over the board. Folded,
 * pinned or not, it slides away and leaves its strip at the pane's edge.
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
  const handOff = createFoldHandOff((open) => props.onOpenChange(open));

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
        // beside its strip.
        style={{
          width: `${props.width}px`,
          '--ticket-room': `${project.width() - props.width - 16 - (props.pinned ? 0 : STRIP_WIDTH + 8)}px`,
        }}
      >
        <FoldButton label="Fold the Todo panel" points="left" testId="todo-fold" handOff={handOff} />
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
        {/* One tab for now, and Quick Add and Sync beside the fold button, as the session panel's title bar holds its
            buttons: the row under it keeps its width for the source's name. While a sync runs, the same button, kept so
            that it keeps the focus, is its Stop, and the row under it says Syncing…. */}
        <div class="todo-tabs">
          <h2 class="todo-tab">Todo</h2>
          <Show when={view()}>
            {(v) => (
              <>
                <button
                  class="btn todo-add"
                  data-testid="todo-add-note"
                  title="Add a todo that stays in Mainframe. It isn't added to your tracker: Sync only reads from it."
                  ref={addNote}
                  onMouseDown={keepFocus}
                  onClick={() => openTicket('new-note')}
                >
                  Quick Add
                </button>
                {/* Its word goes where the header is narrow; its name stays. */}
                <button
                  class="btn todo-sync"
                  data-testid={v().syncing ? 'todo-stop-sync' : 'todo-sync'}
                  aria-label={v().syncing ? 'Stop the sync' : 'Sync'}
                  onMouseDown={keepFocus}
                  onClick={() => (v().syncing ? cancelTodoSync(project.dir) : syncTodo(project.dir))}
                >
                  {v().syncing ? <StopIcon /> : <SyncIcon />}
                  <span>{v().syncing ? 'Stop' : 'Sync'}</span>
                </button>
              </>
            )}
          </Show>
        </div>

        <Show when={view()}>
          {(v) => (
            <>
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
                    Syncing…
                  </Show>
                </span>
              </div>

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
              </Switch>

              <Show when={v().error}>
                {(message) => (
                  <p class="todo-error" data-testid="todo-error" role="alert">
                    {message()}
                  </p>
                )}
              </Show>

              {/* Until there is a list or a note; an ask says the same more precisely. */}
              <Show when={!v().source && v().notes.length === 0 && !v().ask}>
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
                          {/* A note always has its Start. */}
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
                    onClick={() => resetTodoSource(project.dir)}
                  >
                    Set up again
                  </button>
                </div>
              </Show>
            </>
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

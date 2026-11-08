import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from 'solid-js';
import type { StartCheck } from '../../../shared/types';
import { now } from '../board/ageClock';
import { aheadOf } from '../board/StartCheckWarning';
import { errorMessage } from '../bridgeError';
import Chevron from '../panel/Chevron';
import PinIcon from '../panel/PinIcon';
import ResizeEdge from '../panel/ResizeEdge';
import { useProject } from '../projects/projectContext';
import { reopenTask, startTask, startTodoItem, tasksOf } from '../tasksStore';
import { plainText } from './markdown';
import TicketPanel from './TicketPanel';
import { reopenTaskId, sourceLine, syncedLine, todoItems, visibleItems, type TodoItem } from './todoItems';
import { loadHideMine, saveHideMine, TODO_WIDTH } from './todoPrefs';
import { confirmTodoTools, pickTodoList, resetTodoSource, syncTodo, todoOf } from './todoStore';

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

/**
 * The project's to-do list, at its pane's far left: the synced cards and the owner's notes, with Sync and what it
 * asks of the owner, and the ticket of the item open. Pinned and out, it takes the pane's left edge and the manager
 * sits right of it; unpinned, it floats over the manager as that floats over the board. Its hide arrow calls
 * `onHide`, and the pane hands the focus to its Todo button.
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
  open: boolean;
  onHide(): void;
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

  /**
   * Opens a ticket in place of the one open. One a Start opens says what that Start found; any other with a Start runs
   * the start check, so its Start warns as New task's does.
   */
  function openTicket(key: string, found?: { warning: StartCheck | null; error: string | null }) {
    setWarning(found?.warning ?? null);
    setStartError(found?.error ?? null);
    const check = !found && (key === 'new-note' || itemByKey().get(key)?.action?.kind === 'start');
    setChecking(check);
    props.onTicketChange(key);
    if (!check) return;
    window.mainframe
      .startCheck(project.dir)
      .then(aheadOf, (err: unknown) => {
        console.error(`[todo] start check failed for ${project.dir}: ${errorMessage(err)}`);
        return null;
      })
      .then((warns) => {
        if (props.ticket !== key) return;
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
    o: { noQuestions: boolean; note?: { title: string; text: string } },
    check = false,
  ): Promise<void> {
    if (starting()) return;
    setStarting(true);
    const key = item === 'new-note' ? item : item.key;
    try {
      if (check) {
        const warns = aheadOf(await window.mainframe.startCheck(project.dir));
        if (warns) return openTicket(key, { warning: warns, error: null });
      }
      if (item === 'new-note') {
        await startTask(project.dir, { title: o.note!.title, description: o.note!.text, noQuestions: o.noQuestions });
      } else {
        // A note's edits are saved first, so its task starts from them.
        if (o.note && item.note) await window.mainframe.saveTodoNote(project.dir, { id: item.note.id, ...o.note });
        await startTodoItem(project.dir, { item: { kind: item.kind, id: item.id }, noQuestions: o.noQuestions });
      }
      // Another item's ticket stays, with what is typed in it.
      if (props.ticket === key) props.onTicketChange(null);
    } catch (err) {
      if (item !== 'new-note' && !itemByKey().has(key)) {
        // Its item has left the list, so there is no ticket to show the error in: a reopened one would close at once.
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

  return (
    <aside
      ref={aside}
      class="todo-panel"
      data-testid="todo-panel"
      aria-label="Todo"
      data-pinned={String(props.pinned)}
      data-open={String(props.open)}
      // What the pane leaves right of the panel, its margin kept: the ticket is no wider.
      style={{ width: `${props.width}px`, '--ticket-room': `${project.width() - props.width - 16}px` }}
    >
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
      {/* One tab for now, and Sync beside the pin, as the session panel's title bar holds its buttons: the row
          under it keeps its width for the source's name. */}
      <div class="todo-tabs">
        <h2 class="todo-tab">Todo</h2>
        <Show when={view()}>
          {(v) => (
            <button
              class="btn todo-sync"
              data-testid="todo-sync"
              disabled={v().syncing}
              onMouseDown={keepFocus}
              onClick={() => syncTodo(project.dir)}
            >
              <SyncIcon />
              {v().syncing ? 'Syncing…' : 'Sync'}
            </button>
          )}
        </Show>
      </div>

      <Show when={view()}>
        {(v) => (
          <>
            {/* Laid out as the manager's row under its title, so the two headers' dividers line up. */}
            <div class="p-branch-bar">
              <Show when={sourceLine(v())}>
                {(line) => (
                  <span class="todo-source-name" title={line()}>
                    {line()}
                  </span>
                )}
              </Show>
              <span class="todo-synced">{syncedLine(v(), now())}</span>
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
                Sync reads your to-do list through the connector you use for it. Notes you add stay in Mainframe.
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
                  Hide my cards
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
                              <span class="todo-label note">Note</span>
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
                <p class="todo-empty">Every card on the list is one of yours.</p>
              </Show>
              <button
                class="todo-add"
                data-testid="todo-add-note"
                ref={addNote}
                onMouseDown={keepFocus}
                onClick={() => openTicket('new-note')}
              >
                + Add note
              </button>
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

      <button
        class="panel-hide"
        data-testid="todo-hide"
        title="Hide Todo panel"
        aria-label="Hide Todo panel"
        onClick={() => props.onHide()}
      >
        <Chevron points="left" />
      </button>
      {/* Last in the panel, so macOS carves it out of the title bar's drag region. */}
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
  );
}

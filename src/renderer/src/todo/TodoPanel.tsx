import { createMemo, For, Match, Show, Switch } from 'solid-js';
import { now } from '../board/ageClock';
import Chevron from '../panel/Chevron';
import PinIcon from '../panel/PinIcon';
import ResizeEdge from '../panel/ResizeEdge';
import { useProject } from '../projects/projectContext';
import { tasksOf } from '../tasksStore';
import { sourceLine, syncedLine, todoItems } from './todoItems';
import { clampTodoWidth } from './todoPrefs';
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
 * asks of the owner. Pinned and out, it takes the pane's left edge and the manager sits right of it; unpinned, it
 * floats over the manager as that floats over the board. Its hide arrow calls `onOpenChange(false)`, and the pane
 * hands the focus to its Todo button.
 */
export default function TodoPanel(props: {
  /** The width it shows; the edge reports where a drag or a key takes it. */
  width: number;
  onDrag(w: number): void;
  onDone(w: number): void;
  pinned: boolean;
  onPinnedChange(pinned: boolean): void;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const project = useProject();
  const view = () => todoOf(project.dir);
  const items = createMemo(() => {
    const v = view();
    return v ? todoItems(v, tasksOf(project.dir).tasks) : [];
  });
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
      class="todo-panel"
      data-testid="todo-panel"
      aria-label="Todo"
      data-pinned={String(props.pinned)}
      data-open={String(props.open)}
      style={{ width: `${props.width}px` }}
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
                      Sync reads your to-do list in <strong>{ask().connector}</strong> with these tools, which only read:
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
            <ul class="todo-list" aria-label="To do">
              <For each={items()}>
                {(item) => (
                  <li class="todo-item" data-testid="todo-item" data-key={item.key} data-for-owner={String(item.forOwner)}>
                    <p class="todo-title">
                      <Show when={item.number}>{(number) => <span class="todo-num">{number()} </span>}</Show>
                      {item.title}
                    </p>
                    <Show when={item.body}>
                      <p class="todo-body">{item.body}</p>
                    </Show>
                    <Show when={item.kind === 'note' || item.labels.length > 0}>
                      <div class="todo-labels">
                        <Show when={item.kind === 'note'}>
                          <span class="todo-label note">Note</span>
                        </Show>
                        <For each={item.labels}>{(label) => <span class="todo-label">{label}</span>}</For>
                      </div>
                    </Show>
                  </li>
                )}
              </For>
            </ul>

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

      <button
        class="panel-hide"
        data-testid="todo-hide"
        title="Hide Todo panel"
        aria-label="Hide Todo panel"
        onClick={() => props.onOpenChange(false)}
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
        min={clampTodoWidth(0, project.width())}
        max={clampTodoWidth(Infinity, project.width())}
      />
    </aside>
  );
}

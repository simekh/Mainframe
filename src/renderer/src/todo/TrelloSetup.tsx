import { createSignal, createUniqueId, For, onMount, Show } from 'solid-js';
import type { TrelloBoardChoices, TrelloBoardRef, TrelloPick } from '../../../shared/types';
import { errorMessage } from '../bridgeError';
import { connectTrello, trelloConnection, trelloSignedIn } from '../settings/trelloStore';

// As the panel's own buttons: a press leaves the focus where it was.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/** Where a project's to-do list comes from: read from Trello directly, or through the agent's connector. */
export function SourceChoice(props: { onTrello(): void; onAgent(): void; onCancel?: () => void }) {
  return (
    <div class="todo-ask">
      <p>Where does this project's to-do list live?</p>
      <button class="todo-pick todo-source-pick" data-testid="todo-source-choice-trello" onMouseDown={keepFocus} onClick={props.onTrello}>
        <span>Trello</span>
        <span class="todo-pick-board">Reads the list directly and keeps it fresh.</span>
      </button>
      <button class="todo-pick todo-source-pick" data-testid="todo-source-choice-agent" onMouseDown={keepFocus} onClick={props.onAgent}>
        <span>Another tracker (AI connector)</span>
        <span class="todo-pick-board">Sync reads it through the connector you use for it.</span>
      </button>
      <Show when={props.onCancel}>
        {(cancel) => (
          <button class="todo-reset" onMouseDown={keepFocus} onClick={cancel()}>
            Cancel
          </button>
        )}
      </Show>
    </div>
  );
}

/** The Trello side of the choice: Connect Trello first while there is no sign-in, then the board and list to read. */
export default function TrelloSetup(props: { onUse(pick: TrelloPick): void; onCancel(): void }) {
  return (
    <Show
      when={trelloSignedIn()}
      fallback={
        <div class="todo-ask">
          <p>Connect your Trello account to pick the list this project reads.</p>
          <button class="btn primary" data-testid="todo-connect-trello" disabled={trelloConnection()?.connecting} onMouseDown={keepFocus} onClick={connectTrello}>
            {trelloConnection()?.connecting ? 'Waiting for your browser…' : trelloConnection()?.needsReconnect ? 'Reconnect Trello' : 'Connect Trello'}
          </button>
          <Show when={trelloConnection()?.error}>
            {(message) => (
              <p class="trello-setup-error" role="alert">
                {message()}
              </p>
            )}
          </Show>
          <button class="todo-reset" onMouseDown={keepFocus} onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      }
    >
      <PickList onUse={props.onUse} onCancel={props.onCancel} />
    </Show>
  );
}

/** Board, to-do list, in-progress list and the two label sets. Nothing starts picked: the owner names them all. */
function PickList(props: { onUse(pick: TrelloPick): void; onCancel(): void }) {
  const [boards, setBoards] = createSignal<TrelloBoardRef[] | null>(null);
  const [boardId, setBoardId] = createSignal<string | null>(null);
  const [choices, setChoices] = createSignal<TrelloBoardChoices | null>(null);
  const [listId, setListId] = createSignal<string | null>(null);
  const [inProgressId, setInProgressId] = createSignal<string | null>(null);
  const [mine, setMine] = createSignal<string[]>([]);
  const [urgent, setUrgent] = createSignal<string[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const ids = createUniqueId();

  onMount(() => {
    window.mainframe.trelloBoards().then(setBoards, (err: unknown) => setError(errorMessage(err)));
  });

  // Each board picked numbers its ask, so the lists of a board picked before never land on the one picked since.
  let asked = 0;
  function pickBoard(id: string | null) {
    const n = ++asked;
    setBoardId(id);
    setChoices(null);
    setListId(null);
    setInProgressId(null);
    setMine([]);
    setUrgent([]);
    setError(null);
    if (id === null) return;
    window.mainframe.trelloBoardChoices(id).then(
      (next) => n === asked && setChoices(next),
      (err: unknown) => n === asked && setError(errorMessage(err)),
    );
  }

  // A label with neither a name nor a colour can't be told apart, so it isn't offered.
  const labels = () =>
    (choices()?.labels ?? []).flatMap((l) => {
      const text = l.name || l.color;
      return text ? [{ id: l.id, text }] : [];
    });

  function use() {
    const board = boards()?.find((b) => b.id === boardId());
    const list = choices()?.lists.find((l) => l.id === listId());
    if (!board || !list) return;
    props.onUse({
      boardId: board.id,
      boardName: board.name,
      boardUrl: board.url,
      listId: list.id,
      listName: list.name,
      inProgressListId: inProgressId(),
      mineLabelIds: mine(),
      urgentLabelIds: urgent(),
    });
  }

  const listSelect = (o: { id: string; testId: string; value: () => string | null; pick(id: string | null): void; empty: string }) => (
    <select
      id={o.id}
      class="nt-select trello-select"
      data-testid={o.testId}
      disabled={choices() === null}
      onChange={(e) => o.pick(e.currentTarget.value || null)}
    >
      <option value="" selected={o.value() === null}>
        {o.empty}
      </option>
      <For each={choices()?.lists}>
        {(list) => (
          <option value={list.id} selected={o.value() === list.id}>
            {list.name}
          </option>
        )}
      </For>
    </select>
  );

  const chips = (o: { id: string; testId: string; picked: () => string[]; set(next: string[]): void }) => (
    <div class="trello-chips" role="group" aria-labelledby={o.id} data-testid={o.testId}>
      <For each={labels()} fallback={<span class="trello-none">{choices() ? 'No labels on this board' : 'Pick a board first'}</span>}>
        {(label) => {
          const on = () => o.picked().includes(label.id);
          return (
            <button
              class="trello-chip"
              aria-pressed={on() ? 'true' : 'false'}
              onMouseDown={keepFocus}
              onClick={() => o.set(on() ? o.picked().filter((id) => id !== label.id) : [...o.picked(), label.id])}
            >
              {label.text}
            </button>
          );
        }}
      </For>
    </div>
  );

  return (
    <div class="todo-ask trello-setup" data-testid="trello-setup">
      <p>Pick the Trello list this project reads as its to-do list.</p>
      <div class="trello-fields">
        <label for={`trello-board-${ids}`}>Board</label>
        <select
          id={`trello-board-${ids}`}
          class="nt-select trello-select"
          data-testid="trello-board"
          disabled={boards() === null}
          onChange={(e) => pickBoard(e.currentTarget.value || null)}
        >
          <option value="" selected={boardId() === null}>
            {boards() !== null ? 'Pick a board' : error() ? 'No boards' : 'Loading boards…'}
          </option>
          <For each={boards()}>
            {(board) => (
              <option value={board.id} selected={boardId() === board.id}>
                {board.name}
              </option>
            )}
          </For>
        </select>

        <label for={`trello-list-${ids}`}>To-do list</label>
        {listSelect({ id: `trello-list-${ids}`, testId: 'trello-list', value: listId, pick: setListId, empty: 'Pick a list' })}

        <label for={`trello-in-progress-${ids}`}>In progress</label>
        {listSelect({ id: `trello-in-progress-${ids}`, testId: 'trello-in-progress', value: inProgressId, pick: setInProgressId, empty: 'None' })}

        <span id={`trello-mine-${ids}`} class="trello-key">
          Mine
        </span>
        {chips({ id: `trello-mine-${ids}`, testId: 'trello-mine', picked: mine, set: setMine })}

        <span id={`trello-urgent-${ids}`} class="trello-key">
          Comes first
        </span>
        {chips({ id: `trello-urgent-${ids}`, testId: 'trello-urgent', picked: urgent, set: setUrgent })}
      </div>
      <p class="trello-hint">Mine marks the cards that are yours to do. Comes first puts cards ahead of the rest.</p>
      <Show when={error()}>
        {(message) => (
          <p class="trello-setup-error" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <div class="trello-actions">
        <button class="todo-reset" onMouseDown={keepFocus} onClick={props.onCancel}>
          Cancel
        </button>
        <button class="btn primary" data-testid="trello-use" disabled={listId() === null} onMouseDown={keepFocus} onClick={use}>
          Use this
        </button>
      </div>
    </div>
  );
}

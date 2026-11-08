import { createSignal, For, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import type { StartCheck } from '../../../shared/types';
import { now } from '../board/ageClock';
import StartCheckWarning from '../board/StartCheckWarning';
import { errorMessage } from '../bridgeError';
import { openLinkLogged } from '../openLink';
import ResumeIcon from '../panel/ResumeIcon';
import { useProject } from '../projects/projectContext';
import { isFocused } from '../projects/projectsStore';
import { reopenTaskId, syncedAgo, type TodoItem } from './todoItems';
import { todoOf } from './todoStore';

// Its buttons don't take the focus on click, as the Todo panel's don't: typing stays where it was.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * A card or a note in full, joined to the Todo panel's right edge and over the board and the manager. A card is
 * shown as the last sync left it; a note, or the new one, can be edited and saved. Mounted for one item: the pane
 * mounts it anew for another, so a note's fields never carry over.
 */
export default function TicketPanel(props: {
  item: TodoItem | 'new-note';
  warning: StartCheck | null;
  /** Why the last Start of this item failed. */
  error: string | null;
  /** A start is under way in the project, or the ticket's start check: Start waits for it. */
  starting: boolean;
  onClose(): void;
  onStart(o: { noQuestions: boolean; note?: { title: string; text: string } }): void;
  onReopen(taskId: string): void;
}) {
  const project = useProject();
  const view = () => todoOf(project.dir);
  const item = () => (props.item === 'new-note' ? null : props.item);
  const card = () => item()?.card ?? null;
  const note = () => item()?.note ?? null;
  const isNote = () => props.item === 'new-note' || props.item.kind === 'note';
  const action = () => (props.item === 'new-note' ? { kind: 'start' as const } : props.item.action);
  const reopenId = () => reopenTaskId(action());
  // Where the card opens in its source: only for a card with a URL, from a source the last sync named.
  const link = () => {
    const url = card()?.url;
    const source = view()?.source;
    return url && source ? { url, kind: source.kind } : null;
  };

  const [title, setTitle] = createSignal(note()?.title ?? '');
  const [text, setText] = createSignal(note()?.text ?? '');
  const [noQuestions, setNoQuestions] = createSignal(false);
  const [noteError, setNoteError] = createSignal<string | null>(null);
  // The new note is all edits; main trims a saved title.
  const edited = () => {
    const n = note();
    return !n || title().trim() !== n.title || text() !== n.text;
  };
  const fields = () => (isNote() && edited() ? { title: title(), text: text() } : undefined);

  const save = () => {
    setNoteError(null);
    // The new note shows in the list once saved, which opens it from there.
    window.mainframe.saveTodoNote(project.dir, { id: note()?.id, title: title(), text: text() }).then(
      () => props.item === 'new-note' && props.onClose(),
      (err: unknown) => setNoteError(errorMessage(err)),
    );
  };
  const remove = (id: string) => {
    setNoteError(null);
    window.mainframe.deleteTodoNote(project.dir, id).then(props.onClose, (err: unknown) => setNoteError(errorMessage(err)));
  };

  let titleInput: HTMLInputElement | undefined;
  onMount(() => {
    if (props.item === 'new-note') titleInput?.focus();
  });

  // Esc closes the ticket of the project the owner works in, unless a modal dialog is open: that takes the Esc. A
  // terminal keeps its own Esc, which never reaches the document.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && isFocused(project.dir) && !document.querySelector('dialog:modal')) props.onClose();
  };
  document.addEventListener('keydown', onKeyDown);
  onCleanup(() => document.removeEventListener('keydown', onKeyDown));

  return (
    <section
      class="ticket-panel"
      data-testid="ticket-panel"
      aria-label={props.item === 'new-note' ? 'New note' : props.item.title}
    >
      <button
        class="ticket-close"
        data-testid="ticket-close"
        aria-label="Close ticket"
        title="Close ticket"
        onMouseDown={keepFocus}
        onClick={() => props.onClose()}
      >
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
          <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
        </svg>
      </button>

      <div class="ticket-body">
        <Show
          when={card()}
          fallback={
            <>
              <h3 class="ticket-title">{props.item === 'new-note' ? 'New note' : 'Note'}</h3>
              <label class="ticket-field">
                <span>Title</span>
                <input
                  ref={titleInput}
                  type="text"
                  autocomplete="off"
                  value={title()}
                  onInput={(e) => setTitle(e.currentTarget.value)}
                />
              </label>
              <label class="ticket-field">
                <span>Text</span>
                <textarea value={text()} onInput={(e) => setText(e.currentTarget.value)} />
              </label>
              <div class="ticket-note-actions">
                <button
                  class="btn"
                  data-testid="note-save"
                  disabled={!title().trim() || !edited()}
                  onMouseDown={keepFocus}
                  onClick={save}
                >
                  Save note
                </button>
                <Show when={note()}>
                  {(n) => (
                    <button class="btn ticket-delete" data-testid="note-delete" onMouseDown={keepFocus} onClick={() => remove(n().id)}>
                      Delete note
                    </button>
                  )}
                </Show>
              </div>
              <Show when={noteError()}>
                {(message) => (
                  <p class="ticket-error" role="alert">
                    {message()}
                  </p>
                )}
              </Show>
            </>
          }
        >
          {(c) => (
            <>
              <h3 class="ticket-title">
                <Show when={c().number}>{(number) => <span class="card-number">{number()} </span>}</Show>
                {c().title}
              </h3>
              <Show when={c().labels.length > 0 || link()}>
                <div class="ticket-meta">
                  <For each={c().labels}>{(label) => <span class="todo-label">{label}</span>}</For>
                  <Show when={link()}>
                    {(l) => (
                      <button
                        class="ticket-link"
                        data-testid="ticket-link"
                        onMouseDown={keepFocus}
                        onClick={() => openLinkLogged(l().url, 'todo')}
                      >
                        Open in {l().kind} ↗
                      </button>
                    )}
                  </Show>
                </div>
              </Show>
              <Show when={c().description}>
                <p class="ticket-desc">{c().description}</p>
              </Show>
              <For each={c().checklists}>
                {(list) => (
                  <div class="ticket-checklist">
                    <h4>{list.name}</h4>
                    <ul aria-label={list.name}>
                      <For each={list.items}>
                        {(entry) => (
                          <li>
                            <label>
                              <input type="checkbox" checked={entry.done} disabled />
                              <span>{entry.text}</span>
                            </label>
                          </li>
                        )}
                      </For>
                    </ul>
                  </div>
                )}
              </For>
              <Show when={view()?.syncedAt}>
                {(syncedAt) => <p class="ticket-synced">The card as of the last sync, {syncedAgo(syncedAt(), now())}</p>}
              </Show>
            </>
          )}
        </Show>
      </div>

      <Switch>
        <Match when={reopenId()}>
          {(taskId) => (
            <footer class="ticket-foot">
              <div class="ticket-actions">
                <button class="btn" data-testid="ticket-reopen" onMouseDown={keepFocus} onClick={() => props.onReopen(taskId())}>
                  <ResumeIcon />
                  Reopen
                </button>
              </div>
            </footer>
          )}
        </Match>
        <Match when={action()?.kind === 'start'}>
          <footer class="ticket-foot">
            <Show when={props.warning}>{(check) => <StartCheckWarning check={check()} testId="ticket-warning" />}</Show>
            <Show when={props.error}>
              {(message) => (
                <p class="ticket-error" data-testid="ticket-error" role="alert">
                  {message()}
                </p>
              )}
            </Show>
            <div class="ticket-actions">
              <button
                class="btn primary"
                data-testid="ticket-start"
                disabled={props.starting || (isNote() && !title().trim())}
                onMouseDown={keepFocus}
                onClick={() => props.onStart({ noQuestions: noQuestions(), note: fields() })}
              >
                {props.warning ? 'Start anyway' : 'Start'}
              </button>
              <label class="ticket-noq">
                <input
                  type="checkbox"
                  data-testid="ticket-no-questions"
                  checked={noQuestions()}
                  onChange={(e) => setNoQuestions(e.currentTarget.checked)}
                />
                Don't ask me questions
              </label>
            </div>
          </footer>
        </Match>
      </Switch>
    </section>
  );
}

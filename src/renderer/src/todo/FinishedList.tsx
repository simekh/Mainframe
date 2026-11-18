import { createMemo, createSignal, For, Show } from 'solid-js';
import type { TaskView } from '../../../shared/types';
import { errorMessage } from '../bridgeError';
import { useProject } from '../projects/projectContext';
import { continueTask } from '../tasksStore';
import { endedLine, finishedTasks } from './todoItems';

// Its buttons don't take the focus on click, as the Todo panel's don't.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * The Todo panel's Finished tab: the project's finished and discarded tasks (`finishedTasks`, which the panel counts
 * for its tab too), the newest first, with a search on the
 * title and the card number. Continue brings a task back to the board, selected; a Continue that fails says why on its
 * row.
 */
export default function FinishedList(props: { tasks: TaskView[] }) {
  const project = useProject();
  const [query, setQuery] = createSignal('');
  const [failed, setFailed] = createSignal<{ id: string; message: string } | null>(null);
  const shown = createMemo(() => finishedTasks(props.tasks, query()));

  const continueOne = (id: string) => {
    setFailed(null);
    continueTask(project.dir, id).catch((err: unknown) => {
      console.error(`[tasks] could not continue task ${id}: ${errorMessage(err)}`);
      setFailed({ id, message: errorMessage(err) });
    });
  };

  return (
    <>
      {/* In the row under the title, as To do's sync line is, so the two tabs' dividers line up. */}
      <label class="p-branch-bar finished-bar">
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
          <circle cx="6" cy="6" r="4" />
          <path d="M9 9l3 3" />
        </svg>
        <input
          class="finished-search"
          data-testid="finished-search"
          type="search"
          placeholder="Search finished tasks"
          aria-label="Search finished tasks"
          autocomplete="off"
          spellcheck={false}
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      </label>
      <div class="todo-scroll">
        <Show when={props.tasks.length === 0}>
          <p class="finished-empty">Tasks land here once their work is merged, or when you discard them.</p>
        </Show>
        <ul class="todo-list" aria-label="Finished">
          <For each={shown()}>
            {(task) => (
              <li class="finished-row" data-testid="finished-row" data-task-id={task.id} data-place={task.place}>
                <div class="finished-text">
                  <span class="finished-title">
                    <Show when={task.card?.number}>{(number) => <span class="card-number">{number()} </span>}</Show>
                    {task.title}
                  </span>
                  <span class="finished-meta">{endedLine(task)}</span>
                  <Show when={failed()?.id === task.id ? failed()!.message : null}>
                    {(message) => (
                      <span class="finished-error" role="alert">
                        {message()}
                      </span>
                    )}
                  </Show>
                </div>
                <button
                  class="card-act"
                  data-testid="finished-continue"
                  aria-label={`Continue ${task.title}`}
                  onMouseDown={keepFocus}
                  onClick={() => continueOne(task.id)}
                >
                  Continue
                </button>
              </li>
            )}
          </For>
        </ul>
        <Show when={props.tasks.length > 0 && shown().length === 0}>
          <p class="finished-empty">No finished task matches “{query().trim()}”.</p>
        </Show>
      </div>
    </>
  );
}

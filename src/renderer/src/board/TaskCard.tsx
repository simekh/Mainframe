// Adapted from Parallel Code (MIT): src/components/TaskBoardCard.tsx at 97c3558. See THIRD_PARTY_NOTICES.md.
import { onCleanup, Show } from 'solid-js';
import type { TaskView } from '../../../shared/types';
import { errorMessage } from '../bridgeError';
import type { SessionState } from '../taskModel';
import { isSuggesting, reopenTask, select, tasksStore } from '../tasksStore';
import { focusCardWhenShown } from './cardMoves';
import { cardActivity, cardAge, glyphOf, stateLabel, type Lane } from './lanes';
import StatusGlyph from './StatusGlyph';

// Cards and their buttons don't take focus on click, so typing stays in the terminal.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/** One task on the board. Its title button stretches over the card, so a click anywhere selects it. */
export default function TaskCard(props: {
  task: TaskView;
  session: SessionState | undefined;
  /** The lane it is shown in. */
  lane: Lane;
  now: number;
  projectName: string;
}) {
  const glyph = () => glyphOf(props.task, props.session);
  const label = () => stateLabel(props.task, props.session);
  const activity = () => cardActivity(props.task, props.session);
  const selected = () => props.task.id === tasksStore.selectedId;
  const suggesting = () => isSuggesting(props.task);
  const suggestionId = `suggestion-${props.task.id}`;
  const reopen = () =>
    reopenTask(props.task.id).catch((err: unknown) =>
      console.error(`[tasks] could not reopen task ${props.task.id}: ${errorMessage(err)}`),
    );

  let cardEl!: HTMLLIElement;
  // A card that changes lanes is rebuilt in its new one, and the focus on the old card falls to
  // the body: hand it to the new card once that is in place.
  onCleanup(() => {
    if (!cardEl.contains(document.activeElement)) return;
    const taskId = props.task.id;
    queueMicrotask(() => focusCardWhenShown(taskId));
  });

  return (
    <li
      ref={cardEl}
      class={glyph() === 'error' ? 'card state-error' : 'card'}
      data-testid="task-card"
      data-task-id={props.task.id}
      data-lane={props.lane}
      data-selected={String(selected())}
      data-suggestion={suggesting() ? 'true' : undefined}
    >
      <button
        class="card-title"
        aria-current={selected() ? 'true' : undefined}
        aria-describedby={suggesting() ? suggestionId : undefined}
        onMouseDown={keepFocus}
        onClick={() => select(props.task.id)}
      >
        <StatusGlyph glyph={glyph()} label={label().text} />
        <span class="card-name">{props.task.title}</span>
      </button>
      <Show when={suggesting()}>
        <span id={suggestionId} class="visually-hidden">
          Claude Code has a suggestion for you
        </span>
      </Show>
      <p class="card-meta">
        <span class="card-project">
          <i aria-hidden="true" />
          <span>{props.projectName}</span>
        </span>
        <span class="card-age" data-testid="task-age">
          {cardAge(props.task, props.session, props.now)}
        </span>
      </p>
      <p class={`card-activity ${activity().kind}`} data-testid="task-activity">
        {activity().text}
      </p>
      <Show when={props.lane !== 'working'}>
        <div class="card-ask">
          <span class={`card-ask-label tone-${label().tone}`} data-testid="task-ask">
            {label().text}
          </span>
          <Show
            when={props.lane === 'closed'}
            fallback={
              <button
                class="card-act"
                data-testid="answer"
                aria-label={`Answer ${props.task.title}`}
                onMouseDown={keepFocus}
                onClick={() => select(props.task.id)}
              >
                Answer
              </button>
            }
          >
            <button
              class="card-act"
              data-testid="reopen"
              aria-label={`Reopen ${props.task.title}`}
              onMouseDown={keepFocus}
              onClick={reopen}
            >
              Reopen
            </button>
          </Show>
        </div>
      </Show>
    </li>
  );
}

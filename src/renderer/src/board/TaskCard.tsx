import { Show } from 'solid-js';
import type { TaskView } from '../../../shared/types';
import { errorMessage } from '../bridgeError';
import type { SessionState } from '../taskModel';
import { reopenTask, select, tasksStore } from '../tasksStore';
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
  const reopen = () =>
    reopenTask(props.task.id).catch((err: unknown) =>
      console.error(`[tasks] could not reopen task ${props.task.id}: ${errorMessage(err)}`),
    );

  return (
    <li
      class={glyph() === 'error' ? 'card state-error' : 'card'}
      data-testid="task-card"
      data-task-id={props.task.id}
      data-lane={props.lane}
      data-selected={String(props.task.id === tasksStore.selectedId)}
    >
      <button class="card-title" onMouseDown={keepFocus} onClick={() => select(props.task.id)}>
        <StatusGlyph glyph={glyph()} label={label().text} />
        <span class="card-name">{props.task.title}</span>
      </button>
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
              <button class="card-act" data-testid="answer" onMouseDown={keepFocus} onClick={() => select(props.task.id)}>
                Answer
              </button>
            }
          >
            <button class="card-act" data-testid="reopen" onMouseDown={keepFocus} onClick={reopen}>
              Reopen
            </button>
          </Show>
        </div>
      </Show>
    </li>
  );
}

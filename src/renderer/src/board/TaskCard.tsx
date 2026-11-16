// Adapted from Parallel Code (MIT): src/components/TaskBoardCard.tsx at 97c3558. See THIRD_PARTY_NOTICES.md.
import { Match, onCleanup, Show, Switch } from 'solid-js';
import { AGENT_NAMES, type TaskView } from '../../../shared/types';
import { errorMessage } from '../bridgeError';
import type { SessionState } from '../taskModel';
import { useProject } from '../projects/projectContext';
import { closeTask, isSuggesting, putBackTask, reopenTask, select, tasksOf } from '../tasksStore';
import { focusCardWhenShown } from './cardMoves';
import { cardActivity, cardAge, cardAsk, glyphOf, stateLabel, type Lane } from './lanes';
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
  /** Asks the owner to confirm a Discard of this paused task. */
  onDiscard: (task: TaskView) => void;
}) {
  const glyph = () => glyphOf(props.task, props.session);
  const label = () => stateLabel(props.task, props.session);
  const activity = () => cardActivity(props.task, props.session);
  const ask = () => cardAsk(props.task, props.session, props.lane);
  const project = useProject();
  const selected = () => props.task.id === tasksOf(project.dir).selectedId;
  const suggesting = () => isSuggesting(props.task);
  const reopen = () =>
    reopenTask(project.dir, props.task.id).catch((err: unknown) =>
      console.error(`[tasks] could not reopen task ${props.task.id}: ${errorMessage(err)}`),
    );
  // Not awaited: a card's task runs its agent a whole turn first, and shows in Working meanwhile.
  const putBack = () => {
    menu.hidePopover();
    putBackTask(project.dir, props.task.id).catch((err: unknown) =>
      console.error(`[tasks] could not put back task ${props.task.id}: ${errorMessage(err)}`),
    );
  };
  const discard = () => {
    menu.hidePopover();
    props.onDiscard(props.task);
  };

  // The Paused card's Put back and Discard, in a menu in the top layer: the lane's list would clip it. Named by the
  // task's id, which no two cards in any project share.
  let menu!: HTMLDivElement;
  const menuId = () => `card-menu-${props.task.id}`;
  const anchor = () => `--card-more-${props.task.id}`;
  // Open, it takes the focus, so Esc closes it rather than reaching the terminal's agent; closed, the browser hands the
  // focus back to where it was. Up and Down move between its items. Its Esc goes no further, so it doesn't also close
  // an open ticket: a native listener, as Solid's own wait at the document, where the ticket's listener is too.
  const focusFirstItem = (e: ToggleEvent) => {
    if (e.newState === 'open') menu.querySelector<HTMLElement>('[role=menuitem]')?.focus();
  };
  const moveInMenu = (e: KeyboardEvent) => {
    if (e.key === 'Escape') e.stopPropagation();
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...menu.querySelectorAll<HTMLElement>('[role=menuitem]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };

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
        aria-description={suggesting() ? 'Claude Code has a suggestion for you' : undefined}
        onMouseDown={keepFocus}
        onClick={() => select(project.dir, props.task.id)}
      >
        <StatusGlyph glyph={glyph()} label={label().text} />
        <span class="card-name">
          <Show when={props.task.card?.number}>
            {(number) => (
              <span class="card-number" data-testid="task-card-number">
                {number()}{' '}
              </span>
            )}
          </Show>
          {props.task.title}
        </span>
      </button>
      <p class="card-meta">
        <span class="card-project">
          <i aria-hidden="true" />
          <span>{project.name}</span>
        </span>
        <Show when={props.task.agent === 'opencode'}>
          <span class="agent-mark" data-testid="task-agent">
            {AGENT_NAMES.opencode}
          </span>
        </Show>
        <span class="card-age" data-testid="task-age">
          {cardAge(props.task, props.session, props.now)}
        </span>
      </p>
      {/* A problem is cut to one line: the whole of it shows on hover. */}
      <p
        class={`card-activity ${activity().kind}`}
        data-testid="task-activity"
        title={activity().kind === 'problem' ? activity().text : undefined}
      >
        {activity().text}
      </p>
      <Show when={ask()}>
        {(row) => (
          <div class="card-ask">
            <span class={`card-ask-label tone-${row().tone}`} data-testid="task-ask">
              {row().text}
            </span>
            <Switch>
              <Match when={row().act === 'answer'}>
                <button
                  class="card-act"
                  data-testid="answer"
                  aria-label={`Answer ${props.task.title}`}
                  onMouseDown={keepFocus}
                  onClick={() => select(project.dir, props.task.id)}
                >
                  Answer
                </button>
              </Match>
              <Match when={row().act === 'finish'}>
                <button
                  class="card-act"
                  data-testid="finish"
                  aria-label={`Finish ${props.task.title}`}
                  onMouseDown={keepFocus}
                  onClick={() => closeTask(project.dir, props.task.id)}
                >
                  Finish
                </button>
              </Match>
              <Match when={row().act === 'paused'}>
                <button
                  class="card-act"
                  data-testid="reopen"
                  aria-label={`Reopen ${props.task.title}`}
                  onMouseDown={keepFocus}
                  onClick={reopen}
                >
                  Reopen
                </button>
                <button
                  class="card-more"
                  data-testid="card-more"
                  aria-label={`More for ${props.task.title}`}
                  aria-haspopup="menu"
                  popovertarget={menuId()}
                  style={{ 'anchor-name': anchor() }}
                  onMouseDown={keepFocus}
                >
                  <svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                    <circle cx="3" cy="7" r="1.25" />
                    <circle cx="7" cy="7" r="1.25" />
                    <circle cx="11" cy="7" r="1.25" />
                  </svg>
                </button>
              </Match>
            </Switch>
          </div>
        )}
      </Show>
      {/* No menu while a Put back runs: its card offers nothing until that is over. */}
      <Show when={props.lane === 'paused' && !props.task.puttingBack}>
        <div
          ref={menu}
          id={menuId()}
          popover="auto"
          role="menu"
          class="card-menu"
          aria-label={`More for ${props.task.title}`}
          style={{ 'position-anchor': anchor() }}
          on:toggle={focusFirstItem}
          on:keydown={moveInMenu}
        >
          <button role="menuitem" class="card-menu-item" data-testid="put-back" onMouseDown={keepFocus} onClick={putBack}>
            Put back
            <span class="card-menu-hint">On the to-do list, for later</span>
          </button>
          <button role="menuitem" class="card-menu-item danger" data-testid="discard" onMouseDown={keepFocus} onClick={discard}>
            Discard
            <span class="card-menu-hint">Remove its worktree and branch</span>
          </button>
        </div>
      </Show>
    </li>
  );
}

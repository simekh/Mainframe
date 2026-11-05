import { For, Show } from 'solid-js';
import type { RendererConfig, TaskView } from '../../../shared/types';
import { now } from '../board/ageClock';
import { cardAge, glyphOf, stateLabel } from '../board/lanes';
import StatusGlyph from '../board/StatusGlyph';
import { errorMessage } from '../bridgeError';
import { closeTask, reopenTask, sessionOf, tasksStore, terminalOf } from '../tasksStore';
import TerminalView from '../terminal/TerminalView';
import ChangedFiles from './ChangedFiles';
import MessageField from './MessageField';

// Buttons don't take focus on click, so typing stays in the terminal.
const keepFocus = (e: MouseEvent) => e.preventDefault();

const labelOf = (task: TaskView) => stateLabel(task, sessionOf(task));

/**
 * The selected task in the side panel: its header, what it changed, its terminal and a field to
 * message it. Laid out at one size with a selection or without, so the terminals keep theirs.
 */
export default function SessionPanel(props: { task: TaskView | undefined; config: RendererConfig | undefined }) {
  const shownTerminal = () => (props.task ? terminalOf(props.task.id) : null);
  const reopen = (id: string) =>
    reopenTask(id).catch((err: unknown) => console.error(`[tasks] could not reopen task ${id}: ${errorMessage(err)}`));

  return (
    <div class="session" hidden={!props.task}>
      <header>
        <div class="p-title-bar">
          <Show when={props.task}>
            {(task) => (
              <>
                <StatusGlyph
                  glyph={glyphOf(task(), sessionOf(task()))}
                  label={labelOf(task()).text}
                  size="md"
                />
                <h2 class="p-title" data-testid="panel-title" title={task().title}>
                  {task().title}
                </h2>
                <div class="p-actions">
                  <Show
                    when={task().session}
                    fallback={
                      <button
                        class="btn"
                        data-testid="panel-reopen"
                        onMouseDown={keepFocus}
                        onClick={() => reopen(task().id)}
                      >
                        <svg
                          viewBox="0 0 14 14"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M2.5 7a4.5 4.5 0 1 0 1.4-3.3" />
                          <path d="M3.5 1.5v2.6h2.6" />
                        </svg>
                        Reopen
                      </button>
                    }
                  >
                    <button
                      class="btn"
                      data-testid="close-session"
                      onMouseDown={keepFocus}
                      onClick={() => closeTask(task().id)}
                    >
                      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                        <rect x="3" y="3" width="8" height="8" rx="1.5" />
                      </svg>
                      Close session
                    </button>
                  </Show>
                </div>
              </>
            )}
          </Show>
        </div>
        <div class="p-branch-bar">
          <Show when={props.task}>
            {(task) => (
              <>
                <span class="p-project" data-testid="panel-project">
                  <i aria-hidden="true" />
                  <span>{props.config?.projectName}</span>
                </span>
                <span class="p-branch">
                  <svg
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linecap="round"
                    aria-hidden="true"
                  >
                    <circle cx="3.5" cy="2.5" r="1.3" />
                    <circle cx="3.5" cy="9.5" r="1.3" />
                    <circle cx="8.5" cy="4" r="1.3" />
                    <path d="M3.5 3.8v4.4M8.5 5.3c0 2-5 1.4-5 2.9" />
                  </svg>
                  <span data-testid="panel-branch">{task().branch}</span>
                </span>
                <span class="p-state" data-testid="panel-state">
                  <span class={`label tone-${labelOf(task()).tone}`}>
                    {labelOf(task()).text}
                  </span>
                  <span class="age">{cardAge(task(), sessionOf(task()), now())}</span>
                </span>
              </>
            )}
          </Show>
        </div>
      </header>

      <ChangedFiles taskId={props.task?.id ?? null} running={!!props.task?.session} />

      <div class="well">
        <Show when={props.config}>
          {(c) => (
            <For each={tasksStore.terminals}>
              {(entry) => (
                <TerminalView sessionId={entry.sessionId} selected={entry.sessionId === shownTerminal()} config={c()} />
              )}
            </For>
          )}
        </Show>
        {/* Closed before this start: no terminal holds its last output. */}
        <Show when={props.task && !props.task.session && !shownTerminal()}>
          <p class="closed-note">Closed. Reopen continues this chat.</p>
        </Show>
      </div>

      <MessageField task={props.task} />
    </div>
  );
}

import { createMemo, createSignal, Show } from 'solid-js';
import type { RendererConfig } from '../../../shared/types';
import { glyphOf, stateLabel } from '../board/lanes';
import StatusGlyph from '../board/StatusGlyph';
import { errorMessage } from '../bridgeError';
import ResizeEdge from '../panel/ResizeEdge';
import { sessionOf } from '../tasksStore';
import TerminalView from '../terminal/TerminalView';
import { windowWidth } from '../windowWidth';
import { clampManagerWidth } from './managerPrefs';
import { managerStore, restartManager } from './managerStore';

// Restart doesn't take the focus on click: it puts the cursor in the new terminal itself.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * The manager's column, at the window's left: its header over its terminal, which is always on
 * screen. Its top is the window's title bar, with the window buttons in it. The terminal never takes
 * the focus by itself; a click puts the cursor there.
 */
export default function ManagerColumn(props: {
  config: RendererConfig | undefined;
  /** The width it shows; the edge reports where a drag or a key takes it. */
  width: number;
  onDrag(w: number): void;
  onDone(w: number): void;
}) {
  // Nothing until the manager's first view is in.
  const state = createMemo(() => {
    const manager = managerStore.manager;
    return manager && { glyph: glyphOf(manager, sessionOf(manager)), ...stateLabel(manager, sessionOf(manager)) };
  });
  const [restartError, setRestartError] = createSignal<string | null>(null);
  const restart = () => {
    setRestartError(null);
    restartManager().catch((err: unknown) => setRestartError(errorMessage(err)));
  };

  return (
    <aside class="manager-column" data-testid="manager-column" aria-label="Manager" style={{ width: `${props.width}px` }}>
      <header>
        <div class="manager-title-bar" data-testid="manager-title-bar">
          <Show when={state()}>{(s) => <StatusGlyph glyph={s().glyph} label={s().text} size="md" />}</Show>
          <h2 class="p-title" data-testid="manager-title">
            Manager
          </h2>
        </div>
        <div class="p-branch-bar">
          <span class="p-project">
            <i aria-hidden="true" />
            <span>{props.config?.projectName}</span>
          </span>
          <Show when={state()}>
            {(s) => (
              <span class="p-state" data-testid="manager-state">
                <span class={`label tone-${s().tone}`}>{s().text}</span>
              </span>
            )}
          </Show>
        </div>
      </header>

      <div class="manager-well">
        <Show when={props.config}>
          {(c) => (
            // Keyed: a new session gets a new terminal, as a task's does.
            <Show when={managerStore.managerTerminal} keyed>
              {(sessionId) => <TerminalView sessionId={sessionId} selected takeFocus={false} config={c()} />}
            </Show>
          )}
        </Show>
      </div>

      <Show when={managerStore.manager?.session === null}>
        <div class="manager-stopped">
          <p>The manager stopped. Restart continues its chat.</p>
          <button class="btn" data-testid="manager-restart" onMouseDown={keepFocus} onClick={restart}>
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
            Restart
          </button>
          <Show when={restartError()}>
            {(message) => (
              <p class="manager-error" role="alert">
                {message()}
              </p>
            )}
          </Show>
        </div>
      </Show>

      {/* Last in the column, so macOS carves it out of the title bar's drag region. */}
      <ResizeEdge
        width={props.width}
        onDrag={props.onDrag}
        onDone={props.onDone}
        grows="right"
        label="Manager width"
        testId="manager-resize"
        min={clampManagerWidth(0, windowWidth())}
        max={clampManagerWidth(Infinity, windowWidth())}
      />
    </aside>
  );
}

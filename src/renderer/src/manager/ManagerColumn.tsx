import { createMemo, createSignal, Show } from 'solid-js';
import type { RendererConfig } from '../../../shared/types';
import { glyphOf, stateLabel } from '../board/lanes';
import StatusGlyph from '../board/StatusGlyph';
import { errorMessage } from '../bridgeError';
import Chevron from '../panel/Chevron';
import PinIcon from '../panel/PinIcon';
import ResizeEdge from '../panel/ResizeEdge';
import ResumeIcon from '../panel/ResumeIcon';
import { useProject } from '../projects/projectContext';
import { sessionOf } from '../tasksStore';
import TerminalView from '../terminal/TerminalView';
import { MANAGER_WIDTH } from './managerPrefs';
import { managerOf, restartManager } from './managerStore';

// Restart and the pin don't take the focus on click: Restart puts the cursor in the new terminal
// itself, and typing stays where it was after a pin.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * The manager's column, at its project pane's left: its header over its terminal, which is on screen
 * while the pane is and the column is out. Pinned, it sits beside the board; unpinned, it floats over
 * the board's left edge, as the session panel does on the right. The terminal never takes the focus by
 * itself; a click puts the cursor there.
 */
export default function ManagerColumn(props: {
  config: RendererConfig | undefined;
  /** The width it shows; the edge reports where a drag or a key takes it. */
  width: number;
  /** The widest it can be in the room the pane gives it, which the edge announces. */
  maxWidth: number;
  onDrag(w: number): void;
  onDone(w: number): void;
  pinned: boolean;
  onPinnedChange(pinned: boolean): void;
  /** Put away, it stays mounted, so its terminal keeps its output and its size. */
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  let hideButton!: HTMLButtonElement;
  let showButton!: HTMLButtonElement;
  const project = useProject();
  // Nothing until the manager's first view is in.
  const state = createMemo(() => {
    const manager = managerOf(project.dir)?.manager;
    return manager && { glyph: glyphOf(manager, sessionOf(manager)), ...stateLabel(manager, sessionOf(manager)) };
  });
  const [restartError, setRestartError] = createSignal<string | null>(null);
  const restart = () => {
    setRestartError(null);
    restartManager(project.dir).catch((err: unknown) => setRestartError(errorMessage(err)));
  };
  // Each hands the focus to the other, so the keyboard never ends up in a hidden column.
  const hide = () => {
    props.onOpenChange(false);
    showButton.focus();
  };
  const show = () => {
    props.onOpenChange(true);
    hideButton.focus();
  };

  return (
    <>
      <aside
        class="manager-column"
        data-testid="manager-column"
        aria-label="Manager"
        data-pinned={String(props.pinned)}
        data-open={String(props.open)}
        style={{ width: `${props.width}px` }}
      >
        <button
          class="panel-pin"
          data-testid="manager-pin"
          aria-pressed={props.pinned ? 'true' : 'false'}
          aria-label="Pin manager"
          title={props.pinned ? 'Unpin manager' : 'Pin manager'}
          onMouseDown={keepFocus}
          onClick={() => props.onPinnedChange(!props.pinned)}
        >
          <PinIcon />
        </button>
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
              <span>{project.name}</span>
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
              <Show when={managerOf(project.dir)?.managerTerminal} keyed>
                {(sessionId) => (
                  <TerminalView sessionId={sessionId} selected={project.shown() && props.open} takeFocus={false} config={c()} />
                )}
              </Show>
            )}
          </Show>
        </div>

        <Show when={managerOf(project.dir)?.manager.session === null}>
          <div class="manager-stopped">
            <p>The manager stopped. Restart continues its chat.</p>
            <button class="btn" data-testid="manager-restart" onMouseDown={keepFocus} onClick={restart}>
              <ResumeIcon />
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

        <button
          class="panel-hide"
          data-testid="manager-hide"
          ref={hideButton}
          title="Hide manager"
          aria-label="Hide manager"
          onClick={hide}
        >
          <Chevron points="left" />
        </button>
        {/* Last in the column, so macOS carves it out of the title bar's drag region. */}
        <ResizeEdge
          width={props.width}
          onDrag={props.onDrag}
          onDone={props.onDone}
          grows="right"
          label="Manager width"
          testId="manager-resize"
          min={MANAGER_WIDTH.min}
          max={props.maxWidth}
        />
      </aside>

      {/* After the column, which its styles follow. It carries the manager's state, so a manager put
          away that needs the owner shows from there. */}
      <button
        class="panel-show"
        data-testid="manager-show"
        ref={showButton}
        title="Show manager"
        aria-label={state() ? `Show manager, ${state()!.text}` : 'Show manager'}
        onClick={show}
      >
        <Show when={state()}>{(s) => <StatusGlyph glyph={s().glyph} label={s().text} />}</Show>
        <Chevron points="right" />
      </button>
    </>
  );
}

import { createMemo, createSignal, Show } from 'solid-js';
import type { RendererConfig } from '../../../shared/types';
import StatusGlyph from '../board/StatusGlyph';
import { errorMessage } from '../bridgeError';
import PanelStrip, { createFoldHandOff, FoldButton } from '../panel/PanelStrip';
import { stripShows, type PanelState } from '../panel/panelPrefs';
import PinIcon from '../panel/PinIcon';
import ResizeEdge from '../panel/ResizeEdge';
import ResumeIcon from '../panel/ResumeIcon';
import { useProject } from '../projects/projectContext';
import TerminalView from '../terminal/TerminalView';
import { MANAGER_WIDTH } from './managerPrefs';
import { managerOf, managerStateOf, restartManager } from './managerStore';

// Restart and the pin don't take the focus on click: Restart puts the cursor in the new terminal
// itself, and typing stays where it was after a pin.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * The manager's column, at its project pane's left: its header over its terminal, which is on screen
 * while the pane is and the column is open. Pinned, it sits beside the board; unpinned, it floats over
 * the board's left edge beside its strip, as the session panel does on the right. Folded, pinned or not,
 * it slides away and leaves its strip at the pane's edge. The terminal never takes the focus by itself;
 * a click puts the cursor there.
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
  /** Folded or off, it stays mounted, so its terminal keeps its output and its size. */
  state: PanelState;
  onOpenChange(open: boolean): void;
}) {
  const project = useProject();
  const status = createMemo(() => managerStateOf(project.dir));
  const [restartError, setRestartError] = createSignal<string | null>(null);
  const restart = () => {
    setRestartError(null);
    restartManager(project.dir).catch((err: unknown) => setRestartError(errorMessage(err)));
  };
  const togglePin = () => {
    props.onPinnedChange(!props.pinned);
    props.onOpenChange(true);
  };
  const handOff = createFoldHandOff((open) => props.onOpenChange(open));

  return (
    <>
      {/* Before the column: laid out at the pane's left edge, or right of the pinned Todo panel. */}
      <Show when={stripShows(props.state, props.pinned)}>
        <PanelStrip
          class="manager-strip"
          name="Manager"
          label="Show manager"
          status={status()?.text}
          side="left"
          mark={<Show when={status()}>{(s) => <StatusGlyph glyph={s().glyph} label={s().text} />}</Show>}
          testId="manager-strip"
          handOff={handOff}
        />
      </Show>

      <aside
        class="manager-column"
        data-testid="manager-column"
        aria-label="Manager"
        data-pinned={String(props.pinned)}
        data-open={String(props.state === 'open')}
        data-state={props.state}
        style={{ width: `${props.width}px` }}
      >
        <FoldButton label="Fold the manager" points="left" testId="manager-fold" handOff={handOff} />
        <button
          class="panel-pin"
          data-testid="manager-pin"
          aria-pressed={props.pinned ? 'true' : 'false'}
          aria-label="Pin manager"
          title={props.pinned ? 'Unpin manager' : 'Pin manager'}
          onMouseDown={keepFocus}
          onClick={togglePin}
        >
          <PinIcon />
        </button>
        <header>
          <div class="manager-title-bar" data-testid="manager-title-bar">
            <Show when={status()}>{(s) => <StatusGlyph glyph={s().glyph} label={s().text} size="md" />}</Show>
            <h2 class="p-title" data-testid="manager-title">
              Manager
            </h2>
          </div>
          <div class="p-branch-bar">
            <span class="p-project">
              <i aria-hidden="true" />
              <span>{project.name}</span>
            </span>
            <Show when={status()}>
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
                  <TerminalView sessionId={sessionId} selected={project.shown() && props.state === 'open'} takeFocus={false} config={c()} />
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
    </>
  );
}

import { createSignal, Show, type JSX } from 'solid-js';
import { useProject } from '../projects/projectContext';
import Chevron from './Chevron';
import { clampWidth, type PanelPrefs } from './panelPrefs';
import PinIcon from './PinIcon';
import ResizeEdge from './ResizeEdge';

// The pin doesn't take focus on click, so typing stays in the terminal.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * The panel on its project pane's right, its full height. Pinned, it sits beside the board; unpinned, it
 * floats over the board's right edge and slides away while it isn't open. It hides by moving and
 * then turning invisible, never by changing size, so the terminals in it keep their size.
 */
export default function SidePanel(props: {
  /** What the panel holds, for screen readers. */
  label: string;
  prefs: PanelPrefs;
  /** The owner set a width or the pin: keep it. */
  onPrefsChange: (prefs: PanelPrefs) => void;
  /** Whether the pane has room to pin it beside the board; without, the pin is off and can't be set. */
  canPin: boolean;
  /** The width of the column on the board's other side, which the panel leaves the pane to. */
  besideWidth: number;
  /** Whether the unpinned panel is out. The pinned one always is. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Above the chevron of the way back while the unpinned panel is hidden: the shown item's state. */
  badge?: JSX.Element;
  /** The badge in words, for the way back's name. */
  badgeLabel?: string;
  /** Shown in place of the content while there is nothing to show. */
  empty?: JSX.Element;
  children: JSX.Element;
}) {
  let hideButton!: HTMLButtonElement;
  let showButton!: HTMLButtonElement;

  const project = useProject();
  /** The width while the edge is dragged; kept once the pointer lets go. */
  const [dragWidth, setDragWidth] = createSignal<number | null>(null);
  // A pane resize, or the column beside it, re-clamps the width shown, and keeps the one the owner set.
  const clamp = (w: number) => clampWidth(w, project.width() - props.besideWidth, props.prefs.pinned);
  const width = () => clamp(dragWidth() ?? props.prefs.width);
  const shown = () => props.prefs.pinned || props.open;
  const keepWidth = (w: number) => props.onPrefsChange({ ...props.prefs, width: clamp(w) });
  // The drag is over before the width is kept, so a save that fails can't leave it running.
  const dragDone = (w: number) => {
    setDragWidth(null);
    keepWidth(w);
  };

  const togglePin = () => {
    props.onPrefsChange({ ...props.prefs, pinned: !props.prefs.pinned });
    props.onOpenChange(true);
  };

  // Each hands the focus to the other, so the keyboard never ends up in a hidden panel. The way
  // back turns visible at once and only fades in, so it can take the focus straight away.
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
        class="side-panel"
        data-testid="side-panel"
        data-pinned={String(props.prefs.pinned)}
        data-open={String(shown())}
        aria-label={props.label}
        style={{ '--panel-w': `${width()}px` }}
      >
        <ResizeEdge
          width={width()}
          onDrag={setDragWidth}
          onDone={dragDone}
          grows="left"
          label="Panel width"
          testId="panel-resize"
          min={clamp(0)}
          max={clamp(Infinity)}
        />
        <button
          class="panel-hide"
          data-testid="panel-hide"
          ref={hideButton}
          title="Hide panel"
          aria-label="Hide panel"
          onClick={hide}
        >
          <Chevron points="right" />
        </button>
        <button
          class="panel-pin"
          data-testid="panel-pin"
          aria-pressed={props.prefs.pinned ? 'true' : 'false'}
          aria-label="Pin panel"
          title={!props.canPin ? 'No room to pin the panel beside the board' : props.prefs.pinned ? 'Unpin panel' : 'Pin panel'}
          disabled={!props.canPin}
          onMouseDown={keepFocus}
          onClick={togglePin}
        >
          <PinIcon />
        </button>
        {props.children}
        <Show when={props.empty}>
          {(empty) => (
            <div class="panel-empty">
              <p>{empty()}</p>
            </div>
          )}
        </Show>
      </aside>

      {/* After the panel, which its styles follow. */}
      <button
        class="panel-show"
        data-testid="panel-show"
        ref={showButton}
        title="Show panel"
        aria-label={props.badgeLabel ? `Show panel, ${props.badgeLabel}` : 'Show panel'}
        onClick={show}
      >
        {props.badge}
        <Chevron points="left" />
      </button>
    </>
  );
}

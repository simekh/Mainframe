import { createSignal, Show, type JSX } from 'solid-js';
import { useProject } from '../projects/projectContext';
import { clampWidth, stripShows, type PanelPrefs, type PanelState } from './panelPrefs';
import PanelStrip, { createFoldHandOff, FoldButton } from './PanelStrip';
import PinIcon from './PinIcon';
import ResizeEdge from './ResizeEdge';

// The pin doesn't take focus on click, so typing stays in the terminal.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * The panel on its project pane's right, its full height. Pinned, it sits beside the board; unpinned, it
 * floats over the board's right edge beside its strip. Folded, pinned or not, it slides away and leaves its
 * strip at the pane's edge. It folds by moving and then turning invisible, never by changing size, so the
 * terminals in it keep their size.
 */
export default function SidePanel(props: {
  /** What the panel holds, for screen readers. */
  label: string;
  prefs: PanelPrefs;
  /** The owner set a width or the pin: keep it. */
  onPrefsChange: (prefs: PanelPrefs) => void;
  /** Whether the pane has room to pin it beside the board; without, the pin is off and can't be set. */
  canPin: boolean;
  /** What the pane's other islands take beside the board. */
  besideWidth: number;
  /** Open or folded, pinned or not; folded, its strip is all that shows. */
  state: PanelState;
  onOpenChange: (open: boolean) => void;
  /** The strip's name: what the panel shows. */
  stripName: string;
  /** The strip's mark: the shown item's state. */
  badge?: JSX.Element;
  /** The badge in words, for the strip's name. */
  badgeLabel?: string;
  /** Shown in place of the content while there is nothing to show. */
  empty?: JSX.Element;
  children: JSX.Element;
}) {
  const project = useProject();
  /** The width while the edge is dragged; kept once the pointer lets go. */
  const [dragWidth, setDragWidth] = createSignal<number | null>(null);
  // A pane resize, or the column beside it, re-clamps the width shown, and keeps the one the owner set.
  const clamp = (w: number) => clampWidth(w, project.width() - props.besideWidth, props.prefs.pinned);
  const width = () => clamp(dragWidth() ?? props.prefs.width);
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
  const handOff = createFoldHandOff((open) => props.onOpenChange(open));

  return (
    <>
      <aside
        class="side-panel"
        data-testid="side-panel"
        data-pinned={String(props.prefs.pinned)}
        data-open={String(props.state === 'open')}
        aria-label={props.label}
        // Not laid out until its pane is measured: before, the pin as shown, and so whether it is open, isn't known,
        // and a style computed then would slide it in or out as the pane mounts.
        style={{ '--panel-w': `${width()}px`, display: project.width() ? undefined : 'none' }}
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
        <FoldButton label="Fold the session panel" points="right" testId="panel-fold" handOff={handOff} />
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

      {/* After the panel: laid out at the pane's right edge. */}
      <Show when={stripShows(props.state, props.prefs.pinned)}>
        <PanelStrip
          name={props.stripName}
          label={`Show ${props.stripName}`}
          status={props.badgeLabel}
          side="right"
          mark={props.badge}
          testId="panel-strip"
          handOff={handOff}
        />
      </Show>
    </>
  );
}

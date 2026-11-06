import { createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { clampWidth, type PanelPrefs } from './panelPrefs';

/** How far one arrow key moves the panel's edge. */
const KEY_STEP = 16;

// The pin doesn't take focus on click, so typing stays in the terminal.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * The panel on the window's right, its full height. Pinned, it sits beside the board; unpinned, it
 * floats over the board's right edge and slides away while it isn't open. It hides by moving and
 * then turning invisible, never by changing size, so the terminals in it keep their size.
 */
export default function SidePanel(props: {
  /** What the panel holds, for screen readers. */
  label: string;
  prefs: PanelPrefs;
  /** The owner set a width or the pin: keep it. */
  onPrefsChange: (prefs: PanelPrefs) => void;
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

  // A window resize re-clamps the width shown, and keeps the one the owner set.
  const [windowWidth, setWindowWidth] = createSignal(window.innerWidth);
  const onWindowResize = () => setWindowWidth(window.innerWidth);
  window.addEventListener('resize', onWindowResize);
  onCleanup(() => window.removeEventListener('resize', onWindowResize));

  /** The width while the edge is dragged; kept once the pointer lets go. */
  const [dragWidth, setDragWidth] = createSignal<number | null>(null);
  const clamp = (w: number) => clampWidth(w, windowWidth(), props.prefs.pinned);
  const width = () => clamp(dragWidth() ?? props.prefs.width);
  const shown = () => props.prefs.pinned || props.open;
  const keepWidth = (w: number) => props.onPrefsChange({ ...props.prefs, width: clamp(w) });

  // Captured, so the drag goes on when the pointer leaves the edge or the window.
  const startDrag = (e: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const from = { x: e.clientX, width: width() };
    handle.setPointerCapture(e.pointerId);
    setDragWidth(from.width);
    const move = (ev: PointerEvent) => setDragWidth(from.width + from.x - ev.clientX);
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('lostpointercapture', end);
      // The drag is over before the width is kept, so a save that fails can't leave it running.
      const w = width();
      setDragWidth(null);
      keepWidth(w);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('lostpointercapture', end);
  };

  // The edge faces the board: left widens the panel.
  const onResizeKey = (e: KeyboardEvent) => {
    const step = { ArrowLeft: KEY_STEP, ArrowRight: -KEY_STEP }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    keepWidth(width() + step);
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
        <div
          class="panel-resize"
          data-testid="panel-resize"
          data-dragging={String(dragWidth() !== null)}
          role="separator"
          aria-orientation="vertical"
          aria-label="Panel width"
          aria-valuemin={clamp(0)}
          aria-valuemax={clamp(Infinity)}
          aria-valuenow={width()}
          tabindex="0"
          onPointerDown={startDrag}
          onKeyDown={onResizeKey}
        />
        <button
          class="panel-hide"
          data-testid="panel-hide"
          ref={hideButton}
          title="Hide panel"
          aria-label="Hide panel"
          onClick={hide}
        >
          <svg
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M3.5 2 6.5 5l-3 3" />
          </svg>
        </button>
        <button
          class="panel-pin"
          data-testid="panel-pin"
          aria-pressed={props.prefs.pinned ? 'true' : 'false'}
          aria-label="Pin panel"
          title={props.prefs.pinned ? 'Unpin panel' : 'Pin panel'}
          onMouseDown={keepFocus}
          onClick={togglePin}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linejoin="round"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M6 2.5h4l-.5 4 2 2v1.5h-7V8.5l2-2-.5-4Z" />
            <path d="M8 10v3.5" />
          </svg>
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
        <svg
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M6.5 2 3.5 5l3 3" />
        </svg>
      </button>
    </>
  );
}

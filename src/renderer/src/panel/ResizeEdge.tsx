import { createSignal } from 'solid-js';

/** How far one arrow key moves the edge. */
const KEY_STEP = 16;

/**
 * The edge of a column that faces the board: a drag or the arrow keys set its width. `onDrag` gives
 * each width the pointer reaches; `onDone` the one to keep, as the drag ends or a key moves the edge.
 */
export default function ResizeEdge(props: {
  width: number;
  onDrag(w: number): void;
  onDone(w: number): void;
  /** The way the column grows as the edge moves: the edge sits on that side of it. */
  grows: 'left' | 'right';
  label: string;
  testId: string;
  min: number;
  max: number;
}) {
  const [dragging, setDragging] = createSignal(false);
  const sign = () => (props.grows === 'right' ? 1 : -1);

  // Captured, so the drag goes on when the pointer leaves the edge or the window.
  const startDrag = (e: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const from = { x: e.clientX, width: props.width };
    handle.setPointerCapture(e.pointerId);
    setDragging(true);
    const move = (ev: PointerEvent) => props.onDrag(from.width + sign() * (ev.clientX - from.x));
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('lostpointercapture', end);
      setDragging(false);
      props.onDone(props.width);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('lostpointercapture', end);
  };

  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    props.onDone(props.width + sign() * step);
  };

  return (
    <div
      class="resize-edge"
      data-testid={props.testId}
      data-grows={props.grows}
      data-dragging={String(dragging())}
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={props.width}
      tabindex="0"
      onPointerDown={startDrag}
      onKeyDown={onKey}
    />
  );
}

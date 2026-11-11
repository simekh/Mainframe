import type { JSX } from 'solid-js';

/** The fold button's arrow, pointing the way its panel folds, and the strip's, toward the board, the way it opens. */
function Chevron(props: { points: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 10 10"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      stroke-width="1.1"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={props.points === 'right' ? 'M3.5 2 6.5 5l-3 3' : 'M6.5 2 3.5 5l3 3'} />
    </svg>
  );
}

/**
 * A folded panel, in its place at its pane's edge: an island the full height, all of it one button that opens the
 * panel, or folds it while it floats out beside it, as the fold button does. Top to bottom, a chevron toward the board,
 * the mark (the panel's state) and its name, written along it.
 */
export default function PanelStrip(props: {
  name: string;
  /** What it opens, for screen readers. */
  label: string;
  /** The panel's state in words, after the label. */
  status?: string;
  /** The pane's edge it sits on. */
  side: 'left' | 'right';
  mark?: JSX.Element;
  testId: string;
  class?: string;
  handOff: FoldHandOff;
}) {
  // Out, it says what the fold button says.
  const label = () =>
    props.handOff.isOpen() ? props.handOff.foldLabel : props.status ? `${props.label}, ${props.status}` : props.label;
  return (
    <button
      class={`panel-strip ${props.class ?? ''}`}
      data-testid={props.testId}
      data-side={props.side}
      ref={props.handOff.stripRef}
      aria-label={label()}
      title={label()}
      onClick={props.handOff.toggle}
    >
      <Chevron points={props.side === 'left' ? 'right' : 'left'} />
      {props.mark}
      <span class="panel-strip-name">{props.name}</span>
    </button>
  );
}

/** In a panel's header, left of its pin: folds the panel into its strip. Its chevron points the way the panel goes. */
export function FoldButton(props: { points: 'left' | 'right'; testId: string; handOff: FoldHandOff }) {
  return (
    <button
      class="panel-fold"
      data-testid={props.testId}
      ref={props.handOff.foldRef}
      aria-label={props.handOff.foldLabel}
      title={props.handOff.foldLabel}
      onClick={props.handOff.fold}
    >
      <Chevron points={props.points} />
    </button>
  );
}

type FoldHandOff = ReturnType<typeof createFoldHandOff>;

/**
 * Hands the focus between a panel's fold button and its strip, so the keyboard never ends up in a folded panel:
 * folding, from either, focuses the strip, and opening from the strip focuses the fold button. Each turns visible as
 * the panel's state changes, so it can take the focus straight away. `foldLabel` names the fold button, and the strip
 * while the panel is out beside it.
 */
export function createFoldHandOff(foldLabel: string, isOpen: () => boolean, setOpen: (open: boolean) => void) {
  let foldButton: HTMLButtonElement | undefined;
  let strip: HTMLButtonElement | undefined;
  const fold = () => {
    setOpen(false);
    strip?.focus();
  };
  return {
    foldLabel,
    isOpen,
    foldRef: (el: HTMLButtonElement) => void (foldButton = el),
    stripRef: (el: HTMLButtonElement) => void (strip = el),
    fold,
    toggle: () => {
      if (isOpen()) return fold();
      setOpen(true);
      foldButton?.focus();
    },
  };
}

/**
 * Turns a panel off from its button in the top row. With the focus in the panel or on its strip, which `holds` finds
 * in `scope`, the button takes it, so the keyboard never ends up in it, or nowhere. `scope` is the panel's own pane, so
 * another pane's panel never counts, or the window for the projects list.
 */
export function turnOffHandingFocus(scope: Node, holds: string, button: HTMLElement, turnOff: () => void): void {
  const handBack = scope.contains(document.activeElement?.closest(holds) ?? null);
  turnOff();
  if (handBack) button.focus();
}

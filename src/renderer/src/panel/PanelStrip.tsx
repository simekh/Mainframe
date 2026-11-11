import type { JSX } from 'solid-js';
import Chevron from './Chevron';

type ButtonRef = HTMLButtonElement | ((el: HTMLButtonElement) => void);

/**
 * A folded panel, in its place at its pane's edge: an island the full height, all of it one button that opens the
 * panel. Top to bottom, a chevron toward the board, the mark (the panel's state) and its name, written along it.
 */
export default function PanelStrip(props: {
  name: string;
  /** What it opens and the state, for screen readers. */
  label: string;
  /** The pane's edge it sits on. */
  side: 'left' | 'right';
  mark?: JSX.Element;
  testId: string;
  class?: string;
  ref?: ButtonRef;
  onOpen(): void;
}) {
  return (
    <button
      class={`panel-strip ${props.class ?? ''}`}
      data-testid={props.testId}
      data-side={props.side}
      ref={props.ref}
      aria-label={props.label}
      title={props.label}
      onClick={() => props.onOpen()}
    >
      <Chevron points={props.side === 'left' ? 'right' : 'left'} />
      {props.mark}
      <span class="panel-strip-name">{props.name}</span>
    </button>
  );
}

/** In a panel's header, left of its pin: folds the panel into its strip. Its chevron points the way the panel goes. */
export function FoldButton(props: { label: string; points: 'left' | 'right'; testId: string; ref?: ButtonRef; onFold(): void }) {
  return (
    <button
      class="panel-fold"
      data-testid={props.testId}
      ref={props.ref}
      aria-label={props.label}
      title={props.label}
      onClick={() => props.onFold()}
    >
      <Chevron points={props.points} />
    </button>
  );
}

/**
 * Hands the focus between a panel's fold button and its strip, so the keyboard never ends up in a folded panel:
 * folding focuses the strip, and opening from the strip focuses the fold button. Each turns visible as the panel's
 * state changes, so it can take the focus straight away.
 */
export function createFoldHandOff(setOpen: (open: boolean) => void) {
  let foldButton: HTMLButtonElement | undefined;
  let strip: HTMLButtonElement | undefined;
  return {
    foldRef: (el: HTMLButtonElement) => void (foldButton = el),
    stripRef: (el: HTMLButtonElement) => void (strip = el),
    fold: () => {
      setOpen(false);
      strip?.focus();
    },
    open: () => {
      setOpen(true);
      foldButton?.focus();
    },
  };
}

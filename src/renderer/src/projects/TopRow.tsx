import { onCleanup, onMount, Show } from 'solid-js';
import { offScreenNeedsYou, railState, toggleRail } from './projectsStore';

// The button doesn't take focus on click, so typing stays in the terminal.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * The window's part of the row along its top: on the Mac the window buttons' room, then Projects, which turns the
 * projects list on and off. Each project's part is its pane's bar, the rest of the row. This part reports where it
 * ends, measured as it mounts, before the first paint, and again as Projects grows its count, so the first pane's bar
 * starts right there.
 */
export default function TopRow(props: { onStartWidth(px: number): void }) {
  let start!: HTMLDivElement;
  let button!: HTMLButtonElement;
  onMount(() => {
    const report = () => props.onStartWidth(start.getBoundingClientRect().right);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(start);
    onCleanup(() => observer.disconnect());
  });

  const on = () => railState() !== 'off';
  // Off, it still shows what the list would: the sessions waiting in the projects off screen.
  const count = () => (on() ? 0 : offScreenNeedsYou());
  // Turned off with the focus in it, the list hands the focus to the button, so the keyboard never ends up nowhere.
  const toggle = () => {
    const handBack = on() && document.querySelector('.rail')?.contains(document.activeElement) === true;
    toggleRail();
    if (handBack) button.focus();
  };

  return (
    <div class="top-row" data-testid="top-row">
      <div class="top-start" ref={start}>
        <button
          class="tb-toggle"
          data-testid="projects-toggle"
          ref={button}
          aria-pressed={on() ? 'true' : 'false'}
          title={on() ? 'Hide the projects list' : 'Show the projects list'}
          onMouseDown={keepFocus}
          onClick={toggle}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
            <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
            <path d="M6 2.75v10.5" />
          </svg>
          <span>Projects</span>
          <Show when={count() > 0}>
            <span class="tb-count" aria-label={`${count()} need you`}>
              {count()}
            </span>
          </Show>
        </button>
      </div>
    </div>
  );
}

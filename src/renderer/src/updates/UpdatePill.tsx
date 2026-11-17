import { Show } from 'solid-js';
import { showUpdateDialog, updateView } from './updateStore';

// The button doesn't take focus on click, so typing stays in the terminal.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/** Right before the Settings cog while a newer release is known; it stays until the update is made. */
export default function UpdatePill() {
  return (
    <Show when={updateView()?.available}>
      {(available) => (
        <button
          class="tb-update"
          data-testid="update-pill"
          title={`Mainframe ${available().latest} is available`}
          // Its words hide when the bar is narrow; the name stays.
          aria-label="Update available"
          onMouseDown={keepFocus}
          onClick={() => showUpdateDialog()}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M8 13V3.5M4 7.5l4-4 4 4" />
          </svg>
          <span>Update available</span>
        </button>
      )}
    </Show>
  );
}

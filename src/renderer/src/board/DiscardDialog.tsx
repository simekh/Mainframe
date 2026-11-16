import { createSignal, For, onMount, Show } from 'solid-js';
import type { DiscardPreview } from '../../../shared/types';
import { errorMessage } from '../bridgeError';

/**
 * Mounted to show it, as a modal: what a Discard of a paused task would lose, and the owner's confirm. `preview` is null
 * until it is read, and `previewError` says why it couldn't be; Discard waits for the list. It calls `onClose` once it
 * has closed (Cancel, Esc or a Discard done).
 */
export default function DiscardDialog(props: {
  title: string;
  branch: string;
  preview: DiscardPreview | null;
  previewError: string | null;
  onDiscard: () => Promise<void>;
  onClose: () => void;
}) {
  let dialog!: HTMLDialogElement;
  const [error, setError] = createSignal<string | null>(null);
  const [discarding, setDiscarding] = createSignal(false);
  const lost = () => (props.preview ? props.preview.uncommitted.length + props.preview.unsaved.length : 0);

  onMount(() => dialog.showModal());

  async function discard(): Promise<void> {
    if (!props.preview || discarding()) return;
    setDiscarding(true);
    setError(null);
    try {
      await props.onDiscard();
      dialog.close();
    } catch (err) {
      setError(errorMessage(err));
      setDiscarding(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      class="nt-dialog discard-dialog"
      data-testid="discard-dialog"
      aria-labelledby="discard-heading"
      // A press here is not one on the board, which would fold the panels over it.
      onMouseDown={(e) => e.stopPropagation()}
      onCancel={(e) => discarding() && e.preventDefault()}
      onClose={() => props.onClose()}
    >
      <form
        class="nt"
        onSubmit={(e) => {
          e.preventDefault();
          void discard();
        }}
      >
        <h2 id="discard-heading">Discard {props.title}?</h2>
        <p class="nt-sub">
          Removes its worktree and deletes its branch <code>{props.branch}</code>, with anything not saved elsewhere.
          Its chat is kept.
        </p>
        <Show
          when={props.preview}
          fallback={
            <Show when={props.previewError} fallback={<p class="discard-safe">Checking what would be lost…</p>}>
              {(message) => (
                <p class="nt-error" role="alert">
                  {message()}
                </p>
              )}
            </Show>
          }
        >
          {(preview) => (
            <Show when={lost() > 0} fallback={<p class="discard-safe">Nothing would be lost.</p>}>
              <div class="discard-loss">
                <Show when={preview().uncommitted.length > 0}>
                  <h3>Uncommitted files</h3>
                  <ul>
                    <For each={preview().uncommitted}>{(path) => <li data-testid="discard-file">{path}</li>}</For>
                  </ul>
                </Show>
                <Show when={preview().unsaved.length > 0}>
                  <h3>Commits not pushed or merged</h3>
                  <ul>
                    <For each={preview().unsaved}>{(subject) => <li data-testid="discard-commit">{subject}</li>}</For>
                  </ul>
                </Show>
              </div>
            </Show>
          )}
        </Show>
        <Show when={error()}>
          {(message) => (
            <p class="nt-error" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <div class="nt-actions">
          <button class="btn" type="button" disabled={discarding()} onClick={() => dialog.close()}>
            Cancel
          </button>
          <button class="btn danger" type="submit" disabled={!props.preview || discarding()}>
            Discard
          </button>
        </div>
      </form>
    </dialog>
  );
}

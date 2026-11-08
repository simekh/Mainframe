import { createSignal, onMount, Show } from 'solid-js';
import { commitsThatArent } from '../../../shared/commitsThatArent';
import type { StartCheck } from '../../../shared/types';
import { errorMessage } from '../bridgeError';
import { useProject } from '../projects/projectContext';
import { startTask } from '../tasksStore';

/** Mounted to show it, as a modal; it calls `onClose` once it has closed (Cancel, Esc or a start). */
export default function NewTaskDialog(props: { onClose: () => void }) {
  const project = useProject();
  let dialog!: HTMLDialogElement;
  let titleInput!: HTMLInputElement;
  const [title, setTitle] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [noQuestions, setNoQuestions] = createSignal(false);
  const [check, setCheck] = createSignal<StartCheck | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [starting, setStarting] = createSignal(false);
  const ahead = () => {
    const c = check();
    return c && c.ahead > 0 ? c : null;
  };

  onMount(() => {
    dialog.showModal();
    titleInput.focus();
    window.mainframe.startCheck(project.dir).then(setCheck, (err: unknown) => console.error('[new task] start check failed', err));
  });

  // Esc waits for a start under way, so a failure still has the dialog to show in.
  const holdWhileStarting = (e: Event) => {
    if (starting()) e.preventDefault();
  };

  async function start(): Promise<void> {
    if (!title().trim() || starting()) return;
    setStarting(true);
    setError(null);
    try {
      await startTask(project.dir, { title: title(), description: description(), noQuestions: noQuestions() });
      dialog.close();
    } catch (err) {
      setError(errorMessage(err));
      setStarting(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      class="nt-dialog"
      aria-labelledby="nt-heading"
      onCancel={holdWhileStarting}
      onClose={() => props.onClose()}
    >
      <form
        class="nt"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <h2 id="nt-heading">New task</h2>
        <p class="nt-sub">
          Starts Claude Code in a new worktree of {project.name}
          <Show when={check()}>
            {(c) => (
              <>
                , branched from <code data-testid="new-task-base">{c().base}</code>
              </>
            )}
          </Show>
          .
        </p>
        <div class="field">
          <label for="nt-title">Title</label>
          <input
            ref={titleInput}
            id="nt-title"
            type="text"
            autocomplete="off"
            data-testid="new-task-title"
            value={title()}
            onInput={(e) => setTitle(e.currentTarget.value)}
          />
        </div>
        <div class="field">
          <label for="nt-desc">
            Description <span class="opt">(optional)</span>
          </label>
          <textarea
            id="nt-desc"
            placeholder="What should change, and anything the session should know first."
            data-testid="new-task-description"
            value={description()}
            onInput={(e) => setDescription(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.metaKey) {
                e.preventDefault();
                void start();
              }
            }}
          />
        </div>
        <div class="check">
          <input
            id="nt-noq"
            type="checkbox"
            aria-describedby="nt-noq-hint"
            data-testid="new-task-no-questions"
            checked={noQuestions()}
            onChange={(e) => setNoQuestions(e.currentTarget.checked)}
          />
          <label for="nt-noq">Don't ask me questions</label>
          <span id="nt-noq-hint" class="hint">
            The session skips clarifying questions, and when the work is done and reviewed it merges without the merge
            menu.
          </span>
        </div>
        <Show when={ahead()}>
          {(c) => (
            <div class="nt-warn" data-testid="start-check-warning">
              <strong>
                <code>{c().branch}</code> has {commitsThatArent(c().ahead)} on <code>{c().base}</code>.
              </strong>{' '}
              New worktrees start from <code>{c().base}</code>, so this task won't have {c().ahead === 1 ? 'it' : 'them'}.
              Push{' '}
              <code>{c().branch}</code> first, or start anyway.
            </div>
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
          <span class="nt-shortcut">Cmd+Enter starts it</span>
          <button class="btn" type="button" disabled={starting()} onClick={() => dialog.close()}>
            Cancel
          </button>
          <button class="btn primary" type="submit" data-testid="new-task-start" disabled={!title().trim() || starting()}>
            {ahead() ? 'Start anyway' : 'Start'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

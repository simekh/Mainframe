import { createSignal, For, onMount, Show } from 'solid-js';
import { AGENT_NAMES, MIN_OPENCODE_VERSION, type AgentName, type ProgramCheck, type StartCheck } from '../../../shared/types';
import { errorMessage } from '../bridgeError';
import { commandHeld, commandName } from '../keys';
import { useProject } from '../projects/projectContext';
import { startTask } from '../tasksStore';
import { loadAgent, saveAgent } from './agentPrefs';
import StartCheckWarning, { aheadOf } from './StartCheckWarning';

/** Why OpenCode can't be offered, when it is installed but unusable. */
function agentHint(check: ProgramCheck | null): string | undefined {
  if (check?.state === 'too-old') return `OpenCode ${check.version} is installed. Mainframe needs ${MIN_OPENCODE_VERSION} or later.`;
  if (check?.state === 'broken') return `The opencode at ${check.path} didn't say its version, so Mainframe can't use it.`;
  return undefined;
}

/** Mounted to show it, as a modal; it calls `onClose` once it has closed (Cancel, Esc or a start). */
export default function NewTaskDialog(props: { onClose: () => void }) {
  const project = useProject();
  const platform = window.mainframe.platform;
  let dialog!: HTMLDialogElement;
  let titleInput!: HTMLInputElement;
  const [title, setTitle] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [noQuestions, setNoQuestions] = createSignal(false);
  const [check, setCheck] = createSignal<StartCheck | null>(null);
  const [opencode, setOpencode] = createSignal<ProgramCheck | null>(null);
  const [agent, setAgent] = createSignal<AgentName>('claude');
  const [error, setError] = createSignal<string | null>(null);
  const [starting, setStarting] = createSignal(false);
  const ahead = () => aheadOf(check());

  onMount(() => {
    dialog.showModal();
    titleInput.focus();
    window.mainframe.startCheck(project.dir).then(setCheck, (err: unknown) => console.error('[new task] start check failed', err));
    window.mainframe.agentChecks().then(
      ({ opencode }) => {
        setOpencode(opencode);
        setAgent(loadAgent(localStorage, project.dir, opencode.state === 'found'));
      },
      (err: unknown) => console.error('[new task] agent check failed', err),
    );
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
      await startTask(project.dir, { title: title(), description: description(), noQuestions: noQuestions(), agent: agent() });
      if (opencode()?.state === 'found') saveAgent(localStorage, project.dir, agent());
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
          Starts {AGENT_NAMES[agent()]} in a new worktree of {project.name}
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
              if (e.key === 'Enter' && commandHeld(e, platform)) {
                e.preventDefault();
                void start();
              }
            }}
          />
        </div>
        <Show when={opencode()?.state === 'found'}>
          <div class="field">
            <span id="nt-agent" class="field-label">
              Agent
            </span>
            <div class="nt-agents" role="radiogroup" aria-labelledby="nt-agent">
              <For each={Object.keys(AGENT_NAMES) as AgentName[]}>
                {(name) => (
                  <label class="nt-agent">
                    <input
                      type="radio"
                      name="nt-agent"
                      data-testid={`new-task-agent-${name}`}
                      checked={agent() === name}
                      onChange={() => setAgent(name)}
                    />
                    {AGENT_NAMES[name]}
                  </label>
                )}
              </For>
            </div>
          </div>
        </Show>
        <Show when={agentHint(opencode())}>
          {(hint) => (
            <p class="nt-hint" data-testid="new-task-agent-hint">
              {hint()}
            </p>
          )}
        </Show>
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
        <Show when={ahead()}>{(c) => <StartCheckWarning check={c()} testId="start-check-warning" />}</Show>
        <Show when={error()}>
          {(message) => (
            <p class="nt-error" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <div class="nt-actions">
          <span class="nt-shortcut" data-testid="new-task-shortcut">{commandName(platform)}+Enter starts it</span>
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

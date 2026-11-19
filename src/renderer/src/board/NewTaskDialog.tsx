import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { AGENT_NAMES, type AgentName, type StartCheck } from '../../../shared/types';
import { errorMessage } from '../bridgeError';
import { commandHeld, commandName } from '../keys';
import { useProject } from '../projects/projectContext';
import { loadSettings, settingsView } from '../settings/settingsStore';
import { startTask } from '../tasksStore';
import { effortsFor, keptEffort, SWITCH_HELP } from './modelPick';
import { newTaskAgents } from './newTaskAgents';
import StartCheckWarning, { aheadOf } from './StartCheckWarning';

const CODEX_CLAUDE_MD_LINE = 'project_doc_fallback_filenames = ["CLAUDE.md"]';

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
  // Each box starts on the default agent; a pick lasts for this box only.
  const agents = createMemo(() => {
    const view = settingsView();
    return view && newTaskAgents(view);
  });
  const [picked, setPicked] = createSignal<AgentName | undefined>();
  const agent = () => picked() ?? agents()?.start;
  const [error, setError] = createSignal<string | null>(null);
  const [starting, setStarting] = createSignal(false);
  const ahead = () => aheadOf(check());
  // Asked afresh each time the box turns to Codex; a failed check shows no note.
  const [codexNote] = createResource(
    () => agent() === 'codex',
    () =>
      window.mainframe.codexClaudeMdNote(project.dir).catch((err: unknown) => {
        console.error('[new task] codex note failed', err);
        return null;
      }),
  );
  // Asked afresh for each agent; a failed list is logged and leaves Default only.
  const [choices] = createResource(agent, (name) =>
    window.mainframe.taskModelChoices(name).catch((err: unknown) => {
      console.error('[new task] model list failed', err);
      return { models: [], defaultEfforts: [] };
    }),
  );
  // Read only once the list for the agent on screen is in, so nothing is offered or sent from the last agent's list.
  const ready = () => (choices.state === 'ready' ? choices() : undefined);
  // Back to Default when the agent changes: the last agent's picks mean nothing to this one. A model counts only while
  // the agent on screen lists it, however the agent changed.
  const [modelPicked, setModelPicked] = createSignal<string>();
  const model = () => {
    const id = modelPicked();
    return ready()?.models.some((m) => m.id === id) ? id : undefined;
  };
  const [effortPicked, setEffortPicked] = createSignal<string>();
  const efforts = () => effortsFor(ready(), model());
  const effort = () => keptEffort(efforts(), effortPicked());
  function pickAgent(name: AgentName): void {
    setPicked(name);
    setModelPicked(undefined);
    setEffortPicked(undefined);
  }
  function pickModel(id: string | undefined): void {
    setModelPicked(id);
    setEffortPicked(keptEffort(effortsFor(ready(), id), effortPicked()));
  }
  const [copied, setCopied] = createSignal(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(copiedTimer));
  function copyCodexLine(): void {
    window.mainframe.copyText(CODEX_CLAUDE_MD_LINE);
    setCopied(true);
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => setCopied(false), 1500);
  }

  onMount(() => {
    dialog.showModal();
    titleInput.focus();
    window.mainframe.startCheck(project.dir).then(setCheck, (err: unknown) => console.error('[new task] start check failed', err));
    if (!settingsView()) void loadSettings();
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
      await startTask(project.dir, { title: title(), description: description(), noQuestions: noQuestions(), agent: agent(), model: model(), effort: effort() });
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
          Starts {agent() ? AGENT_NAMES[agent()!] : 'a session'} in a new worktree of {project.name}
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
        <Show when={(agents()?.options.length ?? 0) > 1}>
          <div class="field">
            <span id="nt-agent" class="field-label">
              Agent
            </span>
            <div class="nt-agents" role="radiogroup" aria-labelledby="nt-agent">
              <For each={agents()?.options}>
                {(name) => (
                  <label class="nt-agent">
                    <input
                      type="radio"
                      name="nt-agent"
                      data-testid={`new-task-agent-${name}`}
                      checked={agent() === name}
                      onChange={() => pickAgent(name)}
                    />
                    {AGENT_NAMES[name]}
                  </label>
                )}
              </For>
            </div>
          </div>
        </Show>
        <For each={agents()?.hints}>
          {(hint) => (
            <p class="nt-hint" data-testid="new-task-agent-hint">
              {hint}
            </p>
          )}
        </For>
        <Show when={agent()}>
          {(name) => (
            <div class="nt-model">
              <div class="nt-model-picks">
                <div class="field">
                  <label for="nt-model">Model</label>
                  <select
                    id="nt-model"
                    class="nt-select"
                    data-testid="new-task-model"
                    onChange={(e) => pickModel(e.currentTarget.value || undefined)}
                  >
                    <option value="" selected={model() === undefined}>
                      Default
                    </option>
                    <For each={ready()?.models}>
                      {(m) => (
                        <option value={m.id} selected={model() === m.id}>
                          {m.name}
                        </option>
                      )}
                    </For>
                  </select>
                </div>
                <Show when={efforts().length > 0}>
                  <div class="field">
                    <label for="nt-effort">Effort</label>
                    <select
                      id="nt-effort"
                      class="nt-select"
                      data-testid="new-task-effort"
                      onChange={(e) => setEffortPicked(e.currentTarget.value || undefined)}
                    >
                      <option value="" selected={effort() === undefined}>
                        Default
                      </option>
                      <For each={efforts()}>
                        {(level) => (
                          <option value={level} selected={effort() === level}>
                            {level}
                          </option>
                        )}
                      </For>
                    </select>
                  </div>
                </Show>
              </div>
              <p class="nt-hint" data-testid="new-task-model-help">
                {SWITCH_HELP[name()]}
              </p>
            </div>
          )}
        </Show>
        <Show when={agent() === 'codex' && !codexNote.loading && codexNote()}>
          {(note) => (
            <div class="nt-codex-note" data-testid="new-task-codex-note">
              <p class="nt-hint">
                Codex won't read this project's CLAUDE.md. Add this line at the top of <code>{note()}</code> (or, if the
                file already has <code>project_doc_fallback_filenames</code>, add <code>"CLAUDE.md"</code> to that list),
                then start the task:
              </p>
              <div class="nt-codex-line">
                <code>{CODEX_CLAUDE_MD_LINE}</code>
                <button class="btn" type="button" data-testid="new-task-codex-note-copy" onClick={copyCodexLine}>
                  {copied() ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
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

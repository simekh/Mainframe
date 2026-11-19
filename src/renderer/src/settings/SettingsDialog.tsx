import { createEffect, createResource, createSignal, For, Index, on, Show } from 'solid-js';
import {
  AGENT_NAMES,
  AGENT_ORDER,
  type AgentName,
  type SettingsView,
  type SyncModel,
  TERMINAL_TEXT_LIMITS,
  type TerminalText,
} from '../../../shared/types';
import { errorMessage } from '../bridgeError';
import { checkLine } from '../setup/setupCopy';
import { checkNow, updateView, versionOf } from '../updates/updateStore';
import { defaultChoice, works } from './defaultChoice';
import { closeSettings, settingsOpen, settingsView } from './settingsStore';

const price = (m: SyncModel) => (m.price ? `$${m.price.input} / $${m.price.output}` : 'price unknown');

/** A row per agent: its tick, what was found of it, and Find… unless its env var names it. */
function AgentRow(props: { name: AgentName; view: SettingsView; act: (run: () => Promise<void>) => void }) {
  const agent = () => props.view.agents[props.name];
  const isDefault = () => props.view.defaultAgent === props.name;
  const check = () => agent().check;
  return (
    <div class="settings-row settings-agent" data-works={String(works(props.view, props.name))}>
      <label class="settings-agent-name">
        <input
          type="checkbox"
          data-testid={`settings-tick-${props.name}`}
          checked={agent().ticked}
          disabled={isDefault() || (!agent().ticked && !works(props.view, props.name))}
          title={isDefault() ? 'Make another agent the default first' : undefined}
          onChange={(e) => {
            const box = e.currentTarget;
            const ticked = box.checked;
            // The view main sends sets the box; until then, and after a refusal, it shows what is saved.
            box.checked = agent().ticked;
            props.act(() => window.mainframe.setAgentTicked(props.name, ticked));
          }}
        />
        {AGENT_NAMES[props.name]}
      </label>
      <Show
        when={check().state === 'found' ? check() : undefined}
        fallback={<span class="settings-why">{checkLine(props.name, check(), true)}</span>}
      >
        {(found) => <span class="settings-version">v{found().version}</span>}
      </Show>
      <Show when={check().path}>
        {(path) => (
          <span class="settings-path" title={path()}>
            <span>{path()}</span>
          </span>
        )}
      </Show>
      <Show when={!agent().fromEnv}>
        <button
          class="btn settings-find"
          type="button"
          data-testid={`settings-find-${props.name}`}
          onClick={() => props.act(() => window.mainframe.settingsFindAgent(props.name))}
        >
          Find…
        </button>
      </Show>
    </div>
  );
}

/** OpenCode's manager's agent and sync model, from its own lists, asked for each time the section shows. */
function OpencodeSection(props: { view: SettingsView }) {
  const [choices] = createResource(() => window.mainframe.opencodeChoices());
  const [error, setError] = createSignal<string | null>(null);
  const setting = () => props.view.agents.opencode;
  const save = (patch: { managerAgent?: string | null; syncModel?: string }) => {
    setError(null);
    window.mainframe.setAgentOptions('opencode', patch).catch((err: unknown) => setError(errorMessage(err)));
  };
  const savedModelGone = () => {
    const id = setting().syncModel;
    return id !== undefined && !choices()?.models.some((m) => m.id === id) ? id : undefined;
  };

  return (
    <section class="settings-section" aria-labelledby="settings-opencode">
      <h3 id="settings-opencode" class="settings-title">
        OpenCode
      </h3>
      <Show
        when={choices.state === 'ready' ? choices() : undefined}
        fallback={
          <p class={choices.error ? 'settings-error' : 'settings-quiet'} role={choices.error ? 'alert' : undefined}>
            {choices.error ? errorMessage(choices.error) : 'Looking…'}
          </p>
        }
      >
        {(lists) => (
          <>
            <div class="settings-row">
              <label class="settings-key" for="settings-manager-agent">
                Manager's agent
              </label>
              <select
                id="settings-manager-agent"
                class="settings-select"
                data-testid="settings-manager-agent"
                onChange={(e) => save({ managerAgent: e.currentTarget.value || null })}
              >
                <option value="" selected={setting().managerAgent === undefined}>
                  Your default ({lists().agents.find((a) => a.isDefault)?.id ?? 'none'})
                </option>
                <For each={lists().agents}>
                  {(a) => (
                    <option value={a.id} selected={setting().managerAgent === a.id}>
                      {a.id}
                    </option>
                  )}
                </For>
              </select>
            </div>
            <p class="settings-hint" data-testid="settings-manager-agent-hint">
              A new manager chat starts on this agent. A chat that carries on keeps its agent until you switch it in the
              manager's terminal.
            </p>
            <div class="settings-row">
              <label class="settings-key" for="settings-sync-model">
                Todo sync model
              </label>
              <Show when={setting().syncModel} fallback={<span class="settings-quiet">None yet</span>}>
                <select
                  id="settings-sync-model"
                  class="settings-select"
                  data-testid="settings-sync-model"
                  onChange={(e) => save({ syncModel: e.currentTarget.value })}
                >
                  <Show when={savedModelGone()}>{(id) => (
                      <option value={id()} selected>
                        {id()} (gone from OpenCode)
                      </option>
                    )}</Show>
                  <For each={lists().models}>
                    {(m) => (
                      <option value={m.id} selected={setting().syncModel === m.id}>
                        {m.name}, {m.id} ({price(m)})
                      </option>
                    )}
                  </For>
                </select>
              </Show>
            </div>
          </>
        )}
      </Show>
      <p class="settings-hint">Cheapest first, with the price per million tokens in and out. Asked the first time a sync runs.</p>
      <Show when={error()}>
        {(message) => (
          <p class="settings-error" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </section>
  );
}

/**
 * − value +, a step at a time within its limits. A step shows at once and the next one goes on from it, also before
 * main has sent the saved value back; a step that couldn't be saved shows the saved value again.
 */
function Stepper(props: {
  id: string;
  testId: string;
  value: number;
  limits: { min: number; max: number; step: number };
  digits: number;
  unit: string;
  onStep: (next: number) => Promise<void>;
}) {
  const [pending, setPending] = createSignal<number>();
  const value = () => pending() ?? props.value;
  createEffect(on(() => props.value, (saved) => saved === pending() && setPending(undefined)));
  const go = (way: -1 | 1) => {
    const next = Number((value() + way * props.limits.step).toFixed(props.digits));
    setPending(next);
    props.onStep(next).catch(() => setPending(undefined));
  };
  return (
    <div class="settings-stepper" role="group" aria-labelledby={props.id} data-testid={props.testId}>
      <button type="button" aria-label="Smaller" disabled={value() <= props.limits.min} onClick={() => go(-1)}>
        −
      </button>
      <output aria-live="polite">
        {value().toFixed(props.digits)}
        {props.unit}
      </output>
      <button type="button" aria-label="Larger" disabled={value() >= props.limits.max} onClick={() => go(1)}>
        +
      </button>
    </div>
  );
}

/** The terminals' text size and line height, applied to every open terminal as it is saved. */
function TerminalTextSection(props: { text: TerminalText }) {
  const [error, setError] = createSignal<string | null>(null);
  const save = (patch: Partial<TerminalText>) => {
    setError(null);
    return window.mainframe.setTerminalText(patch).catch((err: unknown) => {
      setError(errorMessage(err));
      throw err;
    });
  };
  return (
    <section class="settings-section" aria-labelledby="settings-terminal-text">
      <h3 id="settings-terminal-text" class="settings-title">
        Terminal text
      </h3>
      <div class="settings-row">
        <span class="settings-key" id="settings-font-size-label">
          Size
        </span>
        <Stepper
          id="settings-font-size-label"
          testId="settings-font-size"
          value={props.text.fontSize}
          limits={TERMINAL_TEXT_LIMITS.fontSize}
          digits={0}
          unit=" px"
          onStep={(fontSize) => save({ fontSize })}
        />
      </div>
      <div class="settings-row">
        <span class="settings-key" id="settings-line-height-label">
          Line height
        </span>
        <Stepper
          id="settings-line-height-label"
          testId="settings-line-height"
          value={props.text.lineHeight}
          limits={TERMINAL_TEXT_LIMITS.lineHeight}
          digits={1}
          unit=""
          onStep={(lineHeight) => save({ lineHeight })}
        />
      </div>
      <Show when={error()}>
        {(message) => (
          <p class="settings-error" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </section>
  );
}

/** Mainframe's own version, and Check for Updates…: the way in on Windows and Linux, which have no menu bar. */
function MainframeSection() {
  const [checking, setChecking] = createSignal(false);
  const check = () => {
    setChecking(true);
    void checkNow().finally(() => setChecking(false));
  };
  return (
    <section class="settings-section" aria-labelledby="settings-mainframe">
      <h3 id="settings-mainframe" class="settings-title">
        Mainframe
      </h3>
      <div class="settings-row" data-testid="settings-version-row">
        <span class="settings-key">Version</span>{' '}
        <span class="settings-version">{updateView() ? versionOf(updateView()) : '…'}</span>
        <button class="btn settings-check" type="button" data-testid="settings-check-updates" disabled={checking()} onClick={check}>
          {checking() ? 'Checking…' : 'Check for Updates…'}
        </button>
      </div>
    </section>
  );
}

/** Settings, for the whole app: mounted once, shown over the window while `settingsOpen()`. */
export default function SettingsDialog() {
  let dialog!: HTMLDialogElement;
  const [error, setError] = createSignal<string | null>(null);
  // One change at a time; what main refuses shows in the section.
  const act = (run: () => Promise<void>) => {
    setError(null);
    run().catch((err: unknown) => setError(errorMessage(err)));
  };
  createEffect(() => {
    if (settingsOpen() && !dialog.open) {
      setError(null);
      dialog.showModal();
    }
  });

  return (
    <dialog ref={dialog} class="nt-dialog settings-dialog" data-testid="settings-dialog" aria-labelledby="settings-heading" onClose={closeSettings}>
      <div class="settings-head">
        <h2 id="settings-heading">Settings</h2>
        <button class="settings-close" type="button" data-testid="settings-close" title="Close" aria-label="Close" onClick={() => dialog.close()}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <Show when={settingsOpen() ? settingsView() : undefined}>
        {(view) => (
          <>
            <section class="settings-section" aria-labelledby="settings-agents">
              <h3 id="settings-agents" class="settings-title">
                Agents
              </h3>
              <For each={AGENT_ORDER}>{(name) => <AgentRow name={name} view={view()} act={act} />}</For>
              <Show when={defaultChoice(view()).length > 0}>
                <div class="settings-row settings-default">
                  <span class="settings-key" id="settings-default-label">
                    Default agent
                  </span>
                  <div class="settings-seg" role="radiogroup" aria-labelledby="settings-default-label">
                    {/* By position, which AGENT_ORDER keeps: each view's new objects would otherwise rebuild the buttons and drop their focus. */}
                    <Index each={defaultChoice(view())}>
                      {(choice) => (
                        <button
                          type="button"
                          role="radio"
                          data-testid={`settings-default-${choice().name}`}
                          aria-checked={view().defaultAgent === choice().name ? 'true' : 'false'}
                          disabled={!choice().works}
                          title={choice().works ? undefined : checkLine(choice().name, view().agents[choice().name].check, true)}
                          onClick={() => {
                            if (view().defaultAgent !== choice().name) act(() => window.mainframe.setDefaultAgent(choice().name));
                          }}
                        >
                          {AGENT_NAMES[choice().name]}
                        </button>
                      )}
                    </Index>
                  </div>
                </div>
                <p class="settings-hint">Runs the manager, the Todo sync and new tasks. Tasks that are already running keep their own agent.</p>
              </Show>
              <Show when={error()}>
                {(message) => (
                  <p class="settings-error" role="alert" data-testid="settings-error">
                    {message()}
                  </p>
                )}
              </Show>
            </section>
            <Show when={view().agents.opencode.ticked && works(view(), 'opencode')}>
              <OpencodeSection view={view()} />
            </Show>
            <TerminalTextSection text={view().terminalText} />
            <MainframeSection />
          </>
        )}
      </Show>
    </dialog>
  );
}

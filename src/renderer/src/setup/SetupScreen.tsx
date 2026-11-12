import { createComputed, createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { AGENT_NAMES, AGENT_ORDER, type AgentChoice, type AgentName, type ProgramCheck, type SetupView } from '../../../shared/types';
import { openLinkLogged } from '../openLink';
import { agentStep, buttonLabel, checkLine, explanations, intro, someAgentWorks, type AgentRow, type SetupButton } from './setupCopy';
import { agentChoice, chooseProject, findAgent, isLooking, lookAgain, setDefaultAgent, toggleAgent } from './setupStore';

/** How long each line waits for the one before it. */
const LINE_MS = 60;

/** One thing on the screen. Its key stays with it from one view to the next, so its elements stay as they are. */
type Unit = { key: string } & (
  | { kind: 'line'; text: string; tone?: 'logo' | 'strong' | 'hint'; aside?: string }
  | { kind: 'check'; name: 'git' | AgentName; text: string; state: ProgramCheck['state'] | 'looking'; quiet: boolean }
  | { kind: 'buttons'; buttons: SetupButton[] }
  | { kind: 'agents'; rows: AgentRow[] }
  | { kind: 'default'; ticked: AgentName[]; defaultAgent: AgentName }
);

const press: Record<SetupButton, () => void> = {
  'find-claude': () => void findAgent('claude'),
  'find-opencode': () => void findAgent('opencode'),
  'install-claude': () => openLinkLogged('https://code.claude.com/docs/en/setup', 'setup'),
  'install-opencode': () => openLinkLogged('https://opencode.ai/', 'setup'),
  'install-git': () => openLinkLogged('https://git-scm.com/downloads', 'setup'),
  'look-again': () => void lookAgain(),
  'choose-project': () => void chooseProject(),
};

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The agents step: the tick boxes, the default while two are ticked, and the line on what that means. */
function agentUnits(view: SetupView, choice: AgentChoice): Unit[] {
  const step = agentStep(view, choice);
  const units: Unit[] = [
    { key: 'agents-question', kind: 'line', text: 'Which agents should I use?', tone: 'strong' },
    { key: 'agents', kind: 'agents', rows: step.rows },
  ];
  if (step.showDefault) {
    units.push(
      { key: 'default-question', kind: 'line', text: 'Which one runs the manager, the Todo sync and new tasks?', tone: 'strong' },
      { key: 'default', kind: 'default', ticked: choice.ticked, defaultAgent: choice.defaultAgent },
    );
  }
  units.push({ key: 'agents-hint', kind: 'line', text: step.hint, tone: 'hint' });
  return units;
}

function unitsOf(view: SetupView, choice: AgentChoice | null, looking: boolean, platform: NodeJS.Platform): Unit[] {
  // A failing agent is no problem while another works (ticked and found), so its line goes quiet.
  const agentWorks = someAgentWorks(view);
  const checks = (['git', ...AGENT_ORDER] as const).map((name): Unit => {
    const check = name === 'git' ? view.git : view.agents[name].check;
    const unseen = looking && check.state !== 'found';
    const quiet = name !== 'git' && agentWorks;
    return {
      key: `check-${name}`,
      kind: 'check',
      name,
      text: checkLine(name, unseen ? 'looking' : check, quiet),
      state: unseen ? 'looking' : check.state,
      quiet,
    };
  });
  const step = view.ask && choice ? agentUnits(view, choice) : [];
  const blocks = explanations(view, platform).flatMap((block): Unit[] => [
    ...block.lines.map((text, i): Unit => ({ key: `${block.check}-${i}`, kind: 'line', text, tone: block.tones?.[i] })),
    { key: `${block.check}-buttons`, kind: 'buttons', buttons: block.buttons },
  ]);
  return [...intro(view).map((line, i): Unit => ({ key: `intro-${i}`, kind: 'line', ...line })), ...checks, ...step, ...blocks];
}

/**
 * What main found, as a terminal would say it: the welcome, a line per check, and for what it
 * couldn't find, what to do and the buttons for it. At a first start with an agent found, which
 * agents to use and which one is the default. It types itself out once; a new view, after Look
 * again or Find, changes the lines in place and shows at once.
 */
export default function SetupScreen(props: { view: SetupView }) {
  const platform = window.mainframe.platform;
  // Merged by key into the same objects, so a new view changes the text of the lines that stay and
  // leaves their elements alone: the focused button and a selection survive Look again.
  const [units, setUnits] = createStore<Unit[]>([]);
  createComputed(() => setUnits(reconcile(unitsOf(props.view, agentChoice(), isLooking(), platform), { key: 'key' })));

  // How many units are on screen; infinite once all have been, so later views come in at once.
  const [shown, setShown] = createSignal(prefersReducedMotion() ? Infinity : 0);
  createEffect(() => {
    const count = shown();
    if (count >= units.length) {
      setShown(Infinity);
      return;
    }
    const timer = setTimeout(() => setShown(count + 1), LINE_MS);
    onCleanup(() => clearTimeout(timer));
  });
  onMount(() => {
    const showAll = () => setShown(Infinity);
    window.addEventListener('click', showAll);
    window.addEventListener('keydown', showAll);
    onCleanup(() => {
      window.removeEventListener('click', showAll);
      window.removeEventListener('keydown', showAll);
    });
  });

  const button = (b: SetupButton, primary: boolean) => (
    <button class={primary ? 'btn primary' : 'btn'} data-testid={`setup-${b}`} onClick={press[b]}>
      {buttonLabel(b, platform)}
    </button>
  );

  // Run once per unit: a key never changes its kind, and what a unit says is read where it shows.
  const render = (unit: Unit): JSX.Element => {
    switch (unit.kind) {
      case 'line':
        return (
          <p class="setup-line" data-tone={unit.tone}>
            {unit.text}
            <Show when={unit.aside}>
              {' '}
              <span class="setup-aside">{unit.aside}</span>
            </Show>
          </p>
        );
      case 'check':
        return (
          <p class="setup-check" data-testid={`setup-${unit.name}`} data-state={unit.state} data-quiet={unit.quiet || undefined}>
            <span class="setup-name">
              <span class="setup-caret">›</span> {unit.name}
            </span> <span class="setup-status">{unit.text}</span>
          </p>
        );
      case 'buttons':
        return (
          <div class="setup-buttons">
            <For each={unit.buttons}>{(b, i) => button(b, i() === 0)}</For>
          </div>
        );
      case 'agents': {
        // The last tick can't be cleared: one agent has to run the tasks.
        const lone = () => unit.rows.filter((row) => row.ticked).length === 1;
        return (
          <div class="setup-agents">
            <For each={unit.rows}>
              {(row) => (
                <div class="setup-agent" data-ticked={row.ticked} data-works={row.works}>
                  <label class="setup-agent-name">
                    <input
                      type="checkbox"
                      class="setup-tick"
                      data-testid={`setup-tick-${row.name}`}
                      checked={row.ticked}
                      disabled={!row.works || (row.ticked && lone())}
                      onChange={() => toggleAgent(row.name)}
                    />
                    {AGENT_NAMES[row.name]}
                  </label>
                  <Show when={row.works} fallback={<span class="setup-agent-actions"><For each={row.buttons}>{(b) => button(b, false)}</For></span>}>
                    <span class="setup-agent-version">v{row.version}</span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        );
      }
      case 'default':
        return (
          <div class="setup-default" role="radiogroup" aria-label="The agent that runs the manager, the Todo sync and new tasks">
            <For each={unit.ticked}>
              {(name) => (
                <button
                  role="radio"
                  aria-checked={unit.defaultAgent === name}
                  data-testid={`setup-default-${name}`}
                  onClick={() => setDefaultAgent(name)}
                >
                  {AGENT_NAMES[name]}
                </button>
              )}
            </For>
          </div>
        );
    }
  };

  return (
    <main class="setup" data-testid="setup" aria-label="Setup">
      <div class="setup-titlebar" />
      <div class="setup-term">
        <div class="setup-page">
          <For each={units.slice(0, shown())}>{render}</For>
        </div>
      </div>
    </main>
  );
}

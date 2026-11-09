import { createEffect, createMemo, createSignal, For, Index, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { ProgramCheck, SetupView } from '../../../shared/types';
import { openLinkLogged } from '../openLink';
import { buttonLabel, checkLine, explanations, intro, type SetupButton } from './setupCopy';
import { chooseProject, findClaude, isLooking, lookAgain } from './setupStore';

/** How long each line waits for the one before it. */
const LINE_MS = 60;

type Unit =
  | { kind: 'line'; text: string; tone?: 'logo' | 'strong' | 'hint'; aside?: string }
  | { kind: 'check'; name: 'git' | 'claude'; text: string; state: ProgramCheck['state'] | 'looking' }
  | { kind: 'buttons'; buttons: SetupButton[] };

const press: Record<SetupButton, () => void> = {
  'find-claude': () => void findClaude(),
  'install-claude': () => openLinkLogged('https://code.claude.com/docs/en/setup', 'setup'),
  'install-git': () => openLinkLogged('https://git-scm.com/downloads', 'setup'),
  'look-again': () => void lookAgain(),
  'choose-project': () => void chooseProject(),
};

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * What main found, as a terminal would say it: the welcome, a line per check, and for what it
 * couldn't find, what to do and the buttons for it. It types itself out once; a new view, after Look
 * again or Find claude, changes the lines in place and shows at once.
 */
export default function SetupScreen(props: { view: SetupView }) {
  const units = createMemo<Unit[]>(() => {
    const { view } = props;
    const checks = (['git', 'claude'] as const).map((name): Unit => {
      const check = view[name];
      const looking = isLooking() && check.state !== 'found';
      return { kind: 'check', name, text: checkLine(name, looking ? 'looking' : check), state: looking ? 'looking' : check.state };
    });
    const blocks = explanations(view).flatMap((block): Unit[] => [
      ...block.lines.map((text, i): Unit => ({
        kind: 'line',
        text,
        tone: block.check === 'project' ? (i === 0 ? 'strong' : 'hint') : undefined,
      })),
      { kind: 'buttons', buttons: block.buttons },
    ]);
    return [...intro(view).map((line): Unit => ({ kind: 'line', ...line })), ...checks, ...blocks];
  });

  // How many units are on screen; infinite once all have been, so later views come in at once.
  const [shown, setShown] = createSignal(prefersReducedMotion() ? Infinity : 0);
  createEffect(() => {
    const count = shown();
    if (count >= units().length) {
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
          <p class="setup-check" data-testid={`setup-${unit.name}`} data-state={unit.state}>
            <span class="setup-name">
              <span class="setup-caret">›</span> {unit.name}
            </span> <span class="setup-status">{unit.text}</span>
          </p>
        );
      case 'buttons':
        return (
          <div class="setup-buttons">
            <For each={unit.buttons}>
              {(button, i) => (
                <button class={i() === 0 ? 'btn primary' : 'btn'} data-testid={`setup-${button}`} onClick={press[button]}>
                  {buttonLabel(button, props.view.platform)}
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
          <Index each={units()}>{(unit, i) => <Show when={i < shown()}>{render(unit())}</Show>}</Index>
        </div>
      </div>
    </main>
  );
}

// Adapted from Parallel Code (MIT): src/components/StatusDot.tsx at 97c3558. See THIRD_PARTY_NOTICES.md.
import { Match, Switch } from 'solid-js';
import type { Glyph } from './lanes';

/**
 * A task's state at a glance. Shape carries the state and colour only backs it up: motion means
 * working, a filled badge needs the owner, an outline is at rest.
 */
export default function StatusGlyph(props: { glyph: Glyph; label: string; size?: 'sm' | 'md' }) {
  return (
    <span
      class={`glyph ${props.size ?? 'sm'}`}
      data-testid="task-glyph"
      data-glyph={props.glyph}
      role="img"
      aria-label={props.label}
      title={props.label}
    >
      <Switch>
        <Match when={props.glyph === 'ask' || props.glyph === 'error'}>
          <span class="g-badge">
            <b>{props.glyph === 'ask' ? '?' : '!'}</b>
          </span>
        </Match>
        <Match when={props.glyph === 'spin' || props.glyph === 'start'}>
          <span class="g-spin" />
        </Match>
        <Match when={props.glyph === 'ready'}>
          {/* Parallel Code's StatusCheckIcon (src/components/icons.tsx). */}
          <svg
            class="g-check"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M2.5 6.3 4.9 8.7 9.6 3.5" />
          </svg>
        </Match>
        <Match when={props.glyph === 'wait'}>
          <span class="g-ring" />
        </Match>
        <Match when={props.glyph === 'dot'}>
          <span class="g-dot" />
        </Match>
      </Switch>
    </span>
  );
}

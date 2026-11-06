import { Show } from 'solid-js';
import type { RendererConfig } from '../../../shared/types';
import TerminalView from '../terminal/TerminalView';
import { managerStore } from './managerStore';

/**
 * The manager's column, at the window's left: its terminal, always on screen. The terminal never takes
 * the focus by itself; a click puts the cursor there.
 */
export default function ManagerColumn(props: { config: RendererConfig | undefined }) {
  return (
    <aside class="manager-column" data-testid="manager-column" aria-label="Manager">
      <Show when={props.config}>
        {(c) => (
          // Keyed: a new session gets a new terminal, as a task's does.
          <Show when={managerStore.managerTerminal} keyed>
            {(sessionId) => <TerminalView sessionId={sessionId} selected takeFocus={false} config={c()} />}
          </Show>
        )}
      </Show>
    </aside>
  );
}

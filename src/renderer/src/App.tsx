import { createMemo, createResource, For, onCleanup, onMount, Show } from 'solid-js';
import type { ProgramStatus } from '../../shared/types';
import { close, markExited, newSession, select, sessionsStore, type SessionEntry } from './sessionsStore';
import { getTerminal, redrawAllTerminals } from './terminal/registry';
import TerminalView from './terminal/TerminalView';
import './app.css';

function statusText(s: SessionEntry): string {
  if (s.exited) return 'exited';
  if (!s.status) return '—';
  return s.status.kind ? `${s.status.state} · ${s.status.kind}` : s.status.state;
}

/** Drives the colour of a row's status and of the terminal's top edge. */
function tone(s: SessionEntry): ProgramStatus['state'] | 'exited' | 'none' {
  if (s.exited) return 'exited';
  return s.status?.state ?? 'none';
}

function installE2eHooks(): void {
  window.__thesourceE2E = {
    sessionIds: () => sessionsStore.sessions.map((s) => s.id),
    screenText: (id) => {
      const buffer = getTerminal(id)?.buffer.active;
      if (!buffer) return '';
      const lines: string[] = [];
      for (let i = 0; i < buffer.length; i++) lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
      return lines.join('\n');
    },
  };
}

// Rows and buttons in the list don't take focus on click, so typing stays in the terminal.
const keepFocus = (e: MouseEvent) => e.preventDefault();

export default function App() {
  const [config] = createResource(async () => {
    const c = await window.thesource.getConfig();
    if (c.e2e) installE2eHooks();
    return c;
  });
  const selected = createMemo(() => sessionsStore.sessions.find((s) => s.id === sessionsStore.selectedId));

  onMount(() => onCleanup(window.thesource.onRedrawTerminals(redrawAllTerminals)));

  return (
    <div class="app">
      <aside class="sessions">
        <button class="new-session" data-testid="new-session" onMouseDown={keepFocus} onClick={() => void newSession()}>
          New session
        </button>
        <ul class="session-list">
          <For each={sessionsStore.sessions}>
            {(s) => (
              <li
                class="session-row"
                data-testid="session-row"
                data-session-id={s.id}
                data-selected={String(s.id === sessionsStore.selectedId)}
                data-tone={tone(s)}
              >
                <button class="session-select" onMouseDown={keepFocus} onClick={() => select(s.id)}>
                  <span class="session-name">{s.name}</span>
                  <span class="session-status" data-testid="session-status">
                    {statusText(s)}
                  </span>
                </button>
                <button
                  class="session-close"
                  data-testid="close-session"
                  aria-label={`Close ${s.name}`}
                  title={`Close ${s.name}`}
                  onMouseDown={keepFocus}
                  onClick={() => close(s.id)}
                >
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
      </aside>

      <main class="pane">
        <Show
          when={selected()}
          fallback={
            <div class="pane-empty">
              <p>No sessions yet.</p>
              <p class="pane-empty-hint">New session starts Claude Code in the project folder.</p>
            </div>
          }
        >
          {(s) => (
            <header class="pane-header">
              <span class="pane-name">{s().name}</span>
              <span class="pane-cwd" title={s().cwd}>
                {s().cwd}
              </span>
            </header>
          )}
        </Show>
        <div class="well" data-tone={selected() ? tone(selected()!) : 'none'} hidden={!selected()}>
          <Show when={config()}>
            {(c) => (
              <For each={sessionsStore.sessions}>
                {(s) => (
                  <TerminalView
                    sessionId={s.id}
                    selected={s.id === sessionsStore.selectedId}
                    config={c()}
                    onExit={() => markExited(s.id)}
                  />
                )}
              </For>
            )}
          </Show>
        </div>
      </main>
    </div>
  );
}

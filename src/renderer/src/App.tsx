import { createMemo, createResource, createSignal, For, onMount, Show } from 'solid-js';
import type { ProgramStatus, TaskView } from '../../shared/types';
import Board from './board/Board';
import { glyphOf, stateLabel } from './board/lanes';
import NewTaskDialog from './board/NewTaskDialog';
import StatusGlyph from './board/StatusGlyph';
import { loadPanelPrefs, savePanelPrefs, type PanelPrefs } from './panel/panelPrefs';
import SidePanel from './panel/SidePanel';
import { closeTask, loadTasks, sessionOf, setPanelOpen, tasksStore, terminalOf } from './tasksStore';
import { getTerminal } from './terminal/registry';
import { loadTerminalFont } from './terminal/terminalFont';
import TerminalView from './terminal/TerminalView';
// Parallel Code's fonts: Inter for the interface, Sora for the session title, JetBrains Mono in the terminal.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/sora/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import './app.css';

/** Drives the colour of the terminal's top edge. */
function tone(task: TaskView): ProgramStatus['state'] | 'closed' | 'none' {
  if (!task.session) return 'closed';
  return sessionOf(task)?.status?.state ?? 'none';
}

const terminalOfTask = (taskId: string) => {
  const sessionId = terminalOf(taskId);
  return sessionId ? getTerminal(sessionId) : undefined;
};

function installE2eHooks(): void {
  window.__thesourceE2E = {
    taskIds: () => tasksStore.tasks.map((t) => t.id),
    screenText: (taskId) => {
      const buffer = terminalOfTask(taskId)?.buffer.active;
      if (!buffer) return '';
      const lines: string[] = [];
      for (let i = 0; i < buffer.length; i++) lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
      return lines.join('\n');
    },
    termSize: (taskId) => {
      const term = terminalOfTask(taskId);
      return term ? { cols: term.cols, rows: term.rows } : null;
    },
  };
}

// Buttons don't take focus on click, so typing stays in the terminal.
const keepFocus = (e: MouseEvent) => e.preventDefault();

export default function App() {
  // Terminals render only once the config is here, so waiting for the font here covers them all.
  const [config] = createResource(async () => {
    const [c] = await Promise.all([window.thesource.getConfig(), loadTerminalFont(document.fonts)]);
    if (c.e2e) installE2eHooks();
    return c;
  });
  const selected = createMemo(() => tasksStore.tasks.find((t) => t.id === tasksStore.selectedId));
  const selectedTerminal = createMemo(() => (tasksStore.selectedId ? terminalOf(tasksStore.selectedId) : null));
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [panelPrefs, setPanelPrefs] = createSignal(loadPanelPrefs(localStorage));
  const keepPanelPrefs = (prefs: PanelPrefs) => {
    setPanelPrefs(prefs);
    savePanelPrefs(localStorage, prefs);
  };
  // Unpinned, a press on the board outside any card puts the panel away.
  const hideUnpinnedPanel = (e: MouseEvent) => {
    if (!panelPrefs().pinned && !(e.target as Element).closest('[data-testid=task-card]')) setPanelOpen(false);
  };

  onMount(() => void loadTasks());

  const closeDialog = () => {
    setDialogOpen(false);
    // The dialog hands the focus back to where it was; the selected task's terminal is where typing goes.
    const id = selectedTerminal();
    if (id) getTerminal(id)?.focus();
  };

  return (
    <div class="app">
      <section class="left" aria-label="Tasks">
        <header class="topbar">
          <button class="tb-btn" data-testid="new-task" onMouseDown={keepFocus} onClick={() => setDialogOpen(true)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
              <path d="M8 3v10M3 8h10" />
            </svg>
            New task
          </button>
          <Show when={config()}>
            {(c) => (
              <span class="tb-project" title={c().projectName}>
                <i aria-hidden="true" />
                <span>{c().projectName}</span>
              </span>
            )}
          </Show>
        </header>
        <div class="board" data-testid="board" onMouseDown={hideUnpinnedPanel}>
          <Show when={config()}>{(c) => <Board projectName={c().projectName} />}</Show>
        </div>
      </section>

      <SidePanel
        prefs={panelPrefs()}
        onPrefsChange={keepPanelPrefs}
        open={tasksStore.panelOpen}
        onOpenChange={setPanelOpen}
        badge={
          <Show when={selected()}>
            {(task) => (
              <StatusGlyph glyph={glyphOf(task(), sessionOf(task()))} label={stateLabel(task(), sessionOf(task())).text} />
            )}
          </Show>
        }
        empty={
          selected() ? undefined : (
            <>
              <strong>Select a session on the board</strong>
              New task starts Claude Code in a worktree of its own.
            </>
          )
        }
      >
        {/* Always laid out at one height, so the terminal below has the same size with or without a selection. */}
        <header class="panel-header">
          <Show when={selected()}>
            {(task) => (
              <>
                <h2 class="panel-title" title={task().title}>
                  {task().title}
                </h2>
                <Show when={task().session}>
                  <button
                    class="btn"
                    data-testid="close-session"
                    onMouseDown={keepFocus}
                    onClick={() => closeTask(task().id)}
                  >
                    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                      <rect x="3" y="3" width="8" height="8" rx="1.5" />
                    </svg>
                    Close session
                  </button>
                </Show>
              </>
            )}
          </Show>
        </header>
        <div class="well" data-tone={selected() ? tone(selected()!) : 'none'} hidden={!selected()}>
          <Show when={config()}>
            {(c) => (
              <For each={tasksStore.terminals}>
                {(entry) => (
                  <TerminalView sessionId={entry.sessionId} selected={entry.sessionId === selectedTerminal()} config={c()} />
                )}
              </For>
            )}
          </Show>
        </div>
      </SidePanel>

      <Show when={dialogOpen() && config()}>
        {(c) => <NewTaskDialog projectName={c().projectName} onClose={closeDialog} />}
      </Show>
    </div>
  );
}

import { createMemo, createResource, createSignal, onCleanup, onMount, Show } from 'solid-js';
import Board from './board/Board';
import { glyphOf, stateLabel } from './board/lanes';
import NewTaskDialog from './board/NewTaskDialog';
import { installBoardShortcuts } from './board/shortcuts';
import StatusGlyph from './board/StatusGlyph';
import { loadPanelPrefs, savePanelPrefs, type PanelPrefs } from './panel/panelPrefs';
import SessionPanel from './panel/SessionPanel';
import SidePanel from './panel/SidePanel';
import { jumpToNeedsYou, loadTasks, sessionOf, setPanelOpen, tasksStore, terminalOf } from './tasksStore';
import { getFit, getTerminal } from './terminal/registry';
import { loadTerminalFont } from './terminal/terminalFont';
// Parallel Code's fonts: Inter for the interface, Sora for the session title, JetBrains Mono in the terminal.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/sora/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import './app.css';

const terminalOfTask = (taskId: string) => {
  const sessionId = terminalOf(taskId);
  return sessionId ? getTerminal(sessionId) : undefined;
};

function installE2eHooks(): void {
  const firstSpawns = new Map<string, { cols: number; rows: number }>();
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
    fitSize: (taskId) => {
      const sessionId = terminalOf(taskId);
      const dims = sessionId ? getFit(sessionId)?.proposeDimensions() : undefined;
      return dims ? { cols: dims.cols, rows: dims.rows } : null;
    },
    firstSpawn: (taskId) => {
      const sessionId = terminalOf(taskId);
      return (sessionId && firstSpawns.get(sessionId)) || null;
    },
    spawn: (req) => {
      if (!firstSpawns.has(req.sessionId)) firstSpawns.set(req.sessionId, { cols: req.cols, rows: req.rows });
      return window.thesource.spawn(req);
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
  onCleanup(installBoardShortcuts(window, jumpToNeedsYou));

  const closeDialog = () => {
    setDialogOpen(false);
    // The dialog hands the focus back to where it was; the selected task's terminal is where typing goes.
    const id = tasksStore.selectedId && terminalOf(tasksStore.selectedId);
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
              <>
                <span class="tb-project" title={c().projectName}>
                  <i aria-hidden="true" />
                  <span>{c().projectName}</span>
                </span>
                <button
                  class="tb-jump"
                  data-testid="jump-next"
                  title="Next session that needs you"
                  onMouseDown={keepFocus}
                  onClick={() => jumpToNeedsYou(1)}
                >
                  <kbd>Ctrl</kbd>
                  <kbd>Tab</kbd>
                  <span>Next that needs you</span>
                </button>
              </>
            )}
          </Show>
        </header>
        <div class="board" data-testid="board" onMouseDown={hideUnpinnedPanel}>
          <Show when={config()}>{(c) => <Board projectName={c().projectName} />}</Show>
        </div>
      </section>

      <SidePanel
        label="Selected session"
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
        badgeLabel={selected() ? stateLabel(selected()!, sessionOf(selected()!)).text : undefined}
        empty={
          selected() ? undefined : (
            <>
              <strong>Select a session on the board</strong>
              New task starts Claude Code in a worktree of its own.
            </>
          )
        }
      >
        <SessionPanel task={selected()} config={config()} />
      </SidePanel>

      <Show when={dialogOpen() && config()}>
        {(c) => <NewTaskDialog projectName={c().projectName} onClose={closeDialog} />}
      </Show>
    </div>
  );
}

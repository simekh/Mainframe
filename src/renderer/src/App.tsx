import type { Terminal } from '@xterm/xterm';
import { createEffect, createResource, createSignal, Match, onCleanup, Show, Switch } from 'solid-js';
import { AGENT_NAMES } from '../../shared/types';
import { installBoardShortcuts } from './board/shortcuts';
import { managerOf } from './manager/managerStore';
import Panes from './projects/Panes';
import ProjectRail from './projects/ProjectRail';
import { closeFocusedPane, focusProject, jump, openProject, projectsStore, railState } from './projects/projectsStore';
import TopRow from './projects/TopRow';
import SettingsButton from './settings/SettingsButton';
import SettingsDialog from './settings/SettingsDialog';
import { loadSettings, settingsView } from './settings/settingsStore';
import SetupScreen from './setup/SetupScreen';
import { loadSetup, setupView } from './setup/setupStore';
import { tasksOf, tasksStore, terminalOf } from './tasksStore';
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

const termOf = (sessionId: string | null) => (sessionId ? getTerminal(sessionId) : undefined);
/** The task's terminal, in whichever project has it: no two projects share a task id. */
const terminalIdOf = (taskId: string) =>
  Object.keys(tasksStore.projects).map((dir) => terminalOf(dir, taskId)).find((id) => id !== null) ?? null;
const terminalOfTask = (taskId: string) => termOf(terminalIdOf(taskId));
/** The first open project's manager's terminal. */
const managerTerminal = () => termOf(managerOf(projectsStore.projects[0]?.dir ?? '')?.managerTerminal ?? null);

function textOf(term: Terminal | undefined): string {
  const buffer = term?.buffer.active;
  if (!buffer) return '';
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i++) lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
  return lines.join('\n');
}

const sizeOf = (term: Terminal | undefined) => (term ? { cols: term.cols, rows: term.rows } : null);

function installE2eHooks(): void {
  const firstSpawns = new Map<string, { cols: number; rows: number }>();
  window.__mainframeE2E = {
    taskIds: () => projectsStore.projects.flatMap((p) => tasksOf(p.dir).tasks.map((t) => t.id)),
    screenText: (taskId) => textOf(terminalOfTask(taskId)),
    termSize: (taskId) => sizeOf(terminalOfTask(taskId)),
    managerScreen: () => textOf(managerTerminal()),
    managerTermSize: () => sizeOf(managerTerminal()),
    select: (taskId, column, row, length) => terminalOfTask(taskId)?.select(column, row, length),
    cell: (taskId, row, col) => {
      const cell = terminalOfTask(taskId)?.buffer.active.getLine(row)?.getCell(col);
      if (!cell) return null;
      const fg = cell.isFgRGB()
        ? `#${cell.getFgColor().toString(16).padStart(6, '0')}`
        : cell.isFgDefault()
          ? 'default'
          : `palette ${cell.getFgColor()}`;
      return { fg, bold: !!cell.isBold(), underline: !!cell.isUnderline() };
    },
    fitSize: (taskId) => {
      const sessionId = terminalIdOf(taskId);
      const dims = sessionId ? getFit(sessionId)?.proposeDimensions() : undefined;
      return dims ? { cols: dims.cols, rows: dims.rows } : null;
    },
    firstSpawn: (taskId) => {
      const sessionId = terminalIdOf(taskId);
      return (sessionId && firstSpawns.get(sessionId)) || null;
    },
    spawn: (req) => {
      if (!firstSpawns.has(req.sessionId)) firstSpawns.set(req.sessionId, { cols: req.cols, rows: req.rows });
      return window.mainframe.spawn(req);
    },
  };
}

export default function App() {
  // Main answers once it has checked git and claude and, when nothing is missing, started the projects.
  // The calls that need them wait for this: the store lists the projects when the screen gives way to them.
  const setup = loadSetup();
  // Terminals render only once the config is here, so waiting for the font here covers them all.
  const [config] = createResource(async () => {
    const [c] = await Promise.all([window.mainframe.getConfig(), loadTerminalFont(document.fonts)]);
    if (c.e2e) {
      // Test-only, and still needed: main sets the Mac's application menu once it starts the projects,
      // which waits on its checks of git and claude, while the config and the font are in sooner. A
      // test that uses the menu right after launchApp, which waits for these hooks, must find it there.
      await setup;
      installE2eHooks();
    }
    return c;
  });
  onCleanup(
    installBoardShortcuts(
      window,
      {
        jump,
        focusProject: (index) => {
          const project = projectsStore.projects[index];
          if (project) focusProject(project.dir);
        },
        closePane: closeFocusedPane,
        // Main registers the project calls only once the setup is over.
        openProject: () => {
          if (setupView() === null) void openProject();
        },
      },
      window.mainframe.platform,
    ),
  );

  // Where the window's part of the top row ends: the first pane's bar starts there.
  const [rowStart, setRowStart] = createSignal(0);

  // Main answers the Settings calls once the projects have started, as the setup gives way to them.
  createEffect(() => {
    if (setupView() === null) void loadSettings();
  });
  // Says when another agent stands in for the saved default; its ✕ hides it until the next start.
  const [fallbackHidden, setFallbackHidden] = createSignal(false);
  const fallback = () => {
    const view = settingsView();
    return view && view.runDefault !== view.defaultAgent && !fallbackHidden() ? view : undefined;
  };

  return (
    <div class="app" data-rail={railState()} style={{ '--row-start': `${rowStart()}px` }}>
      <Switch>
        <Match when={setupView() === null}>
          <TopRow onRightEdge={setRowStart} />
          <ProjectRail />
          <Panes config={config()} />
          {/* The cog is the last pane's in the top row; with no pane there, it keeps the window's top-right corner. */}
          <Show when={projectsStore.layout.shown.length === 0}>
            <div class="settings-corner">
              <SettingsButton />
            </div>
          </Show>
          <SettingsDialog />
          <Show when={fallback()}>
            {(view) => (
              <div class="default-fallback" data-testid="default-fallback" role="status">
                <span>
                  {`${AGENT_NAMES[view().defaultAgent]} didn't work at start, so ${AGENT_NAMES[view().runDefault]} runs the manager, the Todo sync and new tasks for now. Settings shows why.`}
                </span>
                <button type="button" title="Hide" aria-label="Hide" onClick={() => setFallbackHidden(true)}>
                  ✕
                </button>
              </div>
            )}
          </Show>
        </Match>
        <Match when={setupView()}>{(view) => <SetupScreen view={view()} />}</Match>
      </Switch>
    </div>
  );
}

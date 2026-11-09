import type { Terminal } from '@xterm/xterm';
import { createResource, onCleanup, Show } from 'solid-js';
import { installBoardShortcuts } from './board/shortcuts';
import { managerOf } from './manager/managerStore';
import Panes from './projects/Panes';
import ProjectRail from './projects/ProjectRail';
import { closeFocusedPane, focusProject, jump, projectsStore } from './projects/projectsStore';
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
      // Test-only, and still needed: main sets the application menu once it starts the projects, which
      // waits on its checks of git and claude, while the config and the font are in sooner. A test
      // that uses the menu right after launchApp, which waits for these hooks, must find it there.
      await setup;
      installE2eHooks();
    }
    return c;
  });
  onCleanup(
    installBoardShortcuts(window, {
      jump,
      focusProject: (index) => {
        const project = projectsStore.projects[index];
        if (project) focusProject(project.dir);
      },
      closePane: closeFocusedPane,
    }),
  );

  return (
    <div class="app">
      <Show when={setupView() !== undefined}>
        <Show
          when={setupView()}
          fallback={
            <>
              <ProjectRail />
              <Panes config={config()} />
            </>
          }
        >
          {(view) => <SetupScreen view={view()} />}
        </Show>
      </Show>
    </div>
  );
}

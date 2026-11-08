import type { Terminal } from '@xterm/xterm';
import { createResource, createSignal, onCleanup, onMount } from 'solid-js';
import { installBoardShortcuts } from './board/shortcuts';
import { clampManagerWidth, loadManagerWidth, saveManagerWidth } from './manager/managerPrefs';
import { managerOf } from './manager/managerStore';
import Panes from './projects/Panes';
import ProjectRail from './projects/ProjectRail';
import { focusProject, loadProjects, projectsStore, revealProject } from './projects/projectsStore';
import { jumpToNeedsYou, tasksStore, terminalOf } from './tasksStore';
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
/** The project the task belongs to: no two projects share a task id. */
const dirOfTask = (taskId: string) =>
  Object.keys(tasksStore.projects).find((dir) => tasksStore.projects[dir].tasks.some((t) => t.id === taskId));
const terminalIdOf = (taskId: string) => {
  const dir = dirOfTask(taskId);
  return dir ? terminalOf(dir, taskId) : null;
};
const terminalOfTask = (taskId: string) => termOf(terminalIdOf(taskId));
/** The manager's terminal of the project, or of the first one open. */
const managerTerminalOf = (dir?: string) => termOf(managerOf(dir ?? projectsStore.projects[0]?.dir ?? '')?.managerTerminal ?? null);

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
    taskIds: () => projectsStore.projects.flatMap((p) => tasksStore.projects[p.dir]?.tasks.map((t) => t.id) ?? []),
    screenText: (taskId) => textOf(terminalOfTask(taskId)),
    termSize: (taskId) => sizeOf(terminalOfTask(taskId)),
    managerScreen: (dir) => textOf(managerTerminalOf(dir)),
    managerTermSize: (dir) => sizeOf(managerTerminalOf(dir)),
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

const jump = (step: 1 | -1) =>
  jumpToNeedsYou(
    step,
    projectsStore.projects.map((p) => p.dir),
    revealProject,
  );

export default function App() {
  // Terminals render only once the config is here, so waiting for the font here covers them all.
  const [config] = createResource(async () => {
    const [c] = await Promise.all([window.mainframe.getConfig(), loadTerminalFont(document.fonts)]);
    if (c.e2e) installE2eHooks();
    return c;
  });
  // The owner's width for the managers' columns, or the one an edge is dragged to. Each pane clamps
  // what it shows, and its session panel leaves it that much.
  const [managerWidth, setManagerWidth] = createSignal(loadManagerWidth(localStorage));
  const keepManagerWidth = (w: number, paneWidth: number) => {
    const kept = clampManagerWidth(w, paneWidth);
    setManagerWidth(kept);
    saveManagerWidth(localStorage, kept);
  };

  onMount(() => {
    loadProjects().catch((err: unknown) => console.error('[projects] could not list the open projects', err));
  });
  onCleanup(
    installBoardShortcuts(window, {
      jump,
      focusProject: (index) => {
        const project = projectsStore.projects[index];
        if (project) focusProject(project.dir);
      },
    }),
  );

  return (
    <div class="app">
      <ProjectRail />
      <Panes
        config={config()}
        managerWidth={managerWidth()}
        onManagerDrag={setManagerWidth}
        onManagerDone={keepManagerWidth}
        onJump={() => jump(1)}
      />
    </div>
  );
}

import { createMemo, createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { ProjectView, RendererConfig } from '../../../shared/types';
import Board from '../board/Board';
import { glyphOf, stateLabel } from '../board/lanes';
import NewTaskDialog from '../board/NewTaskDialog';
import StatusGlyph from '../board/StatusGlyph';
import ManagerColumn from '../manager/ManagerColumn';
import { clampManagerWidth, loadManagerWidth, saveManagerWidth } from '../manager/managerPrefs';
import { BOARD_ROOM, loadPanelPrefs, MIN_WIDTH, savePanelPrefs, type PanelPrefs } from '../panel/panelPrefs';
import SessionPanel from '../panel/SessionPanel';
import SidePanel from '../panel/SidePanel';
import { focusTerminalOf, sessionOf, setPanelOpen, tasksOf } from '../tasksStore';
import { ProjectContext } from './projectContext';
import { isFocused, isManagerShown, isShown, jump, projectsStore, revealProject, toggleManagerOf } from './projectsStore';

// Buttons don't take focus on click, so typing stays in the terminal.
const keepFocus = (e: MouseEvent) => e.preventDefault();

// The owner's width for the managers' columns, one for every project, or the one an edge is dragged
// to. Each pane clamps what it shows, and its session panel leaves it that much.
const [managerWidth, setManagerWidth] = createSignal(loadManagerWidth(localStorage));

/**
 * One open project: its manager's column, its board and its session panel. Every open project has
 * one mounted, on screen or not, so its terminals keep their output; one off screen is laid out over
 * the others, invisible, at the size of the area the panes share.
 */
export default function ProjectPane(props: {
  project: ProjectView;
  config: RendererConfig | undefined;
  /** Where it sits among the panes on screen. */
  style: JSX.CSSProperties;
}) {
  const dir = props.project.dir;
  const shown = () => isShown(dir);
  let root!: HTMLDivElement;
  // The pane's own width, never the window's: measured as it mounts, before the first paint.
  const [width, setWidth] = createSignal(0);
  onMount(() => {
    setWidth(root.clientWidth);
    const observer = new ResizeObserver(() => setWidth(root.clientWidth));
    observer.observe(root);
    onCleanup(() => observer.disconnect());
  });

  const tasks = () => tasksOf(dir);
  const selected = createMemo(() => tasks().tasks.find((t) => t.id === tasks().selectedId));
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const showManager = () => isManagerShown(dir);
  // Framed while the owner works in it beside other projects; alone on screen, it needs no frame.
  const framed = () => isFocused(dir) && projectsStore.layout.shown.length > 1;
  const shownManagerWidth = () => clampManagerWidth(managerWidth(), width());
  const keepManagerWidth = (w: number) => {
    const kept = clampManagerWidth(w, width());
    setManagerWidth(kept);
    saveManagerWidth(localStorage, kept);
  };
  const besideWidth = () => (showManager() ? shownManagerWidth() : 0);
  // Too narrow for the board beside the pinned panel at its narrowest, the panel floats over the board
  // as an unpinned one does. The owner's pin is kept for a pane with room.
  const roomToPin = () => width() - besideWidth() - MIN_WIDTH >= BOARD_ROOM.pinned;
  // The project's own width and pin, so pinning one project's panel leaves the others' as they are.
  const [ownPanelPrefs, setOwnPanelPrefs] = createSignal(loadPanelPrefs(localStorage, dir));
  const panelPrefs = (): PanelPrefs => ({ ...ownPanelPrefs(), pinned: ownPanelPrefs().pinned && roomToPin() });
  const keepPanelPrefs = (prefs: PanelPrefs) => {
    const kept = roomToPin() ? prefs : { ...prefs, pinned: ownPanelPrefs().pinned };
    setOwnPanelPrefs(kept);
    savePanelPrefs(localStorage, dir, kept);
  };
  // Unpinned, a press on the board outside any card puts the panel away.
  const hideUnpinnedPanel = (e: MouseEvent) => {
    if (!panelPrefs().pinned && !(e.target as Element).closest('[data-testid=task-card]')) setPanelOpen(dir, false);
  };
  const closeDialog = () => {
    setDialogOpen(false);
    // The dialog hands the focus back to where it was; the selected task's terminal is where typing goes.
    const id = tasks().selectedId;
    if (id) focusTerminalOf(dir, id);
  };

  return (
    <ProjectContext.Provider value={{ dir, name: props.project.name, shown, width }}>
      <div
        class="project-pane"
        ref={root}
        data-testid="project-pane"
        data-project={dir}
        data-shown={String(shown())}
        data-focused={String(framed())}
        aria-hidden={shown() ? undefined : 'true'}
        inert={!shown()}
        style={props.style}
        onPointerDown={() => revealProject(dir)}
        onFocusIn={() => revealProject(dir)}
      >
        <ManagerColumn
          config={props.config}
          width={shownManagerWidth()}
          hidden={!showManager()}
          onDrag={setManagerWidth}
          onDone={keepManagerWidth}
        />

        <section class="board-column" aria-label={`Tasks of ${props.project.name}`}>
          <header class="topbar">
            <button class="tb-btn" data-testid="new-task" onMouseDown={keepFocus} onClick={() => setDialogOpen(true)}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
                <path d="M8 3v10M3 8h10" />
              </svg>
              New task
            </button>
            <span class="tb-project" title={dir}>
              <i aria-hidden="true" />
              <span>{props.project.name}</span>
            </span>
            <button
              class="tb-toggle"
              data-testid="manager-toggle"
              aria-pressed={showManager() ? 'true' : 'false'}
              title={showManager() ? 'Hide the manager' : 'Show the manager'}
              onMouseDown={keepFocus}
              onClick={() => toggleManagerOf(dir)}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
                <rect x="2" y="3" width="12" height="10" rx="2" />
                <path d="M6.5 3v10" />
              </svg>
              <span>Manager</span>
            </button>
            <button class="tb-jump" data-testid="jump-next" title="Next session that needs you" onMouseDown={keepFocus} onClick={() => jump(1)}>
              <kbd>Ctrl</kbd>
              <kbd>Tab</kbd>
              <span>Next that needs you</span>
            </button>
          </header>
          <div class="board" data-testid="board" onMouseDown={hideUnpinnedPanel}>
            <Board />
          </div>
        </section>

        <SidePanel
          label="Selected session"
          prefs={panelPrefs()}
          onPrefsChange={keepPanelPrefs}
          canPin={roomToPin()}
          besideWidth={besideWidth()}
          open={tasks().panelOpen}
          onOpenChange={(open) => setPanelOpen(dir, open)}
          badge={
            <Show when={selected()}>
              {(task) => <StatusGlyph glyph={glyphOf(task(), sessionOf(task()))} label={stateLabel(task(), sessionOf(task())).text} />}
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
          <SessionPanel task={selected()} config={props.config} />
        </SidePanel>

        <Show when={dialogOpen()}>
          <NewTaskDialog onClose={closeDialog} />
        </Show>
      </div>
    </ProjectContext.Provider>
  );
}
